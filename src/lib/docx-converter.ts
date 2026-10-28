/**
 * DOCX converter: edited HTML (from the mammoth-based editor) -> .docx Buffer.
 *
 * Walks the parsed DOM tree in document order and maps:
 * - h1..h4            -> Heading paragraphs
 * - p / bare text     -> Paragraph with TextRun children
 * - strong/b/em/i/u/s/strike/del/br/a/code -> run formatting
 * - blockquote        -> indented (720 twips) italic paragraphs
 * - ul/ol (nested)    -> bullet / "signflow-ordered" numbering paragraphs
 * - table             -> docx Table (100% width, auto cell widths)
 * - img (data URLs)   -> inline ImageRun (max width 500px, aspect preserved)
 * - style="text-align: center|right|justify" -> paragraph alignment
 *
 * Entity decoding is handled by node-html-parser: its TextNode `.text` getter
 * returns unescaped text (&amp; &lt; &gt; &quot; &#39; &nbsp; ... all decoded).
 *
 * Never throws on malformed/unknown HTML: unknown nodes are skipped or
 * rendered best-effort, and every top-level node conversion is guarded.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ParagraphChild,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { imageSize } from 'image-size'
import { NodeType, parse } from 'node-html-parser'
import type { HTMLElement, TextNode } from 'node-html-parser'

type Alignment = (typeof AlignmentType)[keyof typeof AlignmentType]
type DocxImageType = 'jpg' | 'png' | 'gif' | 'bmp'
type DocxBlock = Paragraph | Table

/** Run-level formatting inherited from enclosing inline tags. */
interface RunFormat {
  bold?: boolean
  italics?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
}

/** Block-level conversion context. */
interface BlockContext {
  /** Inside a <blockquote>: add 720-twip left indent (italics come via RunFormat). */
  quote?: boolean
  /** Inherited paragraph alignment. */
  align?: Alignment
}

/** Per-conversion mutable state (docx numbering instances for ordered lists). */
interface ConverterState {
  /** Each top-level <ol> gets its own instance so numbering restarts at 1. */
  nextOrderedInstance: number
}

const ORDERED_LIST_REFERENCE = 'signflow-ordered'
const MAX_IMAGE_WIDTH = 500
const DEFAULT_IMAGE_WIDTH = 300
const DEFAULT_IMAGE_HEIGHT = 150
const QUOTE_INDENT_TWIPS = 720
/** docx supports numbering levels 0..8. */
const MAX_LIST_LEVEL = 8

const HEADING_MAP: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
}

const TAGS_TO_IGNORE = new Set([
  'style',
  'script',
  'head',
  'title',
  'meta',
  'link',
  'template',
  'noscript',
])

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'dd', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul',
])

/** Numbering definition for <ol> items, levels 0..8 -> "1." / "1.1." / ... */
const ORDERED_LEVELS = Array.from({ length: MAX_LIST_LEVEL + 1 }, (_, level) => ({
  level,
  format: LevelFormat.DECIMAL,
  text: `%${level + 1}.`,
  alignment: AlignmentType.START,
  style: {
    paragraph: {
      indent: { left: QUOTE_INDENT_TWIPS * (level + 1), hanging: 360 },
    },
  },
}))

const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'auto' }
const DEFAULT_TABLE_BORDERS = {
  top: TABLE_BORDER,
  bottom: TABLE_BORDER,
  left: TABLE_BORDER,
  right: TABLE_BORDER,
  insideHorizontal: TABLE_BORDER,
  insideVertical: TABLE_BORDER,
}

/** Collapse ASCII whitespace runs to single spaces, preserving &nbsp; (\u00a0). */
function collapseWhitespace(text: string): string {
  return text.replace(/[ \t\r\n\f\v]+/g, ' ')
}

function tagOf(el: HTMLElement): string {
  return el.rawTagName.toLowerCase()
}

function isBlockTag(tag: string): boolean {
  return BLOCK_TAGS.has(tag)
}

