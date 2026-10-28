import { writeFile } from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { htmlToDocxBuffer } from '@/lib/docx-converter'
import { sanitizeDocxHtml } from '@/lib/html-sanitizer'
import { resolveDocumentFilePath } from '@/lib/storage'

export const runtime = 'nodejs'

const bodySchema = z.object({ html: z.string() })

/**
 * POST /api/documents/[id]/docx-save
 * Body: { html } — renders the edited HTML back into a real .docx file,
 * overwrites the processed file on disk and persists the edited HTML.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    const doc = await db.document.findUnique({ where: { id } })
    if (!doc || doc.type !== 'docx') {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Field "html" (string) is required' },
        { status: 400 },
      )
    }

    const targetPath = resolveDocumentFilePath(doc)
    // Never persist untrusted markup: this HTML is later injected into the editor.
    const html = sanitizeDocxHtml(parsed.data.html)
    const buffer = await htmlToDocxBuffer(html)
    await writeFile(targetPath, buffer)
    await db.document.update({
      where: { id },
      data: { edits: html, size: buffer.byteLength, filePath: targetPath },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save document' },
      { status: 500 },
    )
  }
}
