import type { Document as DocumentRow } from '@prisma/client'
import type { DocumentDetail, DocumentDto, PageOps, PdfEditItem } from '@/lib/types'

/** Map a Prisma Document row to the public DTO used by the frontend. */
export function documentToDto(d: DocumentRow): DocumentDto {
  let signed = false
  if (d.edits) {
    if (d.type === 'pdf') {
      signed = d.edits.includes('"kind":"signature"')
    } else {
      // DOCX editor marks inserted signature images with data-signature="1"
      signed = d.edits.includes('data-signature="1"')
    }
  }
  return {
    id: d.id,
    name: d.name,
    type: d.type === 'pdf' ? 'pdf' : 'docx',
    size: d.size,
    hasEdits: Boolean(d.edits),
    signed,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }
}

/** Parse the stored `edits` column: PDF → PdfEditItem[] | { items: PdfEditItem[]; pageOps?: PageOps }, DOCX → HTML string. */
export function parseEdits(
  d: DocumentRow,
): DocumentDetail['edits'] {
  if (!d.edits) return null
  if (d.type === 'docx') return d.edits
  try {
    const parsed = JSON.parse(d.edits)
    if (Array.isArray(parsed)) return parsed as PdfEditItem[]
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      return parsed as { items: PdfEditItem[]; pageOps?: PageOps }
    }
    return null
  } catch {
    return null
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