function elementNode(node: unknown): node is HTMLElement {
  return typeof node === 'object' && node !== null &&
    (node as { nodeType?: number }).nodeType === NodeType.ELEMENT_NODE
}

function textNode(node: unknown): node is TextNode {
  return typeof node === 'object' && node !== null &&
    (node as { nodeType?: number }).nodeType === NodeType.TEXT_NODE
}

/** Initial run format for block content (blockquotes force italics). */
function baseFormat(ctx: BlockContext): RunFormat {
  return ctx.quote ? { italics: true } : {}
}

/** Read text-align from the inline style attribute of a block element. */
function styleAlign(el: HTMLElement): Alignment | undefined {
  const style = el.getAttribute('style')?.toLowerCase() ?? ''
  const m = /text-align\s*:\s*(center|right|justify|left)/.exec(style)
  if (!m) return undefined
  switch (m[1]) {
    case 'center': return AlignmentType.CENTER
    case 'right': return AlignmentType.RIGHT
    case 'justify': return AlignmentType.JUSTIFIED
    default: return undefined
  }
}

/** Read margin-left or padding-left in px from inline style and convert to twips (1px = 15 twips). */
function styleIndentLeftTwips(el: HTMLElement): number {
  let totalPx = 0
  const checkStyle = (s: string) => {
    const ml = /margin-left\s*:\s*([0-9.]+)px/i.exec(s)
    if (ml) totalPx += parseFloat(ml[1]) || 0
    const pl = /padding-left\s*:\s*([0-9.]+)px/i.exec(s)
    if (pl) totalPx += parseFloat(pl[1]) || 0
  }
  checkStyle(el.getAttribute('style') ?? '')
  // Also check if first child is a wrapper span or img with margin-left
  for (const child of el.childNodes) {
    if (elementNode(child)) {
      checkStyle(child.getAttribute('style') ?? '')
    }
  }
  return Math.max(0, Math.round(totalPx * 15))
}

function buildTextRun(text: string, fmt: RunFormat): TextRun {
  return new TextRun({
    text,
    bold: fmt.bold,
    italics: fmt.italics,
    strike: fmt.strike,
    underline: fmt.underline ? {} : undefined,
    font: fmt.code ? 'Courier New' : undefined,
  })
}

/** Map a detected/mime image format onto a type the docx package accepts. */
function docxImageType(buffer: Buffer, mime: string): DocxImageType {
  try {
    const t = imageSize(buffer).type?.toLowerCase()
    if (t === 'jpg' || t === 'jpeg') return 'jpg'
    if (t === 'png' || t === 'gif' || t === 'bmp') return t
  } catch {
    // Unknown real format: fall back to the data URL's mime type.
  }
  const m = mime.toLowerCase()
  if (m.includes('gif')) return 'gif'
  if (m.includes('bmp')) return 'bmp'
  if (m.includes('jpg') || m.includes('jpeg')) return 'jpg'
  return 'png'
}

/** Read target width (in px) from el attributes or style if specified. */
function parseImageWidth(el: HTMLElement): number | null {
  const widthAttr = el.getAttribute('width')
  if (widthAttr) {
    const num = parseFloat(widthAttr)
    if (Number.isFinite(num) && num > 0) return num
  }
  const style = el.getAttribute('style') ?? ''
  const m = /(?:^|;)\s*width\s*:\s*([0-9.]+)(?:px)?/i.exec(style)
  if (m) {
    const num = parseFloat(m[1])
    if (Number.isFinite(num) && num > 0) return num
  }
  return null
}

/** Read target height (in px) from el attributes or style if specified. */
function parseImageHeight(el: HTMLElement): number | null {
  const heightAttr = el.getAttribute('height')
  if (heightAttr) {
    const num = parseFloat(heightAttr)
    if (Number.isFinite(num) && num > 0) return num
  }
  const style = el.getAttribute('style') ?? ''
  const m = /(?:^|;)\s*height\s*:\s*([0-9.]+)(?:px)?/i.exec(style)
  if (m) {
    const num = parseFloat(m[1])
    if (Number.isFinite(num) && num > 0) return num
  }
  return null
}

