// Client-side helpers for creating and cleaning signature images.
// These functions use `document`, `Image` and canvas APIs, so they must only
// be called from the browser (client components / event handlers).

/**
 * Load an image from a URL or data URL, resolving once it is decoded.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load the signature image.'))
    img.src = src
  })
}

interface InkBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Scan raw RGBA pixels and return the bounding box of visible
 * (non-transparent) pixels, or null when the image is fully transparent.
 */
function findInkBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 8,
): InkBounds | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  return maxX < 0 ? null : { minX, minY, maxX, maxY }
}

/**
 * Trim transparent margins from a PNG data URL, keeping a small padding of
 * transparent background around the visible ink. Returns the original data
 * URL untouched when the image is fully transparent (or when its pixels
 * cannot be read, e.g. a tainted canvas).
 */
export async function trimSignatureDataUrl(
  dataUrl: string,
  padding = 12,
): Promise<string> {
  const img = await loadImage(dataUrl)
  const width = img.naturalWidth
  const height = img.naturalHeight
  if (!width || !height) return dataUrl

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return dataUrl
  ctx.drawImage(img, 0, 0)

  let bounds: InkBounds | null
  try {
    const pixels = ctx.getImageData(0, 0, width, height)
    bounds = findInkBounds(pixels.data, width, height)
  } catch {
    // Cross-origin image without CORS → canvas is tainted, keep original.
    return dataUrl
  }

  // Fully transparent image → nothing to trim.
  if (!bounds) return dataUrl

  const cropWidth = bounds.maxX - bounds.minX + 1
  const cropHeight = bounds.maxY - bounds.minY + 1

  const out = document.createElement('canvas')
  out.width = cropWidth + padding * 2
  out.height = cropHeight + padding * 2
  const outCtx = out.getContext('2d')
  if (!outCtx) return dataUrl

  // Fresh canvases start fully transparent, so the background is already right.
  outCtx.drawImage(
    img,
    bounds.minX,
    bounds.minY,
    cropWidth,
    cropHeight,
    padding,
    padding,
    cropWidth,
    cropHeight,
  )
  return out.toDataURL('image/png')
}

/**
 * Best-effort: make sure the webfonts used by typed signatures are loaded
 * before we measure and render text on a canvas. Failures are swallowed —
 * the canvas will simply fall back to a system font.
 */
async function ensureFontsReady(fontSpecs: string[]): Promise<void> {
  try {
    const fonts = document.fonts
    if (!fonts) return
    await Promise.all(fontSpecs.map((spec) => fonts.load(spec).catch(() => undefined)))
    await fonts.ready
  } catch {
    // Ignore — font loading is best-effort.
  }
}

/**
 * Render `text` with the given CSS font-family and color onto a transparent
 * offscreen canvas and return a tightly trimmed PNG data URL.
 */
export async function textToSignatureDataUrl(
  text: string,
  fontFamily: string,
  color: string,
  fontSizePx = 64,
): Promise<string> {
  const value = text.trim()
  if (!value) throw new Error('Signature text is empty.')

  await ensureFontsReady([
    `${fontSizePx}px "Great Vibes"`,
    `400 ${fontSizePx}px "Dancing Script"`,
    `600 ${fontSizePx}px "Dancing Script"`,
  ])

  const measureCtx = document.createElement('canvas').getContext('2d')
  const ctx = document.createElement('canvas').getContext('2d')
  if (!measureCtx || !ctx) {
    throw new Error('Canvas is not supported in this browser.')
  }

  const font = `${fontSizePx}px ${fontFamily}`
  measureCtx.font = font
  const metrics = measureCtx.measureText(value)

  // Script fonts often have swashes that extend past the text anchor, so use
  // the actual ink bounding box when available to avoid clipping.
  const inkLeft = Math.max(0, metrics.actualBoundingBoxLeft ?? 0)
  const inkRight = Math.max(metrics.actualBoundingBoxRight ?? 0, metrics.width)

  const padX = Math.ceil(fontSizePx * 0.5)
  const padTop = Math.ceil(fontSizePx * 1.5) // room for ascenders / flourishes
  const padBottom = Math.ceil(fontSizePx * 1.25) // room for descenders

  const canvas = ctx.canvas
  canvas.width = Math.ceil(inkLeft + inkRight) + padX * 2
  canvas.height = padTop + padBottom

  // Fresh canvas → background is already transparent.
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(value, padX + inkLeft, padTop)

  // The generous padding above is intentional — trimSignatureDataUrl tightens it.
  return trimSignatureDataUrl(canvas.toDataURL('image/png'), 4)
}
