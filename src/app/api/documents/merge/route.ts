import { copyFile, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'

import { db } from '@/lib/db'
import { documentToDto } from '@/lib/documents'
import {
  docFilePath,
  ensureDocumentsDir,
  originalDocFilePath,
  resolveDocumentFilePath,
} from '@/lib/storage'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  let body: { documentIds?: unknown; name?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request' }, { status: 400 })
  }

  if (!Array.isArray(body.documentIds) || body.documentIds.length < 2) {
    return NextResponse.json(
      { error: 'Please select at least 2 documents to merge.' },
      { status: 400 },
    )
  }

  if (body.documentIds.length > 50) {
    return NextResponse.json(
      { error: 'Maximum 50 documents can be merged at once.' },
      { status: 400 },
    )
  }

  const ids = body.documentIds.filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0,
  )
  if (ids.length < 2) {
    return NextResponse.json({ error: 'Invalid document IDs provided.' }, { status: 400 })
  }

  // Fetch all documents
  const docs = await db.document.findMany({
    where: { id: { in: ids } },
  })
  const docMap = new Map(docs.map((d) => [d.id, d]))

  // Preserve requested order and ensure all exist
  const orderedDocs: typeof docs = []
  for (const id of ids) {
    const doc = docMap.get(id)
    if (!doc) {
      return NextResponse.json(
        { error: `Document with ID "${id}" was not found.` },
        { status: 404 },
      )
    }
    if (doc.type !== 'pdf') {
      return NextResponse.json(
        { error: `Document "${doc.name}" is not a PDF. Only PDF files can be merged.` },
        { status: 400 },
      )
    }
    orderedDocs.push(doc)
  }

  try {
    const mergedPdf = await PDFDocument.create()

    for (const doc of orderedDocs) {
      const filePath = resolveDocumentFilePath(doc)
      const fileBytes = await readFile(filePath)
      const srcPdf = await PDFDocument.load(fileBytes, { ignoreEncryption: true })
      const pageIndices = srcPdf.getPageIndices()
      const copiedPages = await mergedPdf.copyPages(srcPdf, pageIndices)
      for (const page of copiedPages) {
        mergedPdf.addPage(page)
      }
    }

    const mergedBytes = await mergedPdf.save()

    await ensureDocumentsDir()
    const newId = randomUUID()
    const rawName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : ''
    let finalName = rawName
    if (!finalName) {
      finalName = `Merged_${orderedDocs[0].name.replace(/\.pdf$/i, '')}_+_${orderedDocs.length - 1}_more.pdf`
    }
    if (!finalName.toLowerCase().endsWith('.pdf')) {
      finalName += '.pdf'
    }
    finalName = path.basename(finalName).slice(0, 180)

    const originalPath = originalDocFilePath(newId, 'pdf')
    const filePath = docFilePath(newId, 'pdf')

    await writeFile(originalPath, mergedBytes)
    await copyFile(originalPath, filePath)

    const newDoc = await db.document.create({
      data: {
        id: newId,
        name: finalName,
        type: 'pdf',
        size: mergedBytes.byteLength,
        originalPath,
        filePath,
        edits: null,
      },
    })

    return NextResponse.json({
      ok: true,
      document: documentToDto(newDoc),
      pageCount: mergedPdf.getPageCount(),
    })
  } catch (err) {
    console.error('Merge failed:', err)
    const msg = err instanceof Error ? err.message : String(err)
    const friendly = msg.toLowerCase().includes('encrypt')
      ? 'One of the PDFs is password-protected and cannot be merged'
      : 'Failed to merge the selected documents'
    return NextResponse.json({ error: friendly }, { status: 500 })
  }
}