/** Dimensions scaled to target width/height or at most MAX_IMAGE_WIDTH px. */
function scaledImageSize(
  buffer: Buffer,
  targetWidth?: number | null,
  targetHeight?: number | null,
): { width: number; height: number } {
  try {
    const dim = imageSize(buffer)
    if (
      dim.width > 0 && dim.height > 0 &&
      Number.isFinite(dim.width) && Number.isFinite(dim.height)
    ) {
      const aspect = dim.height / dim.width
      const baseW = targetWidth && targetWidth > 0 ? targetWidth : dim.width
      const w = Math.min(Math.round(baseW), MAX_IMAGE_WIDTH)
      const h =
        targetHeight && targetHeight > 0
          ? Math.max(15, Math.min(800, Math.round(targetHeight)))
          : Math.max(10, Math.round(w * aspect))
      return { width: Math.max(20, w), height: h }
    }
  } catch {
    // Fall through to default size.
  }
  const baseW = targetWidth && targetWidth > 0 ? Math.min(Math.round(targetWidth), MAX_IMAGE_WIDTH) : DEFAULT_IMAGE_WIDTH
  const baseH =
    targetHeight && targetHeight > 0
      ? Math.max(15, Math.min(800, Math.round(targetHeight)))
      : Math.round(baseW * (DEFAULT_IMAGE_HEIGHT / DEFAULT_IMAGE_WIDTH))
  return { width: baseW, height: baseH }
}

/** Build an ImageRun from an <img> with a base64 data URL; null if undecodable. */
function buildImageRun(el: HTMLElement): ImageRun | null {
  try {
    const src = el.getAttribute('src') ?? ''
    const m = /^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(src.trim())
    if (!m) return null
    const buffer = Buffer.from(m[2], 'base64')
    if (buffer.length === 0) return null
    const customWidth = parseImageWidth(el)
    const customHeight = parseImageHeight(el)
    return new ImageRun({
      type: docxImageType(buffer, `image/${m[1]}`),
      data: buffer,
      transformation: scaledImageSize(buffer, customWidth, customHeight),
    })
  } catch {
    return null
  }
}

/**
 * Convert inline-level nodes into ParagraphChildren (runs, breaks, hyperlinks,
 * images). Entities are already decoded by the parser's `.text` getter.
 */
function collectInline(nodes: readonly unknown[], fmt: RunFormat, out: ParagraphChild[]): void {
  for (const node of nodes) {
    try {
      if (textNode(node)) {
        let text = collapseWhitespace(node.text)
        if (!text) continue
        if (out.length === 0) text = text.replace(/^ +/, '')
        if (text === ' ' && out.length === 0) continue
        out.push(buildTextRun(text, fmt))
        continue
      }
      if (!elementNode(node)) continue
      const tag = tagOf(node)

      if (tag === 'br') {
        out.push(new TextRun({ break: 1 }))
        continue
      }
      if (TAGS_TO_IGNORE.has(tag)) continue

      if (tag === 'strong' || tag === 'b') {
        collectInline(node.childNodes, { ...fmt, bold: true }, out)
      } else if (tag === 'em' || tag === 'i') {
        collectInline(node.childNodes, { ...fmt, italics: true }, out)
      } else if (tag === 'u') {
        collectInline(node.childNodes, { ...fmt, underline: true }, out)
      } else if (tag === 's' || tag === 'strike' || tag === 'del') {
        collectInline(node.childNodes, { ...fmt, strike: true }, out)
      } else if (tag === 'code') {
        collectInline(node.childNodes, { ...fmt, code: true }, out)
      } else if (tag === 'a') {
        const href = node.getAttribute('href')
        if (!href) {
          collectInline(node.childNodes, fmt, out)
        } else {
          const children: ParagraphChild[] = []
          collectInline(node.childNodes, fmt, children)
          if (children.length === 0) {
            const label = collapseWhitespace(node.text).trim() || href
            children.push(buildTextRun(label, fmt))
          }
          out.push(new ExternalHyperlink({ children, link: href }))
        }
      } else if (tag === 'img') {
        const run = buildImageRun(node)
        if (run) out.push(run)
      } else {
        // span/font/small/sub/sup/mark and unknown or stray block tags:
        // transparently merge their inline content.
        collectInline(node.childNodes, fmt, out)
      }
    } catch {
      // Skip malformed inline nodes, never throw.
    }
  }
}

