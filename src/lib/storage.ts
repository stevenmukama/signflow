import { mkdir } from 'fs/promises'
import path from 'path'

export const STORAGE_ROOT = path.join(process.cwd(), 'storage')
export const DOCUMENTS_DIR = path.join(STORAGE_ROOT, 'documents')

export async function ensureDocumentsDir(): Promise<void> {
  await mkdir(DOCUMENTS_DIR, { recursive: true })
}

export function docFilePath(id: string, ext: string): string {
  return path.join(DOCUMENTS_DIR, `${id}.${ext}`)
}

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const PDF_MIME = 'application/pdf'

export function mimeForType(type: string): string {
  return type === 'pdf' ? PDF_MIME : DOCX_MIME
}

/**
 * Remove characters that cannot be encoded in the WinAnsi charset used by
 * pdf-lib standard fonts, so drawText never throws.
 */
const WINANSI_EXTRA = new Set(
  [
    '\u2018', '\u2019', '\u201A', '\u201C', '\u201D', '\u201E', '\u2013',
    '\u2014', '\u2022', '\u2026', '\u20AC', '\u2122', '\u0160', '\u0161',
    '\u0152', '\u0153', '\u0178', '\u017D', '\u017E', '\u0192', '\u02C6',
    '\u02DC', '\u2039', '\u203A', '\u2020', '\u2021', '\u2030',
  ],
)

export function sanitizeWinAnsi(text: string): string {
  let out = ''
  for (const ch of text.replace(/\t/g, '    ')) {
    const code = ch.codePointAt(0) ?? 0
    const ok =
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      WINANSI_EXTRA.has(ch)
    out += ok ? ch : '?'
  }
  return out
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0.07, g: 0.09, b: 0.15 }
  const int = parseInt(m[1], 16)
  return {
    r: ((int >> 16) & 255) / 255,
    g: ((int >> 8) & 255) / 255,
    b: (int & 255) / 255,
  }
}
