# Task 2-a — full-stack-developer

Task: DOCX converter + content/docx-save API routes (SignFlow)

## Deliverables
1. `src/lib/docx-converter.ts`
   - `export async function htmlToDocxBuffer(html: string): Promise<Buffer>`
2. `src/app/api/documents/[id]/content/route.ts`
   - `export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> })`
3. `src/app/api/documents/[id]/docx-save/route.ts`
   - `export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> })`

## Key results
- Converter maps h1–h4, p/text, bold/italic/underline/strike/br/a/code, blockquote (720 twips + italics), nested ul/ol (`signflow-ordered` numbering, per-top-level-ol instance restart), tables (100% width, grid borders), base64 `<img>` (real format sniffed via image-size → jpg/png/gif/bmp, max width 500px, aspect kept, 300×150 fallback), text-align styles; ignores style/script/head; div/section transparent; never throws (per-node try/catch, unknown tags best-effort); empty input → valid empty doc.
- Document: single A4 section (11906×16838 twips, 1440 margins), default Calibri 22 half-points, neutral slate heading styles, ordered-list numbering config.
- content route: 404 for missing/non-docx; returns stored `edits` when non-empty; else mammoth with `convertImage` → inline base64 data-URL images; 500 on failure.
- docx-save route: zod `{ html: string }` (400), 404 non-docx, converts → writes `doc.filePath`, updates `edits` + `size` → `{ ok: true }`.

## Verification
- eslint on the 3 files: 0 problems. tsc --noEmit: 0 errors in src/ (pre-existing errors only in examples/ and skills/).
- Generated docx unpacked & validated: zip integrity, headings, formatting, hyperlink rel, list numbering/nesting/restart, table XML, PNG+JPEG media, entity round-trip, A4/margins/styles.
- E2E against dev server: mammoth conversion path, edits-wins path, save round-trip (`{ok:true}`, valid rewritten docx), 404/400 paths; probe row + files cleaned up afterwards.

Full detail: see the "Task ID: 2-a" section appended to `worklog.md`.
