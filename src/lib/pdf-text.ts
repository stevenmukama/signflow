import type { Color, PDFFont, PDFPage } from 'pdf-lib'

import { isWinAnsiChar } from './storage'

export interface PdfTextFonts {
  /** Main font (Helvetica) — covers WinAnsi / Latin-1. */
  text: PDFFont
  /** Fallback symbol font (ZapfDingbats) — covers ✓ ✔ ✗ ✘ ★ ● ➔ and other dingbats. */
  symbol: PDFFont
}

/** Split `line` into consecutive runs that can each be drawn with a single font. */
function splitIntoFontRuns(line: string, fonts: PdfTextFonts): { text: string; font: PDFFont }[] {
  const runs: { text: string; font: PDFFont }[] = []
  for (const raw of line.replace(/\t/g, '    ')) {
    let ch = raw
    let font = fonts.text
    if (!isWinAnsiChar(ch)) {
      if (canEncode(fonts.symbol, ch)) {
        font = fonts.symbol
      } else {
        ch = '?' // not representable in any embedded standard font
      }
    }
    const last = runs[runs.length - 1]
    if (last && last.font === font) last.text += ch
    else runs.push({ text: ch, font })
  }
  return runs
}

function canEncode(font: PDFFont, ch: string): boolean {
  try {
    font.encodeText(ch)
    return true
  } catch {
    return false
  }
}

/**
 * Draw a single line of text, switching to the symbol font for characters the
 * main font cannot encode (e.g. the ✓ inserted by the "Checkmark" tool),
 * instead of replacing them with "?".
 */
export function drawTextLine(
  page: PDFPage,
  line: string,
  opts: { x: number; y: number; size: number; color: Color; fonts: PdfTextFonts },
): void {
  let x = opts.x
  for (const run of splitIntoFontRuns(line, opts.fonts)) {
    page.drawText(run.text, { x, y: opts.y, size: opts.size, font: run.font, color: opts.color })
    x += run.font.widthOfTextAtSize(run.text, opts.size)
  }
}
