import { NextRequest, NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { serveFile } from '@/lib/serve-file'
import { mimeForType, resolveDocumentOriginalPath } from '@/lib/storage'

export const runtime = 'nodejs'

/** GET /api/documents/[id]/original — serve the pristine uploaded file (editors use this so overlays are not double-baked). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const doc = await db.document.findUnique({ where: { id } })
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }
  const originalPath = resolveDocumentOriginalPath(doc)
  return serveFile(originalPath, mimeForType(doc.type))
}