function paragraphAlign(ctx: BlockContext, el?: HTMLElement): Alignment | undefined {
  return (el ? styleAlign(el) : undefined) ?? ctx.align
}

function quoteIndent(ctx: BlockContext, el?: HTMLElement): { left: number } | undefined {
  const base = ctx.quote ? QUOTE_INDENT_TWIPS : 0
  const extra = el ? styleIndentLeftTwips(el) : 0
  const total = base + extra
  return total > 0 ? { left: total } : undefined
}

function convertListItem(
  li: HTMLElement,
  ordered: boolean,
  depth: number,
  ctx: BlockContext,
  state: ConverterState,
  orderedInstance?: number,
): DocxBlock[] {
  const level = Math.min(depth, MAX_LIST_LEVEL)
  // Allocate the numbering instance once per item (all paragraphs of one
  // <li> belong to the same list).
  const instance = ordered
    ? (orderedInstance ?? state.nextOrderedInstance++)
    : undefined
  const listProps = () => ordered
    ? {
      numbering: {
        reference: ORDERED_LIST_REFERENCE,
        level,
        instance,
      },
    }
    : { bullet: { level } }
  const blocks: DocxBlock[] = []
  let runs: ParagraphChild[] = []

  const flushRuns = () => {
    if (runs.length === 0) return
    blocks.push(new Paragraph({
      children: runs,
      ...listProps(),
      indent: quoteIndent(ctx),
      alignment: ctx.align,
    }))
    runs = []
  }

  for (const node of li.childNodes) {
    try {
      if (textNode(node)) {
        const text = collapseWhitespace(node.text)
        if (text.trim() || (text === ' ' && runs.length > 0)) {
          runs.push(buildTextRun(text, baseFormat(ctx)))
        }
        continue
      }
      if (!elementNode(node)) continue
      const tag = tagOf(node)

      if (tag === 'ul' || tag === 'ol') {
        flushRuns()
        blocks.push(...convertListItems(
          node,
          tag === 'ol',
          depth + 1,
          ctx,
          state,
          // A nested <ol> continues the enclosing ordered list.
          tag === 'ol' ? instance : undefined,
        ))
      } else if (tag === 'p') {
        flushRuns()
        const inner: ParagraphChild[] = []
        collectInline(node.childNodes, baseFormat(ctx), inner)
        if (inner.length > 0) {
          blocks.push(new Paragraph({
            children: inner,
            ...listProps(),
            indent: quoteIndent(ctx),
            alignment: paragraphAlign(ctx, node),
          }))
        }
      } else if (isBlockTag(tag)) {
        flushRuns()
        blocks.push(...convertBlocks(node.childNodes, {
          ...ctx,
          align: styleAlign(node) ?? ctx.align,
        }, state))
      } else {
        collectInline([node], baseFormat(ctx), runs)
      }
    } catch {
      // Skip malformed list item content.
    }
  }
  flushRuns()

  // Guarantee at least one list paragraph so the item marker is kept.
  if (blocks.length === 0) {
    blocks.push(new Paragraph({
      children: [],
      ...listProps(),
    }))
  }
  return blocks
}

