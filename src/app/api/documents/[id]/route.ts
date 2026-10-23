import { unlink } from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { documentToDto, parseEdits } from '@/lib/documents'

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
  return NextResponse.json({
    ...documentToDto(doc),
    edits: parseEdits(doc),
  })
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
  await Promise.allSettled([unlink(doc.originalPath), unlink(doc.filePath)])
  await db.document.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
