'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist'

interface RenderTaskLike {
  promise: Promise<unknown>
  cancel(): void
}
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Highlighter,
  Loader2,
  MousePointer2,
  PenTool,
  Save,
  Square,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import SignatureModal from '@/components/signature-modal'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { PdfEditItem, PdfTool, PlacedSignature } from '@/lib/types'

interface PdfEditorProps {
  docId: string
  name: string
  onBack: () => void
  onSaved: () => void
}

interface DragState {
  mode: 'move' | 'maybe-move' | 'resize' | 'create-rect'
  id: string
  startX: number
  startY: number
  anchorX: number
  anchorY: number
  origX: number
  origY: number
  origW: number
  origH: number
  overlay: HTMLDivElement
}

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v))
const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

const TEXT_COLORS = ['#111827', '#b91c1c', '#047857', '#b45309', '#ffffff']

function origOf(item: PdfEditItem) {
  if (item.kind === 'text') return { x: item.x, y: item.y, w: 0.1, h: 0.05 }
  return { x: item.x, y: item.y, w: item.w, h: item.kind === 'signature' ? 0.1 : item.h }
}

export default function PdfEditor({ docId, name, onBack, onSaved }: PdfEditorProps) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [pageNum, setPageNum] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<PdfTool>('select')
  const [items, setItems] = useState<PdfEditItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [sigModalOpen, setSigModalOpen] = useState(false)
  const [pendingSig, setPendingSig] = useState<PlacedSignature & { aspect: number } | null>(null)
  const [pagePt, setPagePt] = useState<{ w: number; h: number } | null>(null)
  const [containerW, setContainerW] = useState(720)

  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<RenderTaskLike | null>(null)
  const itemEls = useRef<Map<string, HTMLElement>>(new Map())
  const justCreatedId = useRef<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)

  const displayW = Math.round(Math.min(720, Math.max(280, containerW)) * zoom)
  const pxPerPt = pagePt ? displayW / pagePt.w : 0
  const pageItems = items.filter((i) => i.page === pageNum - 1)
  const selectedItem = items.find((i) => i.id === selectedId) ?? null

  // ---------------------------------------------------------------- load PDF
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        const [detailRes, fileRes] = await Promise.all([
          fetch(`/api/documents/${docId}`),
          fetch(`/api/documents/${docId}/original`),
        ])
        if (!fileRes.ok) throw new Error('Could not load the PDF file.')
        if (detailRes.ok) {
          const detail = await detailRes.json()
          if (Array.isArray(detail.edits)) setItems(detail.edits as PdfEditItem[])
        }
        const buf = await fileRes.arrayBuffer()
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) })
        loadingTaskRef.current = loadingTask
        const pdf = await loadingTask.promise
        if (cancelled) {
          void loadingTask.destroy()
          loadingTaskRef.current = null
          return
        }
        setNumPages(pdf.numPages)
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load PDF')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      const task = loadingTaskRef.current
      loadingTaskRef.current = null
      void task?.destroy()
    }
  }, [docId])

  // ------------------------------------------------------------- render page
  useEffect(() => {
    const loadingTask = loadingTaskRef.current
    if (!loadingTask || loading || !pageNum) return
    let cancelled = false
    ;(async () => {
      try {
        const page = await (await loadingTask.promise).getPage(pageNum)
        if (cancelled) return
        const vp1 = page.getViewport({ scale: 1 })
        setPagePt({ w: vp1.width, h: vp1.height })
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = page.getViewport({ scale: (displayW * dpr) / vp1.width })
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${displayW}px`
        canvas.style.height = `${Math.round((displayW * vp1.height) / vp1.width)}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        renderTaskRef.current?.cancel()
        const task: RenderTaskLike = page.render({ canvas, canvasContext: ctx, viewport })
        renderTaskRef.current = task
        await task.promise
      } catch (err) {
        // render cancellations are expected while paging / zooming
        if (!(err instanceof Error && err.name === 'RenderingCancelledException')) {
          console.error('pdf render failed', err)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pageNum, displayW, loading])

  // --------------------------------------------------------- container width
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth - 32))
    ro.observe(el)
    setContainerW(el.clientWidth - 32)
    return () => ro.disconnect()
  }, [loading, loadError])

  // ------------------------------------------------- focus newly created text
  useEffect(() => {
    if (!justCreatedId.current) return
    const el = itemEls.current.get(justCreatedId.current)
    justCreatedId.current = null
    if (el) {
      el.focus()
      const sel = window.getSelection()
      if (sel) {
        const range = document.createRange()
        range.selectNodeContents(el)
        sel.removeAllRanges()
        sel.addRange(range)
      }
    }
  }, [items.length])

  // -------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const editing = target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      if (e.key === 'Escape') {
        if (tool === 'signature') {
          setTool('select')
          setPendingSig(null)
        } else {
          setSelectedId(null)
        }
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editing) {
        e.preventDefault()
        setItems((prev) => prev.filter((i) => i.id !== selectedId))
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool, selectedId])

  // ------------------------------------------------------------ drag engine
  const startDrag = useCallback((state: DragState) => {
    dragRef.current = state
    setDrag(state)
  }, [])

  useEffect(() => {
    if (!drag) return
    document.body.style.userSelect = 'none'
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const rect = d.overlay.getBoundingClientRect()
      const dx = (e.clientX - d.startX) / rect.width
      const dy = (e.clientY - d.startY) / rect.height

      if (d.mode === 'maybe-move') {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return
        const active = document.activeElement as HTMLElement | null
        if (active?.isContentEditable) active.blur()
        const moved: DragState = { ...d, mode: 'move' }
        dragRef.current = moved
        setDrag(moved)
        return
      }

      if (d.mode === 'move') {
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== d.id) return it
            if (it.kind === 'text') {
              return { ...it, x: clamp(d.origX + dx, 0, 0.97), y: clamp(d.origY + dy, 0, 0.97) }
            }
            if (it.kind === 'signature') {
              return { ...it, x: clamp(d.origX + dx, 0, 1 - it.w), y: clamp(d.origY + dy, 0, 0.98) }
            }
            return { ...it, x: clamp(d.origX + dx, 0, 1 - it.w), y: clamp(d.origY + dy, 0, 1 - it.h) }
          }),
        )
      } else if (d.mode === 'resize') {
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== d.id) return it
            if (it.kind === 'signature') {
              return { ...it, w: clamp(d.origW + dx, 0.03, 1 - it.x) }
            }
            if (it.kind === 'highlight' || it.kind === 'blackout') {
              return {
                ...it,
                w: clamp(d.origW + dx, 0.02, 1 - it.x),
                h: clamp(d.origH + dy, 0.01, 1 - it.y),
              }
            }
            return it
          }),
        )
      } else if (d.mode === 'create-rect') {
        const cx = clamp((e.clientX - rect.left) / rect.width)
        const cy = clamp((e.clientY - rect.top) / rect.height)
        setItems((prev) =>
          prev.map((it) =>
            it.id === d.id
              ? {
                  ...it,
                  x: Math.min(d.anchorX, cx),
                  y: Math.min(d.anchorY, cy),
                  w: Math.abs(cx - d.anchorX),
                  h: Math.abs(cy - d.anchorY),
                }
              : it,
          ),
        )
      }
    }
    const onUp = () => {
      const d = dragRef.current
      if (d?.mode === 'create-rect') {
        setItems((prev) => {
          const it = prev.find((i) => i.id === d.id)
          if (it && it.kind !== 'text' && it.kind !== 'signature' && it.w < 0.01 && it.h < 0.01) {
            return prev.filter((i) => i.id !== d.id)
          }
          return prev
        })
      }
      if (d?.mode === 'maybe-move') setSelectedId(d.id)
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.style.userSelect = ''
    }
  }, [drag])

  // -------------------------------------------------------- item interactions
  const onItemPointerDown = (e: React.PointerEvent, item: PdfEditItem) => {
    if (tool === 'text') {
      setSelectedId(item.id)
      e.stopPropagation()
      return
    }
    if (tool !== 'select') return // let overlay create new items
    e.stopPropagation()
    setSelectedId(item.id)
    const overlay = overlayRef.current
    if (!overlay) return
    const orig = origOf(item)
    startDrag({
      mode: 'maybe-move',
      id: item.id,
      startX: e.clientX,
      startY: e.clientY,
      anchorX: 0,
      anchorY: 0,
      origX: orig.x,
      origY: orig.y,
      origW: orig.w,
      origH: orig.h,
      overlay,
    })
  }

  const onResizePointerDown = (e: React.PointerEvent, item: PdfEditItem) => {
    e.stopPropagation()
    e.preventDefault()
    const overlay = overlayRef.current
    if (!overlay) return
    const orig = origOf(item)
    startDrag({
      mode: 'resize',
      id: item.id,
      startX: e.clientX,
      startY: e.clientY,
      anchorX: 0,
      anchorY: 0,
      origX: orig.x,
      origY: orig.y,
      origW: orig.w,
      origH: item.kind === 'highlight' || item.kind === 'blackout' ? item.h : orig.h,
      overlay,
    })
  }

  const onOverlayPointerDown = (e: React.PointerEvent) => {
    const overlay = overlayRef.current
    if (!overlay) return
    const rect = overlay.getBoundingClientRect()
    const fx = clamp((e.clientX - rect.left) / rect.width)
    const fy = clamp((e.clientY - rect.top) / rect.height)

    if (tool === 'text') {
      const item: PdfEditItem = {
        id: newId(),
        kind: 'text',
        page: pageNum - 1,
        x: clamp(fx - 0.04, 0, 0.97),
        y: clamp(fy - 0.015, 0, 0.97),
        text: 'Your text here',
        fontSize: 14,
        color: '#111827',
      }
      setItems((prev) => [...prev, item])
      setSelectedId(item.id)
      justCreatedId.current = item.id
      setTool('select')
      return
    }
    if (tool === 'signature' && pendingSig) {
      const w = 0.28
      const item: PdfEditItem = {
        id: newId(),
        kind: 'signature',
        page: pageNum - 1,
        x: clamp(fx - w / 2, 0, 1 - w),
        y: clamp(fy - 0.03, 0, 0.98),
        w,
        aspect: pendingSig.aspect,
        dataUrl: pendingSig.dataUrl,
      }
      setItems((prev) => [...prev, item])
      setSelectedId(item.id)
      setPendingSig(null)
      setTool('select')
      return
    }
    if (tool === 'highlight' || tool === 'blackout') {
      const id = newId()
      setItems((prev) => [
        ...prev,
        { id, kind: tool, page: pageNum - 1, x: fx, y: fy, w: 0.001, h: 0.001 },
      ])
      setSelectedId(id)
      startDrag({
        mode: 'create-rect',
        id,
        startX: e.clientX,
        startY: e.clientY,
        anchorX: fx,
        anchorY: fy,
        origX: fx,
        origY: fy,
        origW: 0,
        origH: 0,
        overlay,
      })
      return
    }
    setSelectedId(null)
  }

  // --------------------------------------------------------------- mutations
  const updateItem = (id: string, patch: Partial<PdfEditItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? ({ ...it, ...patch } as PdfEditItem) : it)))
  }
  const deleteItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const onSelectSignature = useCallback((sig: PlacedSignature) => {
    const img = new Image()
    img.onload = () => {
      setPendingSig({ dataUrl: sig.dataUrl, name: sig.name, aspect: img.naturalHeight / img.naturalWidth })
      setTool('signature')
    }
    img.onerror = () => {
      setPendingSig({ dataUrl: sig.dataUrl, name: sig.name, aspect: 0.35 })
      setTool('signature')
    }
    img.src = sig.dataUrl
    setSigModalOpen(false)
  }, [])

  // --------------------------------------------------------------------- save
  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/documents/${docId}/pdf-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save the PDF.')
      toast({
        title: 'Saved successfully',
        description: 'All edits were flattened into the PDF. Use Download to get the final file.',
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

  // ------------------------------------------------------------------- render
  const tools: { id: PdfTool; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
    { id: 'select', icon: MousePointer2, label: 'Select & move' },
    { id: 'text', icon: Type, label: 'Add text' },
    { id: 'highlight', icon: Highlighter, label: 'Highlight' },
    { id: 'blackout', icon: Square, label: 'Redact (black box)' },
  ]

  const sigHFrac = (item: PdfEditItem & { kind: 'signature' }) =>
    pagePt ? item.w * (pagePt.w / pagePt.h) / item.aspect : item.w * 0.4

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
          <Badge variant="secondary" className="uppercase">PDF</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/documents/${docId}/download`} aria-label="Download PDF">
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
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-1.5 px-4 py-2">
          {/* page nav */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              disabled={pageNum <= 1}
              onClick={() => {
                setPageNum((p) => Math.max(1, p - 1))
                setSelectedId(null)
              }}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-16 text-center text-sm tabular-nums text-muted-foreground">
              {numPages ? `${pageNum} / ${numPages}` : '–'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              disabled={pageNum >= numPages}
              onClick={() => {
                setPageNum((p) => Math.min(numPages, p + 1))
                setSelectedId(null)
              }}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <Separator orientation="vertical" className="mx-1 h-6" />
          {/* zoom */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.2) * 10) / 10))}
              aria-label="Zoom out"
            >
              <ZoomOut className="size-4" />
            </Button>
            <span className="min-w-12 text-center text-sm tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.2) * 10) / 10))}
              aria-label="Zoom in"
            >
              <ZoomIn className="size-4" />
            </Button>
          </div>
          <Separator orientation="vertical" className="mx-1 h-6" />
          {/* tools */}
          <div className="flex items-center gap-1">
            {tools.map((t) => (
              <Button
                key={t.id}
                variant={tool === t.id ? 'default' : 'ghost'}
                size="icon"
                className="size-10"
                onClick={() => {
                  setTool(t.id)
                  if (t.id !== 'select') setSelectedId(null)
                }}
                title={t.label}
                aria-label={t.label}
                aria-pressed={tool === t.id}
              >
                <t.icon className="size-4" />
              </Button>
            ))}
            <Button
              variant={tool === 'signature' ? 'default' : 'outline'}
              size="sm"
              className="ml-1 h-10 border-emerald-600 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-950"
              onClick={() => setSigModalOpen(true)}
            >
              <PenTool className="size-4" />
              Sign
            </Button>
          </div>
        </div>
      </header>

      {/* canvas area */}
      <main className="relative flex-1 overflow-auto bg-zinc-200/60 dark:bg-zinc-900" ref={scrollRef}>
        {tool === 'signature' && pendingSig && (
          <div className="pointer-events-none sticky top-2 z-20 mx-auto w-fit rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white shadow-lg">
            Click on the page to place your signature · Esc to cancel
          </div>
        )}
        {loading && (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin" />
            <span className="text-sm">Loading PDF…</span>
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
          <div className="mx-auto w-fit p-4">
            <div
              className="relative bg-white shadow-xl ring-1 ring-black/10"
              style={{ width: displayW, height: pagePt ? Math.round((displayW * pagePt.h) / pagePt.w) : displayW * 1.3 }}
            >
              <canvas ref={canvasRef} className="block" aria-label={`PDF page ${pageNum}`} />
              {/* editing overlay */}
              <div
                ref={overlayRef}
                className={cn(
                  'absolute inset-0',
                  tool === 'text' && 'cursor-text',
                  (tool === 'highlight' || tool === 'blackout') && 'cursor-crosshair',
                  tool === 'signature' && 'cursor-copy',
                )}
                style={{ touchAction: 'pan-y' }}
                onPointerDown={onOverlayPointerDown}
              >
                {pagePt &&
                  pageItems.map((item) => {
                    const selected = item.id === selectedId
                    if (item.kind === 'text') {
                      return (
                        <div
                          key={item.id}
                          ref={(el) => {
                            if (el) {
                              itemEls.current.set(item.id, el)
                              if (el.dataset.init !== '1') {
                                el.dataset.init = '1'
                                el.innerText = item.text
                              }
                            } else {
                              itemEls.current.delete(item.id)
                            }
                          }}
                          contentEditable
                          suppressContentEditableWarning
                          spellCheck={false}
                          onInput={(e) => updateItem(item.id, { text: (e.currentTarget as HTMLElement).innerText })}
                          onPointerDown={(e) => onItemPointerDown(e, item)}
                          className={cn(
                            'absolute whitespace-pre-wrap rounded-sm border border-dashed border-transparent px-0.5 leading-[1.25] hover:border-zinc-300',
                            selected && 'border-emerald-500/80',
                          )}
                          style={{
                            left: `${item.x * 100}%`,
                            top: `${item.y * 100}%`,
                            maxWidth: `${(1 - item.x) * 100}%`,
                            fontSize: `${item.fontSize * pxPerPt}px`,
                            lineHeight: 1.25,
                            color: item.color,
                            cursor: 'move',
                            touchAction: 'none',
                          }}
                        />
                      )
                    }
                    if (item.kind === 'signature') {
                      return (
                        <div key={item.id} className="absolute" style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.w * 100}%`, touchAction: 'none' }}>
                          <img
                            src={item.dataUrl}
                            alt="Signature"
                            draggable={false}
                            onPointerDown={(e) => onItemPointerDown(e, item)}
                            className={cn(
                              'block w-full select-none',
                              selected && 'rounded outline-2 outline-emerald-500',
                            )}
                            style={{ cursor: 'move' }}
                          />
                          {selected && (
                            <span
                              role="button"
                              aria-label="Resize signature"
                              className="absolute -bottom-2 -right-2 size-4 cursor-nwse-resize rounded-full border-2 border-white bg-emerald-600 shadow"
                              style={{ touchAction: 'none' }}
                              onPointerDown={(e) => onResizePointerDown(e, item)}
                            />
                          )}
                        </div>
                      )
                    }
                    // highlight / blackout
                    return (
                      <div key={item.id}>
                        <div
                          onPointerDown={(e) => onItemPointerDown(e, item)}
                          className={cn(
                            'absolute',
                            item.kind === 'highlight' ? 'bg-yellow-400/45 mix-blend-multiply' : 'bg-zinc-900',
                            selected && 'outline-2 outline-dashed outline-emerald-500',
                          )}
                          style={{
                            left: `${item.x * 100}%`,
                            top: `${item.y * 100}%`,
                            width: `${item.w * 100}%`,
                            height: `${item.h * 100}%`,
                            cursor: 'move',
                            touchAction: 'none',
                          }}
                        />
                        {selected && (
                          <span
                            role="button"
                            aria-label="Resize box"
                            className="absolute size-4 cursor-nwse-resize rounded-full border-2 border-white bg-emerald-600 shadow"
                            style={{
                              left: `calc(${(item.x + item.w) * 100}% - 8px)`,
                              top: `calc(${(item.y + item.h) * 100}% - 8px)`,
                              touchAction: 'none',
                            }}
                            onPointerDown={(e) => onResizePointerDown(e, item)}
                          />
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>

            {/* selected item controls */}
            {selectedItem ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border bg-background p-3 shadow-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {selectedItem.kind === 'text'
                    ? 'Text'
                    : selectedItem.kind === 'signature'
                      ? 'Signature'
                      : selectedItem.kind === 'highlight'
                        ? 'Highlight'
                        : 'Redaction'}
                </span>
                {selectedItem.kind === 'text' && (
                  <>
                    <Separator orientation="vertical" className="h-6" />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Size
                      <Input
                        type="number"
                        min={6}
                        max={96}
                        value={selectedItem.fontSize}
                        onChange={(e) =>
                          updateItem(selectedItem.id, {
                            fontSize: Math.min(96, Math.max(6, Number(e.target.value) || 14)),
                          })
                        }
                        className="h-9 w-20"
                        aria-label="Font size in points"
                      />
                    </label>
                    <div className="flex items-center gap-1.5" role="group" aria-label="Text color">
                      {TEXT_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={`Text color ${c}`}
                          className={cn(
                            'size-7 rounded-full border shadow-sm transition-transform hover:scale-110',
                            selectedItem.color === c ? 'ring-2 ring-emerald-600 ring-offset-2' : '',
                            c === '#ffffff' ? 'border-zinc-300' : 'border-transparent',
                          )}
                          style={{ backgroundColor: c }}
                          onClick={() => updateItem(selectedItem.id, { color: c })}
                        />
                      ))}
                    </div>
                  </>
                )}
                <div className="ml-auto">
                  <Button variant="destructive" size="sm" onClick={() => deleteItem(selectedItem.id)}>
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                {tool === 'select' && 'Tip: click an item to select it, drag to move it, use the corner dot to resize.'}
                {tool === 'text' && 'Click anywhere on the page to add a text box.'}
                {tool === 'highlight' && 'Click and drag on the page to highlight an area.'}
                {tool === 'blackout' && 'Click and drag on the page to draw a black redaction box.'}
                {tool === 'signature' && 'Click anywhere on the page to place your signature.'}
              </p>
            )}
          </div>
        )}
      </main>

      <SignatureModal open={sigModalOpen} onOpenChange={setSigModalOpen} onSelect={onSelectSignature} />
    </div>
  )
}
