'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bold,
  Download,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  AlignCenter,
  AlignLeft,
  AlignRight,
  PenTool,
  Redo2,
  Save,
  Strikethrough,
  Underline,
  Undo2,
  RemoveFormatting,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import SignatureModal from '@/components/signature-modal'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { PlacedSignature } from '@/lib/types'

interface DocxEditorProps {
  docId: string
  name: string
  onBack: () => void
  onSaved: () => void
}

type BlockTag = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'blockquote'

export default function DocxEditor({ docId, name, onBack, onSaved }: DocxEditorProps) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [initialHtml, setInitialHtml] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [sigModalOpen, setSigModalOpen] = useState(false)
  const [blockTag, setBlockTag] = useState<BlockTag>('p')
  const [fontSize, setFontSize] = useState('3')
  const [active, setActive] = useState({ bold: false, italic: false, underline: false, strike: false })

  const editorRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)
  const savedRangeRef = useRef<Range | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  // ------------------------------------------------------------------ load
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Prefer previously saved edited HTML, else convert the docx with mammoth.
        const detailRes = await fetch(`/api/documents/${docId}`)
        if (detailRes.ok) {
          const detail = await detailRes.json()
          if (typeof detail.edits === 'string' && detail.edits.trim()) {
            if (!cancelled) setInitialHtml(detail.edits)
            return
          }
        }
        const res = await fetch(`/api/documents/${docId}/content`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not read the document.')
        if (!cancelled) setInitialHtml(data.html || '')
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load document')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [docId])

  // Inject the initial HTML once the paper is actually mounted.
  useEffect(() => {
    if (loading || loadError || initialHtml === null) return
    if (initializedRef.current) return
    if (editorRef.current) {
      editorRef.current.innerHTML = initialHtml
      initializedRef.current = true
    }
  }, [loading, loadError, initialHtml])

  // ---------------------------------------------------- toolbar active states
  const syncActiveStates = useCallback(() => {
    try {
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strike: document.queryCommandState('strikeThrough'),
      })
      const block = (document.queryCommandValue('formatBlock') || 'p').toLowerCase().replace(/[<>]/g, '')
      setBlockTag((['h1', 'h2', 'h3', 'h4', 'blockquote'].includes(block) ? block : 'p') as BlockTag)
    } catch {
      /* queryCommand* can throw on some selections — ignore */
    }
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', syncActiveStates)
    return () => document.removeEventListener('selectionchange', syncActiveStates)
  }, [syncActiveStates])

  // ------------------------------------------------------------------ exec
  const exec = (command: string, value?: string) => {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    syncActiveStates()
  }

  // -------------------------------------------------------- insert signature
  const openSignatureModal = () => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange()
    }
    setSigModalOpen(true)
  }

  const insertSignature = useCallback((sig: PlacedSignature) => {
    const editor = editorRef.current
    editor?.focus()
    const sel = window.getSelection()
    if (savedRangeRef.current && sel) {
      sel.removeAllRanges()
      sel.addRange(savedRangeRef.current)
    }
    const img = `<img src="${sig.dataUrl}" alt="Signature" data-signature="1" draggable="false" style="max-width:200px;max-height:80px;vertical-align:middle;">`
    document.execCommand('insertHTML', false, img)
    savedRangeRef.current = null
    setSigModalOpen(false)
    toast({ title: 'Signature inserted', description: 'Position it with the alignment tools, then press Save.' })
  }, [])

  // ----------------------------------------------------------- insert image
  const insertImageFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      exec('insertHTML', `<img src="${dataUrl}" alt="Image" style="max-width:460px;">`)
    }
    reader.readAsDataURL(file)
  }

  // ------------------------------------------------------------------- save
  const handleSave = async () => {
    const html = editorRef.current?.innerHTML
    if (html === undefined) return
    setSaving(true)
    try {
      const res = await fetch(`/api/documents/${docId}/docx-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save the document.')
      toast({
        title: 'Saved successfully',
        description: 'Your edits were written to the Word document. Use Download to get the .docx file.',
      })
      onSaved()
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  // ------------------------------------------------------------------ render
  const toolBtn = (
    active: boolean,
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
  ) => (
    <Button
      variant="ghost"
      size="icon"
      className={cn('size-10', active && 'bg-accent text-accent-foreground')}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </Button>
  )

  return (
    <div className="flex flex-1 flex-col">
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-2.5">
          <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to library">
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">Library</span>
          </Button>
          <Separator orientation="vertical" className="hidden h-6 sm:block" />
          <h2 className="max-w-[36vw] truncate text-sm font-semibold sm:max-w-xs" title={name}>
            {name}
          </h2>
          <Badge variant="secondary" className="uppercase">DOCX</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/documents/${docId}/download`} aria-label="Download DOCX">
                <Download className="size-4" />
                <span className="hidden sm:inline">Download</span>
              </a>
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || loading}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save
            </Button>
          </div>
        </div>
        <Separator />
        {/* formatting toolbar */}
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-1 px-4 py-2">
          {toolBtn(false, 'Undo', <Undo2 className="size-4" />, () => exec('undo'))}
          {toolBtn(false, 'Redo', <Redo2 className="size-4" />, () => exec('redo'))}
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Select
            value={blockTag}
            onValueChange={(v) => exec('formatBlock', `<${v}>`)}
          >
            <SelectTrigger className="h-10 w-32" aria-label="Paragraph style" onMouseDown={(e) => e.preventDefault()}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="p">Text</SelectItem>
              <SelectItem value="h1">Heading 1</SelectItem>
              <SelectItem value="h2">Heading 2</SelectItem>
              <SelectItem value="h3">Heading 3</SelectItem>
              <SelectItem value="h4">Heading 4</SelectItem>
              <SelectItem value="blockquote">Quote</SelectItem>
            </SelectContent>
          </Select>
          <Select value={fontSize} onValueChange={(v) => exec('fontSize', v)}>
            <SelectTrigger className="h-10 w-24" aria-label="Font size" onMouseDown={(e) => e.preventDefault()}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Tiny</SelectItem>
              <SelectItem value="2">Small</SelectItem>
              <SelectItem value="3">Normal</SelectItem>
              <SelectItem value="4">Medium</SelectItem>
              <SelectItem value="5">Large</SelectItem>
              <SelectItem value="6">Huge</SelectItem>
              <SelectItem value="7">Massive</SelectItem>
            </SelectContent>
          </Select>
          <label className="ml-1 flex size-10 cursor-pointer items-center justify-center rounded-md hover:bg-accent" title="Text color" aria-label="Text color">
            <span className="flex size-6 items-end justify-center rounded-full border border-zinc-300 pb-0.5 text-[10px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#111827 55%,#047857 55%)' }}>
              A
            </span>
            <input
              type="color"
              className="sr-only"
              defaultValue="#111827"
              onChange={(e) => exec('foreColor', e.target.value)}
            />
          </label>
          <Separator orientation="vertical" className="mx-1 h-6" />
          {toolBtn(active.bold, 'Bold', <Bold className="size-4" />, () => exec('bold'))}
          {toolBtn(active.italic, 'Italic', <Italic className="size-4" />, () => exec('italic'))}
          {toolBtn(active.underline, 'Underline', <Underline className="size-4" />, () => exec('underline'))}
          {toolBtn(active.strike, 'Strikethrough', <Strikethrough className="size-4" />, () => exec('strikeThrough'))}
          <Separator orientation="vertical" className="mx-1 h-6" />
          {toolBtn(false, 'Bulleted list', <List className="size-4" />, () => exec('insertUnorderedList'))}
          {toolBtn(false, 'Numbered list', <ListOrdered className="size-4" />, () => exec('insertOrderedList'))}
          {toolBtn(false, 'Align left', <AlignLeft className="size-4" />, () => exec('justifyLeft'))}
          {toolBtn(false, 'Align center', <AlignCenter className="size-4" />, () => exec('justifyCenter'))}
          {toolBtn(false, 'Align right', <AlignRight className="size-4" />, () => exec('justifyRight'))}
          <Separator orientation="vertical" className="mx-1 h-6" />
          {toolBtn(false, 'Insert link', <Link2 className="size-4" />, () => {
            const url = window.prompt('Link URL (https://…)')
            if (url) exec('createLink', url)
          })}
          {toolBtn(false, 'Clear formatting', <RemoveFormatting className="size-4" />, () => exec('removeFormat'))}
          {toolBtn(false, 'Insert image', <ImageIcon className="size-4" />, () => imageInputRef.current?.click())}
          <Button
            size="sm"
            variant="outline"
            className="ml-1 h-10 border-emerald-600 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-950"
            onMouseDown={(e) => e.preventDefault()}
            onClick={openSignatureModal}
          >
            <PenTool className="size-4" />
            Sign
          </Button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) insertImageFile(f)
              e.target.value = ''
            }}
          />
        </div>
      </header>

      {/* paper */}
      <main className="slim-scroll flex-1 overflow-auto bg-zinc-200/60 py-6 dark:bg-zinc-900">
        {loading && (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin" />
            <span className="text-sm">Opening document…</span>
          </div>
        )}
        {loadError && (
          <div className="flex h-64 flex-col items-center justify-center gap-3">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="size-4" /> Back to library
            </Button>
          </div>
        )}
        {!loading && !loadError && (
          <div
            ref={editorRef}
            className="docx-paper mx-auto w-full max-w-[850px] shadow-xl ring-1 ring-black/10"
            contentEditable
            suppressContentEditableWarning
            spellCheck
            role="textbox"
            aria-multiline="true"
            aria-label="Document editor"
            data-placeholder="Start typing your document…"
          />
        )}
      </main>

      <SignatureModal open={sigModalOpen} onOpenChange={setSigModalOpen} onSelect={insertSignature} />
    </div>
  )
}
