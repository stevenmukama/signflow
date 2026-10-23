# Worklog — SignFlow (Edit & Sign PDF / DOCX)

## Project Goal
Build a fullstack Next.js 16 app (single page `/`, state-based views) that lets users:
1. Upload PDF or DOCX files (library view)
2. **Edit PDFs**: add text, highlight, redact (blackout), place signatures — flattened via pdf-lib on save
3. **Edit DOCX**: rich-text editing of mammoth-converted HTML, saved back to .docx via a custom `docx`-package converter
4. **Sign PDF & DOCX**: draw / type / upload signatures, save for reuse, place them in documents
5. Download / delete documents, manage saved signatures

## Architecture & Conventions (READ CAREFULLY)
- Next.js 16 App Router + TypeScript + Tailwind 4 + shadcn/ui (New York) + lucide-react. Theme: white/slate + emerald accents, NO indigo/blue. Sonner-less — use `@/hooks/use-toast` + existing `<Toaster />` in layout (actually layout already includes Toaster from ui/toaster; `import { useToast, toast } from '@/hooks/use-toast'` — check the hook file for exact export).
- DB: Prisma + SQLite (`import { db } from '@/lib/db'`). Schema (already pushed):
  - `Document { id, name, type("pdf"|"docx"), size, originalPath, filePath, edits(String?), createdAt, updatedAt }` — `id` is an explicit `crypto.randomUUID()` set by the upload route.
  - `Signature { id(cuid), name, type("draw"|"type"|"upload"), dataUrl, createdAt }` — dataUrl = PNG data URL stored in DB.
- Files on disk: `storage/documents/{id}.{ext}`. Helpers in `src/lib/storage.ts` (DOCUMENTS_DIR, docFilePath, ensureDocumentsDir, mimeForType, sanitizeWinAnsi, hexToRgb).
- Shared types in `src/lib/types.ts`: DocumentDto, DocumentDetail, SavedSignature, PlacedSignature, PdfEditItem (discriminated union: text | signature | highlight | blackout), PdfTool.
- Coordinates convention (PDF items): `x`,`y` are fractions of page width/height measured from TOP-LEFT of the page. Signature `w` = width fraction, `aspect` = img height/width. Text `fontSize` in PDF points.
- API surface (Next 16 route handlers — `params` is a Promise: `const { id } = await params`):
  - `GET/POST /api/documents` — list / multipart upload (pdf+docx, ≤25MB) [owned by main agent]
  - `GET/DELETE /api/documents/[id]` — detail incl. parsed edits / delete [main agent]
  - `GET /api/documents/[id]/file|original|download` — serve current processed / original / attachment [main agent]
  - `POST /api/documents/[id]/pdf-save` — body `{ items: PdfEditItem[] }`, pdf-lib applies to originalPath → filePath [main agent]
  - `GET /api/documents/[id]/content` — mammoth docx→HTML (base64-inline images) [subagent 2-a]
  - `POST /api/documents/[id]/docx-save` — body `{ html }` → htmlToDocxBuffer → filePath, DB edits=html [subagent 2-a]
  - `GET/POST /api/signatures`, `DELETE /api/signatures/[id]` [subagent 2-b]
- pdfjs-dist v6 is installed; worker copied to `public/pdf.worker.min.mjs`. Client usage: `const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'`.
- Fonts available: `@fontsource/dancing-script`, `@fontsource/great-vibes` (for typed signatures).
- Do NOT run `bun run dev`, `bun run build`, or create test files. Dev server is already managed on port 3000. No extra page routes — only `/` is user-visible.

---
Task ID: 1
Agent: main (Z.ai Code)
Task: Project setup & shared infrastructure

Work Log:
- Inspected scaffold (Next 16 + Tailwind 4 + shadcn/ui + Prisma SQLite), dev server already running on :3000
- Installed: pdf-lib@1.17.1, pdfjs-dist@6.4.299, mammoth@1.13.0, docx@9.14.0, signature_pad@5.1.4, node-html-parser@9.0.5, image-size@2.0.4, @fontsource/dancing-script, @fontsource/great-vibes
- Copied `node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs` → `public/pdf.worker.min.mjs`
- Prisma schema: added `Document` + `Signature` models; `bun run db:push` OK (client regenerated)
- Created `storage/documents/` dir
- Wrote `src/lib/types.ts` (DTOs + PdfEditItem union) and `src/lib/storage.ts` (paths, mimes, WinAnsi sanitizer, hexToRgb)

