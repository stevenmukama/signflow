import sanitizeHtml from 'sanitize-html'

import {
  ALLOWED_ATTRIBUTES,
  ALLOWED_LINK_SCHEMES,
  ALLOWED_TAGS,
  isImageDataUrl,
} from './html-policy'

const LENGTH = /^\d+(\.\d+)?(px|pt|em|rem|%)$/i
const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*[\d.%\s,]+\)$/i, /^[a-z]+$/i]

/** Only harmless, presentational CSS survives (no url(), expression(), position, ...). */
const ALLOWED_STYLES: sanitizeHtml.IOptions['allowedStyles'] = {
  '*': {
    'text-align': [/^(left|right|center|justify|start|end)$/i],
    color: COLOR,
    'background-color': COLOR,
    'font-size': [LENGTH, /^(x{0,2}-?small|medium|x{0,3}-?large)$/i],
    'font-weight': [/^(normal|bold|bolder|lighter|[1-9]00)$/i],
    'font-style': [/^(normal|italic|oblique)$/i],
    'text-decoration': [/^[a-z\s-]+$/i],
    'text-decoration-line': [/^[a-z\s-]+$/i],
    'vertical-align': [/^(baseline|middle|top|bottom|sub|super|text-top|text-bottom)$/i],
    display: [/^(inline|inline-block|block)$/i],
    width: [LENGTH, /^auto$/i],
    height: [LENGTH, /^auto$/i],
    'max-width': [LENGTH, /^none$/i],
    'margin-left': [LENGTH],
    'margin-right': [LENGTH],
    'margin-top': [LENGTH],
    'margin-bottom': [LENGTH],
    'padding-left': [LENGTH],
  },
}

/**
 * Server-side sanitizer for DOCX editor HTML. Removes scripts, event-handler
 * attributes, javascript:/data: links, external images and unsafe CSS.
 * Run it on every write (docx-save) AND every read (content / detail routes)
 * so rows saved before this fix are neutralized too.
 */
export function sanitizeDocxHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_LINK_SCHEMES,
    allowedSchemesByTag: { img: ['data'] },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    allowedStyles: ALLOWED_STYLES,
    // Drop the contents of dangerous elements entirely instead of keeping their text.
    nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed', 'template'],
    transformTags: {
      // Only inline image data URLs (no external tracking pixels, no data:text/html).
      img: (tagName, attribs) => {
        const { src, ...rest } = attribs
        return {
          tagName,
          attribs: src && isImageDataUrl(src) ? { ...rest, src } : rest,
        }
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  })
}
