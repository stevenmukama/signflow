import { writeFile, copyFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { documentToDto } from '@/lib/documents'
import { docFilePath, originalDocFilePath, ensureDocumentsDir } from '@/lib/storage'

export const runtime = 'nodejs'

const MAX_SIZE = 25 * 1024 * 1024 // 25 MB

/** GET /api/documents — list all documents (newest first). */
export async function GET() {
  const docs = await db.document.findMany({ orderBy: { updatedAt: 'desc' } })
  return NextResponse.json(docs.map(documentToDto))
}

/** POST /api/documents — multipart upload of a .pdf or .docx file. */
export async function POST(req: NextRequest) {
  let file: File | null = null
  try {
    const form = await req.formData()
    file = form.get('file') as File | null
  } catch {
    return NextResponse.json(
      { error: 'Invalid upload — expected multipart form data' },
      { status: 400 },
    )
  }

  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const lower = file.name.toLowerCase()
  const type = lower.endsWith('.pdf') ? 'pdf' : lower.endsWith('.docx') ? 'docx' : null
  if (!type) {
    return NextResponse.json(
      { error: 'Only .pdf and .docx files are supported' },
      { status: 400 },
    )
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'The file is empty' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: 'File is too large (maximum 25 MB)' },
      { status: 413 },
    )
  }

  await ensureDocumentsDir()
  const id = randomUUID()
  const originalPath = originalDocFilePath(id, type)
  const filePath = docFilePath(id, type)
  try {
    const bytes = Buffer.from(await file.arrayBuffer())
    await writeFile(originalPath, bytes)
    await copyFile(originalPath, filePath)
    const row = await db.document.create({
      data: {
        id,
        name: path.basename(file.name).slice(0, 180) || `document.${type}`,
        type,
        size: file.size,
        originalPath,
        filePath,
      },
    })
    return NextResponse.json(documentToDto(row), { status: 201 })
  } catch (err) {
    console.error('upload failed', err)
    return NextResponse.json(
      { error: 'Could not store the uploaded file' },
      { status: 500 },
    )
  }
}
