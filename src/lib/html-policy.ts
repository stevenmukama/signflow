/**
 * Shared HTML allowlist for the DOCX editor.
 *
 * Used by both the server sanitizer (sanitize-html, see html-sanitizer.ts) and
 * the browser sanitizer (DOMPurify, in docx-editor.tsx), so stored HTML and
 * HTML injected into the editor obey the same rules. Anything not listed here
 * (scripts, iframes, event handlers like onerror, javascript: URLs, ...) is
 * stripped. Keep this in sync with what docx-converter.ts can render.
 *
 * This module has no dependencies so it is safe to import from client code.
 */

export const ALLOWED_TAGS = [
  // blocks
  'p', 'div', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre',
  // lists
  'ul', 'ol', 'li',
  // tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  // inline formatting
  'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup',
  'code', 'mark', 'small', 'font', 'a',
  // media (data URLs only — enforced by the sanitizers)
  'img',
]

export const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  '*': ['style', 'class', 'title', 'dir', 'align'],
  a: ['href', 'name'],
  img: ['src', 'alt', 'width', 'height', 'data-signature'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  col: ['span'],
  colgroup: ['span'],
  ol: ['start', 'type', 'reversed'],
  // document.execCommand('fontSize' / 'foreColor' / 'fontName') emits <font>.
  font: ['size', 'color', 'face'],
}

/** URL schemes allowed in <a href>. */
export const ALLOWED_LINK_SCHEMES = ['http', 'https', 'mailto', 'tel']

/** True if `url` is an absolute link with an allowed scheme (used for the "Insert link" prompt). */
export function isSafeLinkUrl(url: string): boolean {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim())
  return !!m && ALLOWED_LINK_SCHEMES.includes(m[1].toLowerCase())
}

/** True if `src` is an inline raster/vector image data URL. */
export function isImageDataUrl(src: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(src.trim())
}
