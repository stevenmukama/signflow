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

export interface InkBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Scan raw RGBA pixels and return the bounding box of visible
 * (non-transparent) pixels, or null when the image is fully transparent.
 */
export function findInkBounds(
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

export interface BackgroundRemovalOptions {
  /**
   * Sensitivity / threshold from 10 to 95 (default 65).
   * Higher values capture lighter or thinner ink strokes.
   * Lower values eliminate more shadows and paper textures.
   */
  sensitivity?: number

  /**
   * Ink color mode:
   * - 'original': Preserves the pen's real color (blue, red, etc.) with de-tinted paper reflection
   * - 'black': Rich deep black ink (#09090b)
   * - 'navy': Classic signature dark navy (#0f172a)
   * - 'blue': Royal blue ballpoint ink (#1d4ed8)
   */
  inkMode?: 'original' | 'black' | 'navy' | 'blue'

  /**
   * Whether to automatically trim transparent margins around the signature after background removal.
   * Default: true.
   */
  trim?: boolean

  /**
   * Max width/height to downscale to for performance and crisp stroke isolation.
   * Default: 1400.
   */
  maxDimension?: number
}

/**
 * Remove paper background from a photo or scan of a handwritten signature,
 * leaving only the clean signature ink on a transparent background.
 *
 * Uses an adaptive local illumination map to eliminate shadows, gradients,
 * and yellow/off-white paper cast while anti-aliasing the ink edges smoothly.
 */
export async function removeSignatureBackground(
  dataUrl: string,
  options: BackgroundRemovalOptions = {},
): Promise<string> {
  const {
    sensitivity = 65,
    inkMode = 'black',
    trim = true,
    maxDimension = 1400,
  } = options

  const img = await loadImage(dataUrl)
  let width = img.naturalWidth
  let height = img.naturalHeight
  if (!width || !height) return dataUrl

  // Downscale if very large (e.g. 12MP smartphone photo)
  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height)
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return dataUrl

  ctx.drawImage(img, 0, 0, width, height)

  let imageData: ImageData
  try {
    imageData = ctx.getImageData(0, 0, width, height)
  } catch {
    // Tainted canvas fallback
    return dataUrl
  }

  const data = imageData.data
  const totalPixels = width * height

  // 1. Compute global luminance statistics to detect overall paper level
  const sampleStep = Math.max(1, Math.floor(Math.sqrt(totalPixels) / 60))
  const globalLumHist = new Uint32Array(256)
  let sampledCount = 0

  for (let y = 0; y < height; y += sampleStep) {
    const rowOffset = y * width * 4
    for (let x = 0; x < width; x += sampleStep) {
      const idx = rowOffset + x * 4
      const a = data[idx + 3]
      if (a < 20) continue
      const lum = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2])
      globalLumHist[lum]++
      sampledCount++
    }
  }

  let globalPaperLum = 240
  if (sampledCount > 0) {
    const target95 = Math.floor(sampledCount * 0.95)
    let accum = 0
    for (let i = 0; i < 256; i++) {
      accum += globalLumHist[i]
      if (accum >= target95) {
        globalPaperLum = Math.max(120, i)
        break
      }
    }
  }

  // 2. Adaptive Background Map: Break image into local blocks to eliminate shadows
  const blockSize = Math.max(16, Math.min(64, Math.floor(Math.min(width, height) / 16)))
  const cols = Math.ceil(width / blockSize)
  const rows = Math.ceil(height / blockSize)

  const blockPaperLum = new Float32Array(cols * rows)
  const blockPaperR = new Float32Array(cols * rows)
  const blockPaperG = new Float32Array(cols * rows)
  const blockPaperB = new Float32Array(cols * rows)

  const blockHist = new Uint16Array(256)

  for (let by = 0; by < rows; by++) {
    const yStart = by * blockSize
    const yEnd = Math.min(height, yStart + blockSize)

    for (let bx = 0; bx < cols; bx++) {
      const xStart = bx * blockSize
      const xEnd = Math.min(width, xStart + blockSize)
      const bIdx = by * cols + bx

      blockHist.fill(0)
      let bCount = 0

      for (let y = yStart; y < yEnd; y++) {
        const rowOffset = y * width * 4
        for (let x = xStart; x < xEnd; x++) {
          const idx = rowOffset + x * 4
          if (data[idx + 3] < 20) continue
          const lum = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2])
          blockHist[lum]++
          bCount++
        }
      }

      if (bCount === 0) {
        blockPaperLum[bIdx] = globalPaperLum
        blockPaperR[bIdx] = 255
        blockPaperG[bIdx] = 255
        blockPaperB[bIdx] = 255
        continue
      }

      // Find 90th percentile in this block
      const bTarget90 = Math.floor(bCount * 0.90)
      let bAccum = 0
      let paperLum = globalPaperLum
      for (let i = 0; i < 256; i++) {
        bAccum += blockHist[i]
        if (bAccum >= bTarget90) {
          paperLum = i
          break
        }
      }

      // If a block is completely dark (heavy ink), clamp it using global paper luminance
      paperLum = Math.max(paperLum, globalPaperLum * 0.7)
      blockPaperLum[bIdx] = paperLum

      // Average color of pixels near paper luminance (within 15 levels)
      let sumR = 0, sumG = 0, sumB = 0, pCount = 0
      for (let y = yStart; y < yEnd; y++) {
        const rowOffset = y * width * 4
        for (let x = xStart; x < xEnd; x++) {
          const idx = rowOffset + x * 4
          if (data[idx + 3] < 20) continue
          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
          if (Math.abs(lum - paperLum) <= 15) {
            sumR += data[idx]
            sumG += data[idx + 1]
            sumB += data[idx + 2]
            pCount++
          }
        }
      }

      if (pCount > 0) {
        blockPaperR[bIdx] = sumR / pCount
        blockPaperG[bIdx] = sumG / pCount
        blockPaperB[bIdx] = sumB / pCount
      } else {
        blockPaperR[bIdx] = paperLum
        blockPaperG[bIdx] = paperLum
        blockPaperB[bIdx] = paperLum
      }
    }
  }

  // Smooth the grid with a 3x3 box blur to avoid hard block seams
  const smoothLum = new Float32Array(cols * rows)
  const smoothR = new Float32Array(cols * rows)
  const smoothG = new Float32Array(cols * rows)
  const smoothB = new Float32Array(cols * rows)

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let lSum = 0, rSum = 0, gSum = 0, bSum = 0, count = 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = by + dy
        if (ny < 0 || ny >= rows) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = bx + dx
          if (nx < 0 || nx >= cols) continue
          const idx = ny * cols + nx
          lSum += blockPaperLum[idx]
          rSum += blockPaperR[idx]
          gSum += blockPaperG[idx]
          bSum += blockPaperB[idx]
          count++
        }
      }
      const curIdx = by * cols + bx
      smoothLum[curIdx] = lSum / count
      smoothR[curIdx] = rSum / count
      smoothG[curIdx] = gSum / count
      smoothB[curIdx] = bSum / count
    }
  }

  // 3. Process each pixel: compute ink contrast against local paper
  const clampedSens = Math.max(10, Math.min(95, sensitivity))
  const cutoff = 0.03 + (100 - clampedSens) * 0.003
  const ramp = 0.12

  // Ink color target values
  const isBlack = inkMode === 'black'
  const isNavy = inkMode === 'navy'
  const isBlue = inkMode === 'blue'
  const isOriginal = inkMode === 'original'

  let targetR = 15, targetG = 23, targetB = 42
  if (isBlack) {
    targetR = 9; targetG = 9; targetB = 11 // deep charcoal black
  } else if (isNavy) {
    targetR = 15; targetG = 23; targetB = 42 // classic slate navy
  } else if (isBlue) {
    targetR = 29; targetG = 78; targetB = 216 // ballpoint blue
  }

  const outData = ctx.createImageData(width, height)
  const out = outData.data

  for (let y = 0; y < height; y++) {
    const gy = (y + 0.5) / blockSize - 0.5
    const by0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)))
    const by1 = Math.max(0, Math.min(rows - 1, by0 + 1))
    const fy = Math.max(0, Math.min(1, gy - by0))

    const rowOffset = y * width * 4

    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x * 4
      const a = data[idx + 3]
      if (a < 10) {
        out[idx + 3] = 0
        continue
      }

      const gx = (x + 0.5) / blockSize - 0.5
      const bx0 = Math.max(0, Math.min(cols - 1, Math.floor(gx)))
      const bx1 = Math.max(0, Math.min(cols - 1, bx0 + 1))
      const fx = Math.max(0, Math.min(1, gx - bx0))

      // Bilinear interpolation of local paper background
      const i00 = by0 * cols + bx0
      const i10 = by0 * cols + bx1
      const i01 = by1 * cols + bx0
      const i11 = by1 * cols + bx1

      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy

      const pLum = w00 * smoothLum[i00] + w10 * smoothLum[i10] + w01 * smoothLum[i01] + w11 * smoothLum[i11]
      const pR = w00 * smoothR[i00] + w10 * smoothR[i10] + w01 * smoothR[i01] + w11 * smoothR[i11]
      const pG = w00 * smoothG[i00] + w10 * smoothG[i10] + w01 * smoothG[i01] + w11 * smoothG[i11]
      const pB = w00 * smoothB[i00] + w10 * smoothB[i10] + w01 * smoothB[i01] + w11 * smoothB[i11]

      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const lum = 0.299 * r + 0.587 * g + 0.114 * b

      // Relative darkness from paper
      const deltaLum = Math.max(0, pLum - lum) / Math.max(pLum, 1)

      // Color distance from paper
      const colorDist = Math.sqrt((r - pR) ** 2 + (g - pG) ** 2 + (b - pB) ** 2) / 441.67

      const contrast = Math.max(deltaLum, colorDist * 0.9)

      if (contrast <= cutoff) {
        out[idx + 3] = 0
        continue
      }

      let alphaNorm: number
      if (contrast >= cutoff + ramp) {
        alphaNorm = 1.0
      } else {
        const t = (contrast - cutoff) / ramp
        alphaNorm = t * t * (3 - 2 * t) // smoothstep
      }

      // Combine with original alpha
      const finalAlpha = Math.round(alphaNorm * (a / 255) * 255)
      out[idx + 3] = finalAlpha

      if (isOriginal) {
        // De-tint paper contribution from ink
        const safeAlpha = Math.max(0.12, alphaNorm)
        const recoveredR = Math.max(0, Math.min(255, Math.round((r - pR * (1 - safeAlpha)) / safeAlpha)))
        const recoveredG = Math.max(0, Math.min(255, Math.round((g - pG * (1 - safeAlpha)) / safeAlpha)))
        const recoveredB = Math.max(0, Math.min(255, Math.round((b - pB * (1 - safeAlpha)) / safeAlpha)))
        out[idx] = recoveredR
        out[idx + 1] = recoveredG
        out[idx + 2] = recoveredB
      } else {
        out[idx] = targetR
        out[idx + 1] = targetG
        out[idx + 2] = targetB
      }
    }
  }

  ctx.putImageData(outData, 0, 0)
  const resultDataUrl = canvas.toDataURL('image/png')

  if (trim) {
    return trimSignatureDataUrl(resultDataUrl, 12)
  }
  return resultDataUrl
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
