import { NextRequest, NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { serveFile } from '@/lib/serve-file'
import { mimeForType, resolveDocumentFilePath } from '@/lib/storage'

export const runtime = 'nodejs'

/** GET /api/documents/[id]/file — serve the current (edited) file inline. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const doc = await db.document.findUnique({ where: { id } })
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }
  const filePath = resolveDocumentFilePath(doc)
  return serveFile(filePath, mimeForType(doc.type), {
    downloadName: doc.name,
  })
}
