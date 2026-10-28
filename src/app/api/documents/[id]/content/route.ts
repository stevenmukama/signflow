import { readFile } from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import mammoth from 'mammoth'
import { db } from '@/lib/db'
import { sanitizeDocxHtml } from '@/lib/html-sanitizer'
import { resolveDocumentOriginalPath } from '@/lib/storage'

export const runtime = 'nodejs'

/**
 * GET /api/documents/[id]/content
 * Returns the HTML for the DOCX editor. If the user previously saved edits,
 * the stored edited HTML is returned as-is; otherwise the original file is
 * converted with mammoth (images inlined as base64 data URLs).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    const doc = await db.document.findUnique({ where: { id } })
    if (!doc || doc.type !== 'docx') {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Previously saved edited HTML wins over a fresh conversion.
    // Sanitized on read as well, so rows stored before sanitization existed are safe.
    if (typeof doc.edits === 'string' && doc.edits.length > 0) {
      return NextResponse.json({ html: sanitizeDocxHtml(doc.edits) })
    }

    const sourcePath = resolveDocumentOriginalPath(doc)
    const buffer = await readFile(sourcePath)
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => ({
          src: 'data:' + image.contentType + ';base64,' + await image.readAsBase64String(),
        })),
      },
    )
    // A crafted .docx can carry e.g. javascript: hyperlinks through mammoth.
    return NextResponse.json({ html: sanitizeDocxHtml(result.value) })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load document content' },
      { status: 500 },
    )
  }
}
