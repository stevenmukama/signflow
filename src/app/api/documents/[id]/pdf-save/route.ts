import { existsSync } from 'fs'
import { copyFile, readFile, writeFile } from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import {
  BlendMode,
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib'

import { db } from '@/lib/db'
import { documentToDto } from '@/lib/documents'
import { applyRedactions, type RedactionBox } from '@/lib/pdf-redact'
import { drawTextLine } from '@/lib/pdf-text'
import {
  hexToRgb,
  originalDocFilePath,
  resolveDocumentFilePath,
  resolveDocumentOriginalPath,
} from '@/lib/storage'
import type { PageOps, PdfEditItem } from '@/lib/types'

export const runtime = 'nodejs'

const TEXT_LINE_HEIGHT = 1.25
const BASELINE_OFFSET = 0.88 // fraction of font size from the top of the line box to the baseline

function clamp01(n: unknown, fallback = 0): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback
  return Math.min(1, Math.max(0, v))
}

/** Lightweight validation of incoming edit items. */
function parseItems(raw: unknown): PdfEditItem[] | null {
  if (!Array.isArray(raw) || raw.length > 500) return null
  const items: PdfEditItem[] = []
  for (const rawItem of raw) {
    if (!rawItem || typeof rawItem !== 'object') return null
    const it = rawItem as Record<string, unknown>
    const id = typeof it.id === 'string' && it.id ? it.id : crypto.randomUUID()
    const page = typeof it.page === 'number' && Number.isInteger(it.page) && it.page >= 0 ? it.page : 0
    const x = clamp01(it.x)
    const y = clamp01(it.y)

    if (it.kind === 'text') {
      const text = typeof it.text === 'string' ? it.text : ''
      const fontSize = typeof it.fontSize === 'number' && it.fontSize > 0 ? it.fontSize : 14
      const color = typeof it.color === 'string' && /^#[0-9a-f]{6}$/i.test(it.color) ? it.color : '#111827'
      items.push({ id, kind: 'text', page, x, y, text, fontSize, color })
    } else if (it.kind === 'signature') {
      const w = clamp01(it.w, 0.25)
      const h = typeof it.h === 'number' && Number.isFinite(it.h) && it.h > 0 ? clamp01(it.h) : undefined
      const aspect = typeof it.aspect === 'number' && it.aspect > 0 ? it.aspect : 0.4
      const dataUrl = typeof it.dataUrl === 'string' && it.dataUrl.startsWith('data:image/') ? it.dataUrl : ''
      if (!dataUrl) return null
      items.push({ id, kind: 'signature', page, x, y, w, ...(h !== undefined ? { h } : {}), aspect, dataUrl })
    } else if (it.kind === 'highlight' || it.kind === 'blackout') {
      const w = clamp01(it.w, 0.1)
      const h = clamp01(it.h, 0.05)
      const color =
        it.kind === 'highlight' && typeof it.color === 'string' && /^#[0-9a-f]{6}$/i.test(it.color)
          ? it.color
          : undefined
      items.push({ id, kind: it.kind, page, x, y, w, h, ...(color ? { color } : {}) })
    } else {
      return null
    }
  }
  return items
}

function parsePageOps(raw: unknown): PageOps | null {
  if (!raw || typeof raw !== 'object') return null
  const it = raw as Record<string, unknown>
  if (!Array.isArray(it.order) || it.order.length === 0 || it.order.length > 2000) return null
  const order: number[] = []
  for (const n of it.order) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null
    order.push(n)
  }
  const rotations: Record<number, number> = {}
  if (it.rotations && typeof it.rotations === 'object') {
    for (const [k, v] of Object.entries(it.rotations)) {
      const idx = parseInt(k, 10)
      if (Number.isInteger(idx) && typeof v === 'number' && Number.isFinite(v)) {
        rotations[idx] = ((v % 360) + 360) % 360
      }
    }
  }
  return { order, rotations }
}

