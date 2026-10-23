import { writeFile } from 'fs/promises'
import { readFile } from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import {
  BlendMode,
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib'

import { db } from '@/lib/db'
import { documentToDto } from '@/lib/documents'
import { hexToRgb, sanitizeWinAnsi } from '@/lib/storage'
import type { PdfEditItem } from '@/lib/types'

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
  for (const it of raw) {
    if (!it || typeof it !== 'object') return null
    const o = it as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.slice(0, 64) : null
    const page = typeof o.page === 'number' && Number.isInteger(o.page) && o.page >= 0 ? o.page : null
    if (!id || page === null) return null
    if (o.kind === 'text') {
      items.push({
        id,
        kind: 'text',
        page,
        x: clamp01(o.x),
        y: clamp01(o.y),
        text: typeof o.text === 'string' ? o.text.slice(0, 2000) : '',
        fontSize: Math.min(96, Math.max(6, typeof o.fontSize === 'number' ? o.fontSize : 14)),
        color: typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : '#111827',
      })
    } else if (o.kind === 'signature') {
      if (typeof o.dataUrl !== 'string' || !o.dataUrl.startsWith('data:image/png')) return null
      if (o.dataUrl.length > 2_500_000) return null
      items.push({
        id,
        kind: 'signature',
        page,
        x: clamp01(o.x),
        y: clamp01(o.y),
        w: clamp01(o.w, 0.25),
        aspect: typeof o.aspect === 'number' && o.aspect > 0 ? Math.min(5, o.aspect) : 0.4,
        dataUrl: o.dataUrl,
      })
    } else if (o.kind === 'highlight' || o.kind === 'blackout') {
      items.push({
        id,
        kind: o.kind,
        page,
        x: clamp01(o.x),
        y: clamp01(o.y),
        w: clamp01(o.w),
        h: clamp01(o.h),
      })
    } else {
      return null
    }
  }
  return items
}

/** POST /api/documents/[id]/pdf-save — apply edit items onto the ORIGINAL pdf and persist the flattened result. */
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

  let body: { items?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const items = parseItems(body.items)
  if (items === null) {
    return NextResponse.json({ error: 'Invalid edit items' }, { status: 400 })
  }

  try {
    const original = await readFile(doc.originalPath)
    const pdf = await PDFDocument.load(original)
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const pages = pdf.getPages()

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
        const lines = sanitizeWinAnsi(item.text).split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i]) continue
          page.drawText(lines[i], {
            x: item.x * pw,
            y:
              ph -
              item.y * ph -
              BASELINE_OFFSET * item.fontSize -
              i * item.fontSize * TEXT_LINE_HEIGHT,
            size: item.fontSize,
            font,
            color: rgb(r, g, b),
          })
        }
      } else if (item.kind === 'signature') {
        const img = await embed(item.dataUrl)
        const w = item.w * pw
        const h = w * item.aspect
        page.drawImage(img, {
          x: item.x * pw,
          y: ph - item.y * ph - h,
          width: w,
          height: h,
        })
      } else if (item.kind === 'highlight') {
        page.drawRectangle({
          x: item.x * pw,
          y: ph - (item.y + item.h) * ph,
          width: item.w * pw,
          height: item.h * ph,
          color: rgb(1, 0.87, 0.34),
          opacity: 0.45,
          blendMode: BlendMode.Multiply,
        })
      } else {
        page.drawRectangle({
          x: item.x * pw,
          y: ph - (item.y + item.h) * ph,
          width: item.w * pw,
          height: item.h * ph,
          color: rgb(0.07, 0.07, 0.09),
          opacity: 1,
        })
      }
    }

    const out = await pdf.save()
    await writeFile(doc.filePath, out)
    const updated = await db.document.update({
      where: { id },
      data: {
        edits: JSON.stringify(items),
        size: out.byteLength,
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
