import assert from 'assert'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { sanitizeDocxHtml } from '../src/lib/html-sanitizer.ts'
import { isSafeLinkUrl } from '../src/lib/html-policy.ts'
import { drawTextLine } from '../src/lib/pdf-text.ts'
import { applyRedactions } from '../src/lib/pdf-redact.ts'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

async function testFix3_XSS() {
  console.log('Testing Fix 3 (XSS sanitization)...')
  const dirtyHtml = `
    <h1>Document Title</h1>
    <p>Safe text with <strong style="color: red; font-weight: bold;">bold</strong></p>
    <script>alert("xss")</script>
    <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" alt="Valid Image" />
    <img src="http://attacker.com/leak.png" onerror="alert('xss')" />
    <a href="javascript:alert('xss')">Evil link</a>
    <a href="https://example.com">Good link</a>
  `
  const cleanHtml = sanitizeDocxHtml(dirtyHtml)
  
  assert(!cleanHtml.includes('<script>'), 'Script tag should be removed')
  assert(!cleanHtml.includes('alert('), 'Script content should be stripped')
  assert(!cleanHtml.includes('onerror='), 'Event handlers should be removed')
  assert(!cleanHtml.includes('attacker.com'), 'External non-data images should be removed')
  assert(!cleanHtml.includes('javascript:'), 'javascript: links should be removed')
  assert(cleanHtml.includes('<h1>Document Title</h1>'), 'h1 should be preserved')
  assert(cleanHtml.includes('Valid Image'), 'Data URL images should be preserved')
  assert(cleanHtml.includes('https://example.com'), 'Safe links should be preserved')
  
  assert(isSafeLinkUrl('https://example.com'), 'https should be safe')
  assert(isSafeLinkUrl('http://example.com'), 'http should be safe')
  assert(isSafeLinkUrl('mailto:test@example.com'), 'mailto should be safe')
  assert(!isSafeLinkUrl('javascript:alert(1)'), 'javascript should NOT be safe')
  assert(!isSafeLinkUrl('data:text/html,evil'), 'data URI should NOT be safe for link prompt')
  console.log('✓ Fix 3 passed!')
}

async function testFix5_Checkmark() {
  console.log('Testing Fix 5 (Checkmark fallback to ZapfDingbats)...')
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([400, 400])
  const textFont = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const symbolFont = await pdfDoc.embedFont(StandardFonts.ZapfDingbats)

  // Draw regular text and checkmark together
  drawTextLine(page, 'Status: ✓ Done ✔ Verified', {
    x: 50,
    y: 200,
    size: 16,
    color: rgb(0, 0.5, 0),
    fonts: { text: textFont, symbol: symbolFont },
  })

  const savedPdfBytes = await pdfDoc.save()
  
  // Verify with pdfjs: text content should extract checkmarks without throwing or becoming '?'
  const task = pdfjs.getDocument({
    data: savedPdfBytes,
  })
  const loadedPdf = await task.promise
  const loadedPage = await loadedPdf.getPage(1)
  const textContent = await loadedPage.getTextContent()
  const textItems = textContent.items.map((i) => i.str).join(' ')
  
  // Notice: '?' should not be emitted where checkmark was
  assert(!textItems.includes('?'), 'Checkmark must not be replaced with "?"')
  console.log('Extracted text:', textItems)
  await task.destroy()
  console.log('✓ Fix 5 passed!')
}

async function testFix1_Redaction() {
  console.log('Testing Fix 1 (True PDF redaction)...')
  // Create a 2-page PDF
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  
  // Page 1 with SECRET text
  const page1 = pdfDoc.addPage([500, 500])
  page1.drawText('CONFIDENTIAL_SSN_123-45-6789', { x: 50, y: 400, size: 18, font })
  page1.drawText('Public Header Information', { x: 50, y: 450, size: 18, font })

  // Page 2 with normal text
  const page2 = pdfDoc.addPage([500, 500])
  page2.drawText('Page 2 regular public content', { x: 50, y: 450, size: 18, font })

  const rawBytes = await pdfDoc.save()

  // Apply blackout/redaction on page 1 covering the secret text
  const boxesByPage = new Map([
    [0, [{ x: 0.08, y: 0.15, w: 0.8, h: 0.1 }]],
  ])

  const redactedPdfBytes = await applyRedactions(rawBytes, boxesByPage)

  // Check raw bytes for secret string (not even unreferenced objects remain)
  const rawString = Buffer.from(redactedPdfBytes).toString('latin1')
  assert(!rawString.includes('CONFIDENTIAL_SSN'), 'Secret string must not exist anywhere in PDF binary')

  // Verify that page 1 has NO text stream containing CONFIDENTIAL_SSN
  const task = pdfjs.getDocument({
    data: redactedPdfBytes.slice(),
  })
  const loaded = await task.promise
  assert.strictEqual(loaded.numPages, 2, 'Should keep 2 pages')
  
  const page1Loaded = await loaded.getPage(1)
  const page1Text = await page1Loaded.getTextContent()
  const p1Strings = page1Text.items.map((i) => i.str).join(' ')
  assert(!p1Strings.includes('CONFIDENTIAL_SSN'), 'Redacted page text must NOT contain secret')
  assert.strictEqual(p1Strings.trim(), '', 'Redacted page is rasterized image so no vector text leaks')

  const page2Loaded = await loaded.getPage(2)
  const page2Text = await page2Loaded.getTextContent()
  const p2Strings = page2Text.items.map((i) => i.str).join(' ')
  assert(p2Strings.includes('Page 2 regular public content'), 'Unredacted page must still retain its vector text')

  await task.destroy()
  console.log('✓ Fix 1 passed!')
}

async function testDocxSignatureResize() {
  console.log('Testing DOCX Signature & Image Resizing...')
  const { htmlToDocxBuffer } = await import('../src/lib/docx-converter.ts')
  const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  // Signature with custom width and style width
  const htmlWithResizedSignature = `
    <p>Contract Signoff:</p>
    <p>
      <span style="display: inline-block;">
        <img src="${samplePng}" data-signature="1" width="180" style="width: 180px; height: auto;" />
      </span>
    </p>
  `
  // Sanitizer check
  const sanitized = sanitizeDocxHtml(htmlWithResizedSignature)
  assert(sanitized.includes('data-signature="1"'), 'data-signature attribute preserved')
  assert(sanitized.includes('width="180"'), 'width attribute preserved by sanitizer')
  assert(sanitized.includes('width: 180px') || sanitized.includes('width:180px'), 'style width preserved by sanitizer')

  // Docx compilation check
  const docxBuffer = await htmlToDocxBuffer(sanitized)
  assert(docxBuffer && docxBuffer.length > 0, 'DOCX successfully generated with resized signature')
  console.log('✓ DOCX Signature & Image resizing passed!')
}

async function runAll() {
  await testFix3_XSS()
  await testFix5_Checkmark()
  await testFix1_Redaction()
  await testDocxSignatureResize()
  console.log('\n======================================================')
  console.log('ALL FIXES (1, 3, 5 + SIGNATURE RESIZING) PASSED!')
  console.log('======================================================')
}

runAll().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