function convertListItems(
  listEl: HTMLElement,
  ordered: boolean,
  depth: number,
  ctx: BlockContext,
  state: ConverterState,
  orderedInstance?: number,
): DocxBlock[] {
  const level = Math.min(depth, MAX_LIST_LEVEL)
  // Allocate the numbering instance once per list (not per paragraph).
  const instance = ordered
    ? (orderedInstance ?? state.nextOrderedInstance++)
    : undefined
  const listProps = () => ordered
    ? {
      numbering: {
        reference: ORDERED_LIST_REFERENCE,
        level,
        instance,
      },
    }
    : { bullet: { level } }
  const blocks: DocxBlock[] = []
  for (const node of listEl.childNodes) {
    try {
      if (textNode(node)) {
        // Bare text inside <ul>/<ol>: treat as a plain item (best-effort).
        const text = collapseWhitespace(node.text).trim()
        if (text) {
          blocks.push(new Paragraph({
            children: [buildTextRun(text, baseFormat(ctx))],
            ...listProps(),
          }))
        }
        continue
      }
      if (!elementNode(node)) continue
      const tag = tagOf(node)
      if (tag === 'ul') {
        blocks.push(...convertListItems(node, false, depth + 1, ctx, state))
      } else if (tag === 'ol') {
        blocks.push(...convertListItems(
          node,
          true,
          depth + 1,
          ctx,
          state,
          // Nested <ol> inside <ol> continues the same list instance.
          instance,
        ))
      } else {
        // <li> or any stray element: treated as a list item.
        blocks.push(...convertListItem(node, ordered, depth, ctx, state, orderedInstance))
      }
    } catch {
      // Skip malformed list nodes.
    }
  }
  return blocks
}

function convertTable(tableEl: HTMLElement, state: ConverterState): DocxBlock {
  const rowEls: HTMLElement[] = []
  for (const node of tableEl.childNodes) {
    if (!elementNode(node)) continue
    const tag = tagOf(node)
    if (tag === 'tr') {
      rowEls.push(node)
    } else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      for (const inner of node.childNodes) {
        if (elementNode(inner) && tagOf(inner) === 'tr') rowEls.push(inner)
      }
    }
  }

  const rows: TableRow[] = []
  for (const tr of rowEls) {
    const cells: TableCell[] = []
    for (const cellNode of tr.childNodes) {
      if (!elementNode(cellNode)) continue
      const cellTag = tagOf(cellNode)
      if (cellTag !== 'td' && cellTag !== 'th') continue
      // Cell width auto: content blocks only; keep cell-level alignment.
      const cellBlocks = convertBlocks(cellNode.childNodes, {
        align: styleAlign(cellNode),
      }, state)
      cells.push(new TableCell({
        children: cellBlocks.length > 0 ? cellBlocks : [new Paragraph('')],
      }))
    }
    // A row with no cells isn't written by docx; skip it.
    if (cells.length > 0) rows.push(new TableRow({ children: cells }))
  }

  if (rows.length === 0) return new Paragraph('')
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: DEFAULT_TABLE_BORDERS,
    rows,
  })
}

function horizontalRuleParagraph(): Paragraph {
  return new Paragraph({
    children: [],
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'auto', space: 1 },
    },
  })
}

