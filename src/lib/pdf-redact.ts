import path from 'path'
import { PDFDocument } from 'pdf-lib'

/** A redaction rectangle in fractions of the rendered page (origin top-left), as stored by the editor. */
export interface RedactionBox {
  x: number
  y: number
  w: number
  h: number
}

/** Resolution used to rasterize redacted pages (sharp enough to read and print). */
const RENDER_DPI = 200
/** Upper bound for the longest edge of a rasterized page, to cap memory on huge pages. */
const MAX_EDGE_PX = 5000
const REDACTION_FILL = '#111117'

const PDFJS_ROOT = path.join(process.cwd(), 'node_modules', 'pdfjs-dist')

/**
 * Truly redact `pdfBytes`.
 *
 * Simply drawing a black rectangle (what this app did before) leaves the text,
 * images and vector content underneath in the file, where it can still be
 * selected, copied or extracted. Instead, every page that has at least one
 * redaction box is:
 *   1. rendered to a bitmap with pdf.js,
 *   2. painted over with opaque boxes in the bitmap itself,
 *   3. replaced by a new page that contains only that bitmap.
 * Finally the document is rebuilt with `copyPages`, which copies only objects
 * reachable from the pages. Without this step pdf-lib would still write the
 * removed pages' content streams into the file as orphaned objects.
 *
 * Trade-offs: redacted pages become images (no text selection on those pages),
 * and document-level data such as bookmarks, form definitions and metadata is
 * dropped when any redaction is applied, since it may contain redacted text.
 * Pages without redactions keep their vector content.
 */
export async function applyRedactions(
  pdfBytes: Uint8Array,
  boxesByPage: ReadonlyMap<number, readonly RedactionBox[]>,
): Promise<Uint8Array> {
  if (boxesByPage.size === 0) return pdfBytes

  const rasters = await rasterizeRedactedPages(pdfBytes, boxesByPage)

  const work = await PDFDocument.load(pdfBytes)
  for (const [pageIndex, raster] of rasters) {
    const image = await work.embedPng(raster.png)
    work.removePage(pageIndex)
    const page = work.insertPage(pageIndex, [raster.widthPt, raster.heightPt])
    page.drawImage(image, { x: 0, y: 0, width: raster.widthPt, height: raster.heightPt })
  }

  const clean = await PDFDocument.create()
  const pages = await clean.copyPages(work, work.getPageIndices())
  for (const page of pages) clean.addPage(page)
  return clean.save()
}

interface PageRaster {
  png: Uint8Array
  /** Visible page size in PDF points (crop box, rotation applied) — same frame the editor uses. */
  widthPt: number
  heightPt: number
}

async function rasterizeRedactedPages(
  pdfBytes: Uint8Array,
  boxesByPage: ReadonlyMap<number, readonly RedactionBox[]>,
): Promise<Map<number, PageRaster>> {
  // Loaded lazily: these are heavy and only needed when a redaction is applied.
  const canvasMod = await import('@napi-rs/canvas')
  const { createCanvas } = canvasMod
  if (!(globalThis as unknown as { DOMMatrix?: unknown }).DOMMatrix && canvasMod.DOMMatrix) {
    ;(globalThis as unknown as { DOMMatrix?: unknown }).DOMMatrix = canvasMod.DOMMatrix
  }
  if (!(globalThis as unknown as { Path2D?: unknown }).Path2D && canvasMod.Path2D) {
    ;(globalThis as unknown as { Path2D?: unknown }).Path2D = canvasMod.Path2D
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const task = getDocument({
    // pdf.js may transfer (detach) the buffer it is given, so pass a copy.
    data: pdfBytes.slice(),
    standardFontDataUrl: path.join(PDFJS_ROOT, 'standard_fonts') + path.sep,
    cMapUrl: path.join(PDFJS_ROOT, 'cmaps') + path.sep,
    cMapPacked: true,
  })

  const rasters = new Map<number, PageRaster>()
  try {
    const pdf = await task.promise
    for (const [pageIndex, boxes] of boxesByPage) {
      if (pageIndex < 0 || pageIndex >= pdf.numPages || boxes.length === 0) continue
      const page = await pdf.getPage(pageIndex + 1)
      // Default viewport applies the page's /Rotate and crop box, matching the editor's frame.
      const base = page.getViewport({ scale: 1 })
      let scale = RENDER_DPI / 72
      const longestPx = Math.max(base.width, base.height) * scale
      if (longestPx > MAX_EDGE_PX) scale *= MAX_EDGE_PX / longestPx
      const viewport = page.getViewport({ scale })

      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise

      // Burn the boxes into the bitmap. Expand by 1px so anti-aliased edges never leak.
      ctx.fillStyle = REDACTION_FILL
      for (const b of boxes) {
        const x = Math.floor(b.x * canvas.width) - 1
        const y = Math.floor(b.y * canvas.height) - 1
        const w = Math.ceil(b.w * canvas.width) + 2
        const h = Math.ceil(b.h * canvas.height) + 2
        ctx.fillRect(x, y, w, h)
      }

      rasters.set(pageIndex, {
        png: await canvas.encode('png'),
        widthPt: base.width,
        heightPt: base.height,
      })
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  return rasters
}