Stage Summary:
- Shared foundation ready: DB schema live, file storage conventions fixed, type contracts fixed. Subagents 2-a and 2-b must follow the contracts above exactly.

---
Task ID: 2-b
Agent: full-stack-developer
Task: Signature modal + signature utils + signatures API

Work Log:
- Read worklog.md + contracts (types.ts, use-toast export = `toast`/`useToast`, Prisma `Signature` model, shadcn dialog/tabs/checkbox APIs, signature_pad v5 typings).
- Created `src/lib/signature-utils.ts`: `loadImage()`, `trimSignatureDataUrl()` (alpha-channel bounding-box scan + padded transparent re-composite; returns original when fully transparent or pixels unreadable) and `textToSignatureDataUrl()` (waits for `document.fonts.load`/`ready`, measures with `actualBoundingBoxLeft/Right` to avoid clipping script swashes, draws on transparent offscreen canvas at fontSize 64, returns trimmed PNG). Client-only (document/Image/canvas).
- Created `src/app/api/signatures/route.ts` (runtime nodejs): GET lists signatures `createdAt desc` mapped to SavedSignature DTO (ISO dates); POST validates JSON body {name, type('draw'|'type'|'upload'), dataUrl startsWith 'data:image/', length < 2MB → 413 otherwise}, trims/limits name to 120 chars, returns 201 + created DTO.
- Created `src/app/api/signatures/[id]/route.ts` (runtime nodejs): DELETE with `const { id } = await params` (Next 16 async params), 404 JSON when missing, `{ ok: true }` on success.
- Created `src/components/signature-modal.tsx` (client): shadcn Dialog "Add your signature" + 4 tabs.
  - Draw: canvas sized to container × devicePixelRatio (with `ctx.scale(ratio)` per signature_pad v5 README — the lib draws in CSS px), `SignaturePad` recreated via ResizeObserver on open/tab change; penColor #0f172a, transparent bg, minWidth 2 / maxWidth 2.5; Clear button; empty-pad guard → toast.
  - Type: text input + 3 font buttons rendered in their own font (Great Vibes via `@fontsource/great-vibes`, Dancing Script via 400.css+700.css weight 600, "Handwriting" = 'Segoe Script','Comic Sans MS',cursive) + 4 ink swatches (#0f172a/#000000/#047857/#b91c1c) + 40px live preview.
  - Upload: sr-only file input (png/jpeg/webp, ≤4MB) → FileReader dataURL, preview on checkerboard bg, Replace/Remove.
  - Saved: GET /api/signatures on dialog open (loading/error/empty states), checkerboard thumbnails max-h-24 object-contain with name + delete (DELETE /api/signatures/[id] → refresh; loader on the row); click selects (aria-pressed ring) and prefills name.
  - Footer: "Save to my signatures" Checkbox (default ON, hidden on Saved tab) + name Input (default "Signature <Mon D, YYYY>") + emerald "Use signature" button with loading state. Confirm: draw→trim pad PNG, type→textToSignatureDataUrl, upload→as-is, saved→as-is; POST to /api/signatures when saving checked; then `onSelect({ dataUrl, name })` + close; try/catch → destructive toasts.
- Verified: `bunx eslint` on my 4 files → 0 problems (project-wide 5 errors are all in public/pdf.worker.min.mjs vendored file, left untouched); `bunx tsc --noEmit` → no errors in my files; smoke-tested API via curl: GET 200 [], POST invalid → 400, POST valid → 201, DELETE → 200 {ok:true}, DELETE missing → 404, GET after → [] (probe row cleaned up); dev.log clean.

Stage Summary:
- Exports: `src/lib/signature-utils.ts` → `loadImage(src): Promise<HTMLImageElement>`, `trimSignatureDataUrl(dataUrl, padding=12): Promise<string>`, `textToSignatureDataUrl(text, fontFamily, color, fontSizePx=64): Promise<string>` (all client-side).
- Component: `src/components/signature-modal.tsx` → `export interface SignatureModalProps { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (sig: PlacedSignature) => void }`, `export default function SignatureModal(...)`. Consumers: `import SignatureModal from '@/components/signature-modal'`, render with `open/onOpenChange/onSelect`; onSelect receives trimmed transparent PNG dataUrl + display name.
- Endpoints: `GET/POST /api/signatures` (list desc / create, 400 on bad type or non-image dataUrl, 413 ≥2MB), `DELETE /api/signatures/[id]` ({ok:true} | 404).
- Decisions: signature_pad pad is recreated (not mutated) on container resize because v5 cannot survive canvas resizing; canvas exports at DPR resolution for crisp PDF placement; uploads kept as-is (JPEG allowed); saved-tab name input prefilled with the saved signature's name (renamable before placing); confirm flow aborts with error toast on any failure per spec.

---
Task ID: 2-a
Agent: full-stack-developer
Task: DOCX converter + content/docx-save API routes

Work Log:
- Read worklog.md + contracts (Document schema, storage paths, docx@9.14.0 / mammoth@1.13 / node-html-parser@9 / image-size@2 typings verified in node_modules .d.ts before coding).
- Created `src/lib/docx-converter.ts`: `htmlToDocxBuffer(html)` — parses HTML with node-html-parser (`{ lowerCaseTagName: true }`), walks DOM in order into docx blocks:
  - h1..h4 → HEADING_1..4 paragraphs (custom neutral styles: color #1F2937, sizes 32/28/25/23 half-points, spacing); p/bare text → Paragraph+TextRun; inline strong/b→bold, em/i→italics, u→underline, s/strike/del→strike, br→`TextRun({break:1})`, a[href]→ExternalHyperlink (+auto rel), code→'Courier New', span/font/unknown inline→transparent.
  - blockquote → 720-twip left indent + italics forced on all runs (incl. nested p/lists).
  - ul → `bullet:{level N}`; ol → `numbering:{reference:'signflow-ordered', level N, instance}` with DECIMAL '%1.'..'%9.' levels 0-8 + hanging indent; each top-level `<ol>` allocates a fresh numbering instance so numbering restarts at 1; nested `<ol>` inside `<ol>` continues the same instance; nested lists inside `<li>` supported recursively (best-effort).
  - table → docx Table, 100% width, auto cell widths, single 0.5pt grid borders, thead/tbody/tfoot recursed, empty cells get an empty Paragraph; rows without cells skipped; table with no rows → empty Paragraph.
  - img → base64 data-URL decode → ImageRun (docx v9 `type` required: real format detected via image-size, jpg/png/gif/bmp mapped; else mime-mapped; else fallback png), size via image-size scaled to max width 500px keeping aspect (defaults 300x150); works inside `<p>` (images are ParagraphChild runs) and wrapped in divs.
  - text-align:center|right|justify via inline style → AlignmentType.CENTER/RIGHT/JUSTIFIED (inherited through transparent containers); style/script/head/meta skipped; div/section/article/body + unknown tags transparent when holding block children, else their inline content renders as one paragraph; unknown/stray tags (h5, font, stray li…) render best-effort instead of being dropped.
  - Whitespace collapsed (`[ \t\r\n\f\v]+`→' ', \u00a0 preserved); entity decoding handled by the parser's unescaped `.text` getter (verified no double-escaping in output XML); per-node try/catch everywhere — malformed HTML never throws; empty input → valid docx with one empty paragraph.
  - Document: single section, A4 11906×16838 twips, margins 1440, doc-default Calibri size 22 half-points, numbering config `signflow-ordered`; `Packer.toBuffer` → Buffer.
- Created `src/app/api/documents/[id]/content/route.ts` (runtime nodejs): Next 16 async params; 404 `{error}` when missing/non-docx; returns stored `edits` HTML when non-empty, else reads originalPath → mammoth `convertToHtml({buffer}, { convertImage: mammoth.images.imgElement(...) })` with base64 data-URL images; 500 `{error}` on failure.
- Created `src/app/api/documents/[id]/docx-save/route.ts` (runtime nodejs): zod v4 body `{html: string}` (400 invalid/missing), 404 non-docx, `htmlToDocxBuffer` → writeFile to `doc.filePath` → `db.document.update({edits: html, size: buffer.byteLength})` → `{ok:true}`; 500 with message on failure.
- Verified: `bunx eslint` on my 3 files → 0 problems (project-wide errors are only public/pdf.worker.min.mjs vendored noise); `bunx tsc --noEmit` → 0 errors in src/ (remaining ones pre-exist in examples/, skills/); converter smoke-tested offline: zip integrity valid, headings/bold/italic/underline/strike/code/br/hyperlink(+external rel)/center-align/quote-indent/lists (restart + nesting: level texts %1./%2.)/tables/PNG+JPEG media embedding/entity round-trip all confirmed by unpacking the generated docx; E2E via dev server: GET content on temp docx → mammoth HTML with edits-null path + edits-wins path, POST docx-save → `{ok:true}` + valid rewritten docx (Heading2 + list present), 404 paths for missing id, 400 invalid body; probe row/files cleaned up; dev.log clean.

Stage Summary:
- Export: `src/lib/docx-converter.ts` → `export async function htmlToDocxBuffer(html: string): Promise<Buffer>` (never throws; supports headings, inline formatting, links, code, quotes, nested ul/ol, tables, base64 images, text-align).
- Endpoints: `GET /api/documents/[id]/content` → `{ html }` (edited HTML wins; else mammoth w/ inline base64 images; 404 `{error}` non-docx/missing; 500 `{error}`); `POST /api/documents/[id]/docx-save` body `{ html }` → `{ ok: true }` (400 bad body, 404 non-docx/missing, 500 `{error}`), writes real .docx to `doc.filePath`, sets `edits` + `size`.
- Frontend contract (for main agent): `GET /api/documents/{id}/content` to load editor HTML; `POST /api/documents/{id}/docx-save` with `{ html }` to save; images arrive as `<img src="data:...">` and survive round-trip (also inside `<p>`/`<div>`).
- Decisions: real image format sniffed via image-size with mime fallback + png fallback per spec; formats docx can't embed faithfully still fall back per spec (real-world mammoth output is png/jpeg/gif/bmp so this is safe); separate numbering instance per top-level `<ol>` so repeated lists restart at 1; heading styles given neutral slate color instead of Word's default blue to match app theme.

---
Task ID: 3-8
Agent: main (Z.ai Code)
Task: Documents APIs, PDF editor, DOCX editor, app shell, E2E verification & fixes

Work Log:
- Built documents API layer: POST/GET /api/documents (upload/list), GET+DELETE /api/documents/[id], /file, /original, /download routes + POST /api/documents/[id]/pdf-save (pdf-lib flattening engine with WinAnsi sanitizing, image dedup cache, highlight w/ Multiply blend, blackout)
- Built PdfEditor component: pdfjs v6 legacy build rendering (worker from /pdf.worker.min.mjs), tools (select/move/resize, text boxes w/ contentEditable, highlight & blackout drag-creation, signature placement), pointer-event drag engine, zoom/page nav, save→flatten
- Built DocxEditor component: paper-style contenteditable, full execCommand toolbar (headings, lists, align, color, links, images), signature insertion at caret with data-signature="1" marker, save→docx
- Assembled page.tsx (library + upload dropzone + document grid + saved signatures strip), theme provider + dark mode toggle, sticky footer
- Fixed: pdfjs v6 API (loadingTask.destroy, render({canvas})), eslint ignore for vendored worker
- Browser E2E verification (agent-browser) found & fixed 3 real bugs:
  1. DOCX paper stayed empty — load effect assigned innerHTML before the paper div mounted → state-driven injection effect
  2. Highlight/blackout rect rendered full-page — unpositioned wrapper made `inset-0` fill the overlay → explicit left/top/w/h styles
  3. Signature Draw tab canvas never sized & produced no ink — effect ran before Radix portal remounted the canvas on reopen → capture canvas/area nodes in state so the effect re-runs on every mount
- Verified end-to-end in real browser: upload pdf+docx, text tool, highlight drag, typed "Great Vibes" signature placed by click, save→flattened PDF (verified visually via pdftoppm render), docx edited + saved signature embedded (word/media/*.png confirmed), saved-signatures reuse from library and inside editors, delete flows, signatures API, mobile 390px layout, dark mode, footer behavior
- Final lint: 0 problems; tsc: 0 errors in src/

Stage Summary:
- SignFlow complete: upload → edit (PDF: text/highlight/redact/signature; DOCX: rich text) → sign (draw/type/upload/saved) → save & download, all verified working in the browser. Single route /, state-based views. DB: Document + Signature (SQLite/Prisma). Files under storage/documents.
