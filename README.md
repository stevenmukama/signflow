# SignFlow ✍️📄

> **Modern web-based PDF & Word (.docx) editor, e-signing platform, and document manager.**  
> Add text, highlighters, redactions, custom signatures, manage page rotations/ordering, and combine multiple files with zero quality loss.

---

## ✨ Features

### 📑 PDF & Word (.docx) Editing
- **Interactive PDF Viewer & Annotator**: Render PDFs with high fidelity using PDF.js and canvas overlay tools.
- **Rich DOCX Editing**: In-browser Word document editing with WYSIWYG formatting, headings, lists, and direct docx export.
- **Download Flattened Documents**: Export final documents with all signatures, text annotations, highlights, and redactions permanently baked in.

### 🔄 PDF Page Management
- **Rotate Pages**: Rotate individual pages 90° Clockwise or Counter-Clockwise, or rotate all pages simultaneously.
- **Reorder & Organize**: Move pages up or down easily using the thumbnail sidebar.
- **Delete Pages**: Remove unwanted pages with confirmation guards.
- **Live Thumbnails**: Real-time thumbnail previews that dynamically reflect applied rotations and deletions.
- **History (Undo / Redo)**: Full multi-step Undo (`Ctrl+Z` / `⌘Z`) and Redo (`Ctrl+Y` / `⌘⇧Z`) support for all edits and page transformations.

### 📚 Multi-File PDF Merge
- **Combine Documents**: Merge two or more PDF files from your library or local files into a single unified document.
- **Customizable Merge Order**: Intuitive queue interface to reorder files with Up/Down controls before merging.
- **Lossless Quality**: Fast, lossless page concatenation using `pdf-lib` vector embedding.
- **Direct Library Integration**: Merged files are automatically added to your library and opened for instant review.

### 🖊️ E-Signatures
- **Draw, Type, or Upload**:
  - **Draw**: Smooth freehand signature pad with stroke smoothing.
  - **Type**: Generate signatures in customizable cursive/handwriting typography styles.
  - **Upload**: Upload signature images from your device.
- **Saved Signature Library**: Save favorite signatures to easily stamp and place across multiple documents without re-drawing.
- **Move & Resize**: Drag, position, and resize signatures directly on any page.

### ✏️ Freehand Pen & Drawing Tool
- **Smooth Vector Drawing**: Sketch, circle clauses, draw arrows, or write handwritten notes directly onto documents.
- **Custom Stroke Widths & Colors**: Choose Fine (2pt), Medium (4pt), or Bold (7pt) widths and a versatile palette of colors (Slate, Royal Blue, Crimson Red, Emerald Green, Purple, Amber).
- **8-Way Interactive Resizing**: Resize drawn lines and sketches from any of the 4 edges (top, bottom, left, right) or 4 corners (NW, NE, SW, SE) with proportional vector point scaling and border margin detection.
- **Interactive Editing**: Click any completed stroke to adjust color, change stroke thickness, move, scale, or delete it.
- **Lossless Vector Baking**: Exported PDFs bake drawings as crisp vector lines and joints using `pdf-lib`.
- **Integrated History**: Full Undo (`Ctrl+Z`) and Redo (`Ctrl+Y`) support for all drawn strokes.

### 🖍️ Annotations & Redaction
- **Text Boxes**: Add customizable text notes, labels, and form fills.
- **Highlighter**: Emphasize important text sections with translucent highlights.
- **Redaction / Blackout**: Mask private or confidential data securely before downloading.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) 15 (App Router)
- **Runtime & Package Manager**: [Bun](https://bun.sh/)
- **UI & Styling**: [React 19](https://react.dev/), [Tailwind CSS](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/) / Radix UI, Lucide Icons
- **PDF Processing**: [pdf-lib](https://pdf-lib.js.org/), [pdfjs-dist](https://mozilla.github.io/pdf.js/)
- **Word Document Processing**: [docx](https://docx.js.org/), [mammoth](https://github.com/mwilliamson/mammoth.js)
- **Database & Storage**: [Prisma](https://www.prisma.io/) with SQLite, local filesystem storage
- **Sanitization & Security**: DOMPurify for secure HTML handling

---

## 🚀 Getting Started

### Prerequisites
- [Bun](https://bun.sh/) (recommended) or Node.js 18+

### Installation

1. **Clone the repository**:
   ```bash
   git clone git@github.com:stevenmukama/signflow.git
   cd signflow
   ```

2. **Install dependencies**:
   ```bash
   bun install
   ```

3. **Initialize the database**:
   ```bash
   bunx prisma db push
   ```

4. **Start the development server**:
   ```bash
   bun run dev
   ```

5. **Open in browser**:
   Navigate to [http://localhost:3000](http://localhost:3000) to start editing and signing documents.

---

## 📁 Project Structure

```text
signflow/
├── db/                    # SQLite database storage
├── prisma/                # Prisma ORM schema & migrations
├── public/                # Static assets
├── src/
│   ├── app/
│   │   ├── api/documents/ # REST endpoints (upload, merge, save, download)
│   │   ├── api/signatures/# Signature management endpoints
│   │   ├── globals.css    # Global styling & theme tokens
│   │   ├── layout.tsx     # Root application layout & providers
│   │   └── page.tsx       # Main document library & dashboard
│   ├── components/
│   │   ├── docx-editor.tsx # Rich Word (.docx) editor component
│   │   ├── pdf-editor.tsx  # PDF editor, annotations & page manager
│   │   ├── merge-modal.tsx # Multi-file PDF merge dialog
│   │   ├── signature-modal.tsx # Signature pad & generator
│   │   └── ui/             # Reusable UI component library (shadcn)
│   └── lib/               # Utility functions, sanitizers, storage & types
└── storage/documents/     # Uploaded and generated documents
```

---

## 🔒 Privacy & Security

All document processing, editing, signing, and merging operations occur either client-side or on your local server. Documents and signatures remain under your control without third-party cloud uploads.

---

## 📄 License

This project is licensed under the MIT License.