/**
 * POST /api/documents/[id]/pdf-save
 * Body: { items: PdfEditItem[], pageOps?: PageOps }
 * Reads the pristine uploaded PDF (so edits never double-bake), applies page
 * reorganizations (order, rotations, deletions), burns all text,
 * signatures and highlights into it via pdf-lib, then applies blackout boxes as
 * true redactions (see applyRedactions), writes the resulting file to disk, and
 * stores the serialized edits in the database row for re-editing.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const doc = await db.document.findUnique({ where: { id } })
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }
  if (doc.type !== 'pdf') {
    return NextResponse.json({ error: 'Not a PDF document' }, { status: 400 })
  }

  let body: { items?: unknown; pageOps?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const items = parseItems(body.items)
  if (items === null) {
    return NextResponse.json({ error: 'Invalid edit items' }, { status: 400 })
  }
  const pageOps = body.pageOps ? parsePageOps(body.pageOps) : null

  try {
    const resolvedFilePath = resolveDocumentFilePath(doc)
    let sourcePath = resolveDocumentOriginalPath(doc)
    const origTarget = originalDocFilePath(doc.id, doc.type)

    // Ensure pristine original exists
    if (!existsSync(origTarget) && existsSync(sourcePath)) {
      try {
        await copyFile(sourcePath, origTarget)
        sourcePath = origTarget
        await db.document.update({
          where: { id },
          data: { originalPath: origTarget, filePath: resolvedFilePath },
        })
      } catch (err) {
        console.warn('Could not initialize originalPath backup', err)
      }
    }

    const original = await readFile(sourcePath)
    const sourcePdf = await PDFDocument.load(original)
    const sourceNumPages = sourcePdf.getPageCount()

    let pdf: PDFDocument
    if (pageOps && pageOps.order.length > 0) {
      const valid = pageOps.order.every((idx) => idx >= 0 && idx < sourceNumPages)
      if (!valid) {
        return NextResponse.json({ error: 'Invalid page operations indices' }, { status: 400 })
      }
      pdf = await PDFDocument.create()
      for (let i = 0; i < pageOps.order.length; i++) {
        const origIdx = pageOps.order[i]
        const addRot = pageOps.rotations?.[i] ?? 0
        const srcPage = sourcePdf.getPage(origIdx)
        const srcRot = ((srcPage.getRotation().angle % 360) + 360) % 360
        const totalRot = ((srcRot + addRot) % 360 + 360) % 360

        if (totalRot === 0) {
          const [copied] = await pdf.copyPages(sourcePdf, [origIdx])
          copied.setRotation(degrees(0))
          pdf.addPage(copied)
        } else {
          const [embedded] = await pdf.embedPages([srcPage])
          const origW = srcPage.getWidth()
          const origH = srcPage.getHeight()
          let newW = origW
          let newH = origH
          let drawOpts: { x: number; y: number; rotate: ReturnType<typeof degrees> }

          if (totalRot === 90) {
            newW = origH
            newH = origW
            drawOpts = { x: 0, y: newH, rotate: degrees(-90) }
          } else if (totalRot === 180) {
            newW = origW
            newH = origH
            drawOpts = { x: newW, y: newH, rotate: degrees(-180) }
          } else {
            // 270 deg CW
            newW = origH
            newH = origW
            drawOpts = { x: newW, y: 0, rotate: degrees(-270) }
          }
          const newPage = pdf.addPage([newW, newH])
          newPage.drawPage(embedded, drawOpts)
        }
      }
    } else {
      pdf = sourcePdf
    }

    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const symbolFont = await pdf.embedFont(StandardFonts.ZapfDingbats)
    const pages = pdf.getPages()
    const redactions = new Map<number, RedactionBox[]>()

    // Embed each distinct signature PNG only once.
    const imageCache = new Map<string, PDFImage>()
    const embed = async (dataUrl: string): Promise<PDFImage> => {
      const cached = imageCache.get(dataUrl)
      if (cached) return cached
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      const img = await pdf.embedPng(Buffer.from(base64, 'base64'))
      imageCache.set(dataUrl, img)
      return img
    }

    for (const item of items) {
      const page: PDFPage | undefined = pages[item.page]
      if (!page) continue
      const pw = page.getWidth()
      const ph = page.getHeight()

      if (item.kind === 'text') {
        const { r, g, b } = hexToRgb(item.color)
        const lines = item.text.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i]) continue
          drawTextLine(page, lines[i], {
            x: item.x * pw,
            y:
              ph -
              item.y * ph -
              BASELINE_OFFSET * item.fontSize -
              i * item.fontSize * TEXT_LINE_HEIGHT,
            size: item.fontSize,
            color: rgb(r, g, b),
            fonts: { text: font, symbol: symbolFont },
          })
        }
      } else if (item.kind === 'signature') {
        const img = await embed(item.dataUrl)
        const w = item.w * pw
        const h = typeof item.h === 'number' && item.h > 0 ? item.h * ph : w * item.aspect
        page.drawImage(img, {
          x: item.x * pw,
          y: ph - item.y * ph - h,
          width: w,
          height: h,
        })
      } else if (item.kind === 'highlight') {
        const { r, g, b } = item.color ? hexToRgb(item.color) : { r: 1, g: 0.87, b: 0.34 }
        page.drawRectangle({
          x: item.x * pw,
          y: ph - (item.y + item.h) * ph,
          width: item.w * pw,
          height: item.h * ph,
          color: rgb(r, g, b),
          opacity: 0.45,
          blendMode: BlendMode.Multiply,
        })
      } else {
        // Blackout: collected here and applied after all other edits, so it also
        // covers any text/signature placed beneath it.
        const boxes = redactions.get(item.page) ?? []
        boxes.push({ x: item.x, y: item.y, w: item.w, h: item.h })
        redactions.set(item.page, boxes)
      }
    }

    const out = await applyRedactions(await pdf.save(), redactions)
    await writeFile(resolvedFilePath, out)
    const editsData = pageOps ? { items, pageOps } : items
    const updated = await db.document.update({
      where: { id },
      data: {
        edits: JSON.stringify(editsData),
        size: out.byteLength,
        filePath: resolvedFilePath,
      },
    })
    return NextResponse.json({ ok: true, document: documentToDto(updated) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('pdf-save failed:', message)
    const friendly = message.toLowerCase().includes('encrypt')
      ? 'This PDF is password-protected and cannot be edited'
      : 'Could not apply the edits to this PDF'
    return NextResponse.json({ error: friendly }, { status: 500 })
  }
}