/** Convert block-level siblings into docx paragraphs/tables, in order. */
function convertBlocks(
  nodes: readonly unknown[],
  ctx: BlockContext,
  state: ConverterState,
): DocxBlock[] {
  const out: DocxBlock[] = []
  for (const node of nodes) {
    try {
      if (textNode(node)) {
        let text = collapseWhitespace(node.text)
        if (out.length === 0) text = text.replace(/^ +/, '')
        if (!text.trim()) continue
        out.push(new Paragraph({
          children: [buildTextRun(text, baseFormat(ctx))],
          alignment: ctx.align,
          indent: quoteIndent(ctx),
        }))
        continue
      }
      if (!elementNode(node)) continue
      const el = node
      const tag = tagOf(el)

      if (TAGS_TO_IGNORE.has(tag)) continue

      if (tag in HEADING_MAP) {
        const runs: ParagraphChild[] = []
        collectInline(el.childNodes, baseFormat(ctx), runs)
        out.push(new Paragraph({
          heading: HEADING_MAP[tag],
          children: runs,
          alignment: paragraphAlign(ctx, el),
        }))
      } else if (tag === 'p') {
        const runs: ParagraphChild[] = []
        collectInline(el.childNodes, baseFormat(ctx), runs)
        out.push(new Paragraph({
          children: runs,
          alignment: paragraphAlign(ctx, el),
          indent: quoteIndent(ctx, el),
        }))
      } else if (tag === 'blockquote') {
        out.push(...convertBlocks(el.childNodes, {
          ...ctx,
          quote: true,
          align: styleAlign(el) ?? ctx.align,
        }, state))
      } else if (tag === 'ul') {
        out.push(...convertListItems(el, false, 0, ctx, state))
      } else if (tag === 'ol') {
        // New instance per top-level <ol>: numbering restarts at 1.
        out.push(...convertListItems(el, true, 0, ctx, state, state.nextOrderedInstance++))
      } else if (tag === 'li') {
        // Stray <li> outside any list: render as an item at level 0.
        out.push(...convertListItem(el, false, 0, ctx, state))
      } else if (tag === 'table') {
        out.push(convertTable(el, state))
      } else if (tag === 'hr') {
        out.push(horizontalRuleParagraph())
      } else if (tag === 'br') {
        // Bare <br> between blocks: blank line.
        out.push(new Paragraph({ children: [] }))
      } else if (tag === 'img') {
        const run = buildImageRun(el)
        if (run) {
          out.push(new Paragraph({
            children: [run],
            alignment: paragraphAlign(ctx, el),
          }))
        }
      } else {
        // Transparent containers (div/section/article/body/...) and unknown
        // tags: recurse when they hold block children, otherwise render
        // their inline content as a paragraph.
        const hasBlockChild = el.childNodes.some(
          (n) => elementNode(n) && isBlockTag(tagOf(n)),
        )
        if (hasBlockChild) {
          out.push(...convertBlocks(el.childNodes, {
            ...ctx,
            align: styleAlign(el) ?? ctx.align,
          }, state))
        } else {
          const runs: ParagraphChild[] = []
          // Process the element itself as inline so meaningful wrappers
          // (<a>, <strong>, <span style>, ...) keep their formatting.
          collectInline([el], baseFormat(ctx), runs)
          if (runs.length > 0) {
            out.push(new Paragraph({
              children: runs,
              alignment: paragraphAlign(ctx, el),
              indent: quoteIndent(ctx, el),
            }))
          }
        }
      }
    } catch {
      // Skip malformed block nodes, never throw.
    }
  }
  return out
}

/**
 * Convert edited HTML into a real .docx file (A4, 1440-twip margins,
 * Calibri 11pt defaults, ordered-list numbering config).
 */
export async function htmlToDocxBuffer(html: string): Promise<Buffer> {
  const source = typeof html === 'string' ? html : ''
  let root: HTMLElement
  try {
    root = parse(source, { lowerCaseTagName: true })
  } catch {
    root = parse('', { lowerCaseTagName: true })
  }

  let blocks: DocxBlock[]
  try {
    blocks = convertBlocks(root.childNodes, {}, { nextOrderedInstance: 0 })
  } catch {
    blocks = []
  }
  // A body with at least one block element keeps the document valid.
  if (blocks.length === 0) blocks.push(new Paragraph(''))

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22 }, // 22 half-points = 11pt
        },
        heading1: {
          run: { color: '1F2937', size: 32, bold: true },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
        heading2: {
          run: { color: '1F2937', size: 28, bold: true },
          paragraph: { spacing: { before: 220, after: 110 } },
        },
        heading3: {
          run: { color: '1F2937', size: 25, bold: true },
          paragraph: { spacing: { before: 200, after: 100 } },
        },
        heading4: {
          run: { color: '1F2937', size: 23, bold: true },
          paragraph: { spacing: { before: 180, after: 90 } },
        },
      },
    },
    numbering: {
      config: [{ reference: ORDERED_LIST_REFERENCE, levels: ORDERED_LEVELS }],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4 in twips
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: blocks,
      },
    ],
  })

  return Packer.toBuffer(doc)
}
