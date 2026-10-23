export type DocType = 'pdf' | 'docx'

export interface DocumentDto {
  id: string
  name: string
  type: DocType
  size: number
  hasEdits: boolean
  signed: boolean
  createdAt: string
  updatedAt: string
}

export interface DocumentDetail extends DocumentDto {
  /** PDF: parsed PdfEditItem[] — DOCX: edited HTML string */
  edits: string | PdfEditItem[] | null
}

export interface SavedSignature {
  id: string
  name: string
  type: 'draw' | 'type' | 'upload'
  dataUrl: string
  createdAt: string
}

export interface PlacedSignature {
  dataUrl: string
  name: string
}

export type PdfEditItem =
  | {
      id: string
      kind: 'text'
      page: number // 0-based page index
      x: number // fraction of page width (left)
      y: number // fraction of page height (top of text)
      text: string
      fontSize: number // in PDF points
      color: string // hex like #111111
    }
  | {
      id: string
      kind: 'signature'
      page: number
      x: number // fraction of page width (left)
      y: number // fraction of page height (top)
      w: number // fraction of page width (width of image)
      aspect: number // image height / width ratio
      dataUrl: string // PNG data URL (transparent)
    }
  | {
      id: string
      kind: 'highlight' | 'blackout'
      page: number
      x: number
      y: number
      w: number
      h: number // fractions of page width/height
    }

export type PdfTool = 'select' | 'text' | 'highlight' | 'blackout' | 'signature'
