import { unlink } from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { documentToDto, parseEdits } from '@/lib/documents'
import { sanitizeDocxHtml } from '@/lib/html-sanitizer'
import { resolveDocumentFilePath, resolveDocumentOriginalPath } from '@/lib/storage'

export const runtime = 'nodejs'

/** GET /api/documents/[id] — document detail including parsed edits. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const doc = await db.document.findUnique({ where: { id } })
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }
  const edits = parseEdits(doc)
  return NextResponse.json({
    ...documentToDto(doc),
    // DOCX edits are HTML that the editor injects into the page — sanitize on the way out.
    edits: typeof edits === 'string' ? sanitizeDocxHtml(edits) : edits,
  })
}

/** PATCH /api/documents/[id] — rename document. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const doc = await db.document.findUnique({ where: { id } })
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const name =
    typeof (body as { name?: unknown })?.name === 'string'
      ? (body as { name: string }).name.trim().slice(0, 180)
      : ''
  if (!name) {
    return NextResponse.json({ error: 'Document name cannot be empty' }, { status: 400 })
  }

  try {
    const updated = await db.document.update({
      where: { id },
      data: { name },
    })
    return NextResponse.json(documentToDto(updated))
  } catch {
    return NextResponse.json({ error: 'Failed to update document name' }, { status: 500 })
  }
}

/** DELETE /api/documents/[id] — remove row + files from disk. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const doc = await db.document.findUnique({ where: { id } })
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }
  const origPath = resolveDocumentOriginalPath(doc)
  const fPath = resolveDocumentFilePath(doc)
  await Promise.allSettled([
    unlink(origPath),
    fPath !== origPath ? unlink(fPath) : Promise.resolve(),
  ])
  await db.document.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
