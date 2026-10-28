'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'

interface RenderTaskLike {
  promise: Promise<unknown>
  cancel(): void
}

import {
  ArrowLeft,
  ArrowLeftRight,
  Calendar,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  Highlighter,
  Loader2,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  PenTool,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
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
import type { PageOps, PdfEditItem, PdfTool, PlacedSignature } from '@/lib/types'

export interface PageEntry {
  id: string
  originalIndex: number
  rotation: number
}

interface EditorStateSnapshot {
  items: PdfEditItem[]
  pages: PageEntry[]
}

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
  handle?: 'se' | 'sw' | 'ne' | 'nw' | 'e' | 'w' | 'n' | 's'
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max)

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

const TEXT_COLORS = [
  '#111827',
  '#2563eb',
  '#047857',
  '#b91c1c',
  '#d97706',
  '#7c3aed',
  '#ffffff',
]

function origOf(item: PdfEditItem, pageAspect = 1.3) {
  if (item.kind === 'text') return { x: item.x, y: item.y, w: 0.1, h: 0.05 }
  if (item.kind === 'signature') {
    const h = typeof item.h === 'number' && item.h > 0 ? item.h : (item.w * (item.aspect || 0.4)) / pageAspect
    return { x: item.x, y: item.y, w: item.w, h }
  }
  return { x: item.x, y: item.y, w: item.w, h: item.h }
}

// ---------------------------------------------------------------- Thumbnail Item
function PageThumbnail({
  pdfDoc,
  pageIndex,
  displayPageNumber,
  rotation,
  isActive,
  editCount,
  canMoveUp,
  canMoveDown,
  canDelete,
  onRotateCW,
  onRotateCCW,
  onMoveUp,
  onMoveDown,
  onDelete,
  onClick,
}: {
  pdfDoc: PDFDocumentProxy | null
  pageIndex: number
  displayPageNumber: number
  rotation: number
  isActive: boolean
  editCount: number
  canMoveUp: boolean
  canMoveDown: boolean
  canDelete: boolean
  onRotateCW: () => void
  onRotateCCW: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onClick: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return
    let cancelled = false
    ;(async () => {
      try {
        const page = await pdfDoc.getPage(pageIndex + 1)
        if (cancelled) return
        const effectiveRot = ((page.rotate + rotation) % 360 + 360) % 360
        const vp1 = page.getViewport({ scale: 1, rotation: effectiveRot })
        const targetW = 140
        const scale = targetW / vp1.width
        const viewport = page.getViewport({ scale, rotation: effectiveRot })
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const task = (page.render as (p: unknown) => RenderTaskLike)({
          canvas,
          canvasContext: ctx,
          viewport,
        })
        await task.promise
        if (!cancelled) setRendered(true)
      } catch {
        /* render cancelled */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdfDoc, pageIndex, rotation])

  return (
    <div
      className={cn(
        'group relative flex flex-col items-center gap-1.5 rounded-lg border p-1.5 text-left transition-all',
        isActive
          ? 'border-emerald-600 bg-emerald-50/60 shadow-xs ring-2 ring-emerald-600/30 dark:bg-emerald-950/40'
          : 'border-border bg-card/80 hover:bg-muted/50',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        className="relative flex w-full cursor-pointer justify-center overflow-hidden rounded border bg-white shadow-2xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        <canvas ref={canvasRef} className="block max-w-full h-auto transition-transform" />
        {!rendered && <div className="h-36 w-full animate-pulse bg-muted" />}

        {/* Hover Action Bar */}
        <div
          className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-zinc-950/85 p-1 opacity-0 backdrop-blur-xs transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-zinc-200 hover:bg-zinc-800 hover:text-white"
            onClick={(e) => {
              e.stopPropagation()
              onRotateCCW()
            }}
            title="Rotate 90° counter-clockwise"
          >
            <RotateCcw className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-zinc-200 hover:bg-zinc-800 hover:text-white"
            onClick={(e) => {
              e.stopPropagation()
              onRotateCW()
            }}
            title="Rotate 90° clockwise"
          >
            <RotateCw className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-zinc-200 hover:bg-zinc-800 hover:text-white disabled:opacity-20"
            disabled={!canMoveUp}
            onClick={(e) => {
              e.stopPropagation()
              onMoveUp()
            }}
            title="Move page up"
          >
            <ChevronUp className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-zinc-200 hover:bg-zinc-800 hover:text-white disabled:opacity-20"
            disabled={!canMoveDown}
            onClick={(e) => {
              e.stopPropagation()
              onMoveDown()
            }}
            title="Move page down"
          >
            <ChevronDown className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-red-300 hover:bg-red-950 hover:text-red-100 disabled:opacity-20"
            disabled={!canDelete}
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            title={canDelete ? 'Delete page' : 'Cannot delete the only page'}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      <div className="flex w-full items-center justify-between px-1 text-xs">
        <div className="flex items-center gap-1">
          <span
            className={cn(
              'font-medium',
              isActive ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-muted-foreground',
            )}
          >
            Page {displayPageNumber}
          </span>
          {rotation > 0 && (
            <span
              className="rounded bg-muted px-1 text-[9px] font-mono text-muted-foreground"
              title="Current rotation"
            >
              {rotation}°
            </span>
          )}
        </div>
        {editCount > 0 && (
          <span className="rounded-full bg-emerald-600/15 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
            {editCount}
          </span>
        )}
      </div>
    </div>
  )
}

export default function PdfEditor({ docId, name: initialName, onBack, onSaved }: PdfEditorProps) {
  const [docName, setDocName] = useState(initialName)
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(initialName)

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
  const [pendingSig, setPendingSig] = useState<(PlacedSignature & { aspect: number }) | null>(null)
  const [pagePt, setPagePt] = useState<{ w: number; h: number } | null>(null)
  const [containerW, setContainerW] = useState(720)
  const [showThumbnails, setShowThumbnails] = useState(true)

  const [pages, setPages] = useState<PageEntry[]>([])
  const pagesRef = useRef(pages)
  pagesRef.current = pages

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)

  // Undo / Redo history
  const [history, setHistory] = useState<EditorStateSnapshot[]>([{ items: [], pages: [] }])
  const [historyIndex, setHistoryIndex] = useState(0)

  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<RenderTaskLike | null>(null)
  const itemEls = useRef<Map<string, HTMLElement>>(new Map())
  const justCreatedId = useRef<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const selectedControlsRef = useRef<HTMLDivElement | null>(null)
  const [resizeBothSides, setResizeBothSides] = useState(true)
  const resizeBothSidesRef = useRef(resizeBothSides)
  resizeBothSidesRef.current = resizeBothSides

  const displayW = Math.round(Math.min(720, Math.max(280, containerW)) * zoom)
  const pxPerPt = pagePt ? displayW / pagePt.w : 0
  const pageItems = items.filter((i) => i.page === pageNum - 1)
  const selectedItem = items.find((i) => i.id === selectedId) ?? null

  const itemsRef = useRef(items)
  itemsRef.current = items
  const historyIndexRef = useRef(historyIndex)
  historyIndexRef.current = historyIndex

  const commitState = useCallback(
    (newItems: PdfEditItem[], newPages?: PageEntry[]) => {
      const targetPages = newPages ?? pagesRef.current
      setItems(newItems)
      itemsRef.current = newItems
      setPages(targetPages)
      pagesRef.current = targetPages
      setNumPages(targetPages.length)

      setHistory((prev) => {
        const next = prev.slice(0, historyIndexRef.current + 1)
        next.push({ items: newItems, pages: targetPages })
        return next
      })
      setHistoryIndex((prev) => prev + 1)
    },
    [],
  )

  const commitItems = useCallback((newItems: PdfEditItem[]) => {
    commitState(newItems)
  }, [commitState])

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const nextIdx = historyIndex - 1
      setHistoryIndex(nextIdx)
      const snap = history[nextIdx]
      setItems(snap.items)
      itemsRef.current = snap.items
      setPages(snap.pages)
      pagesRef.current = snap.pages
      setNumPages(snap.pages.length)
      setSelectedId(null)
      setPageNum((p) => Math.min(Math.max(1, p), Math.max(1, snap.pages.length)))
    }
  }, [history, historyIndex])

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1
      setHistoryIndex(nextIdx)
      const snap = history[nextIdx]
      setItems(snap.items)
      itemsRef.current = snap.items
      setPages(snap.pages)
      pagesRef.current = snap.pages
      setNumPages(snap.pages.length)
      setSelectedId(null)
      setPageNum((p) => Math.min(Math.max(1, p), Math.max(1, snap.pages.length)))
    }
  }, [history, historyIndex])

  const rotatePage = (displayIndex: number, deltaDeg: number) => {
    const curPages = pagesRef.current
    const curPage = curPages[displayIndex]
    if (!curPage) return

    const newRot = ((curPage.rotation + deltaDeg) % 360 + 360) % 360
    const nextPages = curPages.map((p, idx) =>
      idx === displayIndex ? { ...p, rotation: newRot } : p,
    )

    const normDelta = ((deltaDeg % 360) + 360) % 360
    const nextItems = itemsRef.current.map((it) => {
      if (it.page !== displayIndex || normDelta === 0) return it
      if (it.kind === 'text') {
        const estH = 0.03
        if (normDelta === 90) {
          return { ...it, x: clamp(1 - it.y - estH, 0, 1), y: clamp(it.x, 0, 1) }
        } else if (normDelta === 180) {
          return { ...it, x: clamp(1 - it.x - 0.1, 0, 1), y: clamp(1 - it.y - estH, 0, 1) }
        } else {
          return { ...it, x: clamp(it.y, 0, 1), y: clamp(1 - it.x - 0.1, 0, 1) }
        }
      } else {
        const w = it.w
        const h = it.kind === 'signature' ? (typeof it.h === 'number' && it.h > 0 ? it.h : w * it.aspect) : it.h
        if (normDelta === 90) {
          return { ...it, x: clamp(1 - it.y - h, 0, 1), y: clamp(it.x, 0, 1), w: h, h: w }
        } else if (normDelta === 180) {
          return { ...it, x: clamp(1 - it.x - w, 0, 1), y: clamp(1 - it.y - h, 0, 1) }
        } else {
          return { ...it, x: clamp(it.y, 0, 1), y: clamp(1 - it.x - w, 0, 1), w: h, h: w }
        }
      }
    })

    commitState(nextItems, nextPages)
  }

  const rotateAllPages = (deltaDeg: number) => {
    const curPages = pagesRef.current
    if (curPages.length === 0) return
    const nextPages = curPages.map((p) => ({
      ...p,
      rotation: ((p.rotation + deltaDeg) % 360 + 360) % 360,
    }))

    const normDelta = ((deltaDeg % 360) + 360) % 360
    const nextItems = itemsRef.current.map((it) => {
      if (normDelta === 0) return it
      if (it.kind === 'text') {
        const estH = 0.03
        if (normDelta === 90) {
          return { ...it, x: clamp(1 - it.y - estH, 0, 1), y: clamp(it.x, 0, 1) }
        } else if (normDelta === 180) {
          return { ...it, x: clamp(1 - it.x - 0.1, 0, 1), y: clamp(1 - it.y - estH, 0, 1) }
        } else {
          return { ...it, x: clamp(it.y, 0, 1), y: clamp(1 - it.x - 0.1, 0, 1) }
        }
      } else {
        const w = it.w
        const h = it.kind === 'signature' ? (typeof it.h === 'number' && it.h > 0 ? it.h : w * it.aspect) : it.h
        if (normDelta === 90) {
          return { ...it, x: clamp(1 - it.y - h, 0, 1), y: clamp(it.x, 0, 1), w: h, h: w }
        } else if (normDelta === 180) {
          return { ...it, x: clamp(1 - it.x - w, 0, 1), y: clamp(1 - it.y - h, 0, 1) }
        } else {
          return { ...it, x: clamp(it.y, 0, 1), y: clamp(1 - it.x - w, 0, 1), w: h, h: w }
        }
      }
    })

    commitState(nextItems, nextPages)
    toast({
      title: 'Rotated all pages',
      description: `All ${curPages.length} pages rotated 90° clockwise.`,
    })
  }

  const movePage = (displayIndex: number, direction: 'up' | 'down') => {
    const curPages = pagesRef.current
    const targetIndex = direction === 'up' ? displayIndex - 1 : displayIndex + 1
    if (targetIndex < 0 || targetIndex >= curPages.length) return

    const nextPages = [...curPages]
    const temp = nextPages[displayIndex]
    nextPages[displayIndex] = nextPages[targetIndex]
    nextPages[targetIndex] = temp

    const nextItems = itemsRef.current.map((it) => {
      if (it.page === displayIndex) return { ...it, page: targetIndex }
      if (it.page === targetIndex) return { ...it, page: displayIndex }
      return it
    })

    commitState(nextItems, nextPages)

    if (pageNum - 1 === displayIndex) {
      setPageNum(targetIndex + 1)
    } else if (pageNum - 1 === targetIndex) {
      setPageNum(displayIndex + 1)
    }
  }

  const deletePage = (displayIndex: number) => {
    const curPages = pagesRef.current
    if (curPages.length <= 1) {
      toast({
        title: 'Cannot delete page',
        description: 'The document must contain at least one page.',
        variant: 'destructive',
      })
      return
    }

    const nextPages = curPages.filter((_, i) => i !== displayIndex)
    const nextItems = itemsRef.current
      .filter((it) => it.page !== displayIndex)
      .map((it) => (it.page > displayIndex ? { ...it, page: it.page - 1 } : it))

    commitState(nextItems, nextPages)

    setPageNum((prev) => {
      if (prev - 1 === displayIndex) {
        return Math.min(prev, nextPages.length)
      } else if (prev - 1 > displayIndex) {
        return prev - 1
      }
      return prev
    })

    toast({
      title: 'Page deleted',
      description: `Page ${displayIndex + 1} removed. Press Undo (Ctrl+Z) if you wish to restore it.`,
    })
  }

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
        let loadedItems: PdfEditItem[] = []
        let savedPageOps: PageOps | null = null
        if (detailRes.ok) {
          const detail = await detailRes.json()
          if (Array.isArray(detail.edits)) {
            loadedItems = detail.edits as PdfEditItem[]
          } else if (
            detail.edits &&
            typeof detail.edits === 'object' &&
            Array.isArray(detail.edits.items)
          ) {
            loadedItems = detail.edits.items as PdfEditItem[]
            if (detail.edits.pageOps && Array.isArray(detail.edits.pageOps.order)) {
              savedPageOps = detail.edits.pageOps as PageOps
            }
          }
        }
        setItems(loadedItems)
        itemsRef.current = loadedItems

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
        setPdfDoc(pdf)

        let initialPages: PageEntry[]
        if (savedPageOps && savedPageOps.order.length > 0) {
          initialPages = savedPageOps.order.map((origIdx, i) => ({
            id: `page-${origIdx}-${i}`,
            originalIndex: origIdx,
            rotation: savedPageOps?.rotations?.[i] ?? 0,
          }))
        } else {
          initialPages = Array.from({ length: pdf.numPages }, (_, i) => ({
            id: `page-${i}-0`,
            originalIndex: i,
            rotation: 0,
          }))
        }

        setPages(initialPages)
        pagesRef.current = initialPages
        setNumPages(initialPages.length)
        setHistory([{ items: loadedItems, pages: initialPages }])
        setHistoryIndex(0)
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
    if (!loadingTask || loading || !pageNum || pages.length === 0) return
    const curPageEntry = pages[pageNum - 1]
    if (!curPageEntry) return
    let cancelled = false
    ;(async () => {
      try {
        const page = await (await loadingTask.promise).getPage(curPageEntry.originalIndex + 1)
        if (cancelled) return
        const effectiveRot = ((page.rotate + curPageEntry.rotation) % 360 + 360) % 360
        const vp1 = page.getViewport({ scale: 1, rotation: effectiveRot })
        setPagePt({ w: vp1.width, h: vp1.height })
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = page.getViewport({ scale: (displayW * dpr) / vp1.width, rotation: effectiveRot })
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${displayW}px`
        canvas.style.height = `${Math.round((displayW * vp1.height) / vp1.width)}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        renderTaskRef.current?.cancel()
        const task: RenderTaskLike = (page.render as (p: unknown) => RenderTaskLike)({
          canvas,
          canvasContext: ctx,
          viewport,
        })
        renderTaskRef.current = task
        await task.promise
      } catch (err) {
        if (!(err instanceof Error && err.name === 'RenderingCancelledException')) {
          console.error('pdf render failed', err)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pageNum, pages, displayW, loading])

  // Track container width for responsive scaling.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const avail = Math.max(280, el.clientWidth - 48)
      setContainerW(avail)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // -------------------------------------------------------- keyboard handling
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const editing =
        target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')

      // Shortcuts for undo / redo
      if ((e.metaKey || e.ctrlKey) && !editing) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault()
          if (e.shiftKey) redo()
          else undo()
          return
        }
        if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault()
          redo()
          return
        }
      }

      // PageUp / PageDown shortcuts
      if (!editing && numPages > 1) {
        if (e.key === 'PageDown') {
          e.preventDefault()
          setPageNum((p) => Math.min(numPages, p + 1))
          return
        }
        if (e.key === 'PageUp') {
          e.preventDefault()
          setPageNum((p) => Math.max(1, p - 1))
          return
        }
      }

      if (e.key === 'Escape') {
        if (tool === 'signature') {
          setTool('select')
          setPendingSig(null)
          return
        }
        setSelectedId(null)
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editing) {
        e.preventDefault()
        commitItems(items.filter((i) => i.id !== selectedId))
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool, selectedId, items, commitItems, undo, redo, numPages])

  // Deselect when clicking outside the selected item, its handles, and its control toolbar
  useEffect(() => {
    const handleGlobalPointerDown = (e: PointerEvent) => {
      if (!selectedId) return
      const target = e.target as HTMLElement | null
      if (!target) return
      if (typeof target.closest !== 'function') {
        setSelectedId(null)
        return
      }

      // Don't deselect if clicking inside modals/dialogs, popovers, or menus
      if (
        target.closest('[role="dialog"]') ||
        target.closest('[role="menu"]') ||
        target.closest('[data-radix-portal]') ||
        target.closest('[data-radix-popper-content-wrapper]')
      ) {
        return
      }

      // Don't deselect if clicking inside the bottom controls bar for the selected item
      if (selectedControlsRef.current?.contains(target)) {
        return
      }

      // Don't deselect if clicking on any PdfEditItem or its handles in the overlay
      if (target.closest('[data-pdf-item="true"]')) {
        return
      }

      // Clicked outside! Clear selection so highlighting and handles disappear
      setSelectedId(null)
    }

    window.addEventListener('pointerdown', handleGlobalPointerDown)
    return () => window.removeEventListener('pointerdown', handleGlobalPointerDown)
  }, [selectedId])

  // ------------------------------------------------------------ drag engine
  const startDrag = useCallback((state: DragState) => {
    dragRef.current = state
    setDrag(state)
  }, [])

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const rect = d.overlay.getBoundingClientRect()
      const curX = clamp((e.clientX - rect.left) / rect.width, 0, 1)
      const curY = clamp((e.clientY - rect.top) / rect.height, 0, 1)
      const dx = curX - d.startX
      const dy = curY - d.startY

      if (d.mode === 'maybe-move') {
        if (Math.hypot(dx, dy) > 0.006) {
          d.mode = 'move'
        } else {
          return
        }
      }

      if (d.mode === 'move') {
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== d.id) return it
            if (it.kind === 'text') {
              return {
                ...it,
                x: clamp(d.origX + dx, 0, 0.95),
                y: clamp(d.origY + dy, 0, 0.98),
              }
            }
            if (it.kind === 'signature') {
              const pAspect = pagePt ? pagePt.h / pagePt.w : 1.3
              const sigH = typeof it.h === 'number' && it.h > 0 ? it.h : (it.w * it.aspect) / pAspect
              return {
                ...it,
                x: clamp(d.origX + dx, 0, Math.max(0, 1 - it.w)),
                y: clamp(d.origY + dy, 0, Math.max(0, 1 - sigH)),
              }
            }
            return {
              ...it,
              x: clamp(d.origX + dx, 0, 1 - it.w),
              y: clamp(d.origY + dy, 0, 1 - it.h),
            }
          }),
        )
      } else if (d.mode === 'resize') {
        const handle = d.handle ?? 'se'
        const isBoth = resizeBothSidesRef.current || e.altKey

        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== d.id) return it
            if (it.kind === 'signature') {
              const pAspect = pagePt ? pagePt.h / pagePt.w : 1.3
              const origH = d.origH > 0 ? d.origH : (d.origW * (it.aspect || 0.4)) / pAspect
              const origCenterX = d.origX + d.origW / 2
              const origCenterY = d.origY + origH / 2

              const affectsX = handle === 'e' || handle === 'w' || handle === 'se' || handle === 'sw' || handle === 'ne' || handle === 'nw'
              const affectsY = handle === 'n' || handle === 's' || handle === 'se' || handle === 'sw' || handle === 'ne' || handle === 'nw'

              let newX = it.x
              let newW = it.w
              let newY = it.y
              let newH = typeof it.h === 'number' && it.h > 0 ? it.h : origH

              if (affectsX) {
                if (isBoth) {
                  const deltaW = (handle === 'e' || handle === 'se' || handle === 'ne') ? dx * 2 : -dx * 2
                  const maxSymW = Math.max(0.04, 2 * Math.min(origCenterX, 1 - origCenterX))
                  newW = clamp(d.origW + deltaW, 0.04, Math.min(0.95, maxSymW))
                  newX = clamp(origCenterX - newW / 2, 0, Math.max(0, 1 - newW))
                } else if (handle === 'e' || handle === 'se' || handle === 'ne') {
                  const maxWidth = Math.max(0.04, 1 - d.origX)
                  newW = clamp(d.origW + dx, 0.04, Math.min(0.95, maxWidth))
                  newX = d.origX
                } else {
                  const rightEdge = d.origX + d.origW
                  newW = clamp(d.origW - dx, 0.04, Math.min(0.95, rightEdge))
                  newX = clamp(rightEdge - newW, 0, Math.max(0, 1 - newW))
                }
              }

              if (affectsY) {
                if (isBoth) {
                  // Symmetrical vertical resize (both upward & downward from vertical center)
                  const deltaH = (handle === 's' || handle === 'se' || handle === 'sw') ? dy * 2 : -dy * 2
                  const maxSymH = Math.max(0.02, 2 * Math.min(origCenterY, 1 - origCenterY))
                  newH = clamp(origH + deltaH, 0.02, Math.min(0.95, maxSymH))
                  newY = clamp(origCenterY - newH / 2, 0, Math.max(0, 1 - newH))
                } else if (handle === 's' || handle === 'se' || handle === 'sw') {
                  // Downward resize: top edge stays at d.origY, bottom edge moves
                  const maxHeight = Math.max(0.02, 1 - d.origY)
                  newH = clamp(origH + dy, 0.02, Math.min(0.95, maxHeight))
                  newY = d.origY
                } else {
                  // Upward resize: bottom edge stays at d.origY + origH, top edge moves upward
                  const bottomEdge = d.origY + origH
                  newH = clamp(origH - dy, 0.02, Math.min(0.95, bottomEdge))
                  newY = clamp(bottomEdge - newH, 0, Math.max(0, 1 - newH))
                }
              } else if (affectsX && it.h === undefined) {
                // Pure width resize when custom height wasn't set: scale height proportionally within page bounds
                const propH = (newW * (it.aspect || 0.4)) / pAspect
                if (d.origY + propH <= 1) {
                  newH = propH
                } else {
                  newH = Math.max(0.02, 1 - d.origY)
                }
              }

              return { ...it, x: newX, y: newY, w: newW, h: newH }
            }
            if (it.kind === 'highlight' || it.kind === 'blackout') {
              if (handle === 'e') {
                const newW = clamp(d.origW + dx, 0.01, 1 - it.x)
                return { ...it, w: newW }
              } else if (handle === 'w') {
                const rightEdge = d.origX + d.origW
                const newW = clamp(d.origW - dx, 0.01, rightEdge)
                const newX = clamp(rightEdge - newW, 0, 1)
                return { ...it, x: newX, w: newW }
              }
              const newW = clamp(d.origW + dx, 0.01, 1 - it.x)
              const newH = clamp(d.origH + dy, 0.005, 1 - it.y)
              return { ...it, w: newW, h: newH }
            }
            return it
          }),
        )
      } else if (d.mode === 'create-rect') {
        const x = Math.min(d.anchorX, curX)
        const y = Math.min(d.anchorY, curY)
        const w = Math.abs(curX - d.anchorX)
        const h = Math.abs(curY - d.anchorY)
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== d.id) return it
            return { ...it, x, y, w, h } as PdfEditItem
          }),
        )
      }
    }

    const onUp = () => {
      const d = dragRef.current
      if (d?.mode === 'create-rect') {
        const it = itemsRef.current.find((i) => i.id === d.id)
        if (it && it.kind !== 'text' && it.kind !== 'signature' && it.w < 0.01 && it.h < 0.01) {
          const pruned = itemsRef.current.filter((i) => i.id !== d.id)
          commitItems(pruned)
        } else {
          commitItems(itemsRef.current)
        }
      } else if (d && (d.mode === 'move' || d.mode === 'resize')) {
        commitItems(itemsRef.current)
      }
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
    }
  }, [drag, commitItems])

  const onItemPointerDown = (e: React.PointerEvent, item: PdfEditItem) => {
    if (item.kind === 'text' && selectedId === item.id) {
      e.stopPropagation()
      return
    }
    if (tool !== 'select') {
      setTool('select')
    }
    e.preventDefault()
    e.stopPropagation()
    setSelectedId(item.id)
    const overlay = overlayRef.current
    if (!overlay) return
    const rect = overlay.getBoundingClientRect()
    const startX = (e.clientX - rect.left) / rect.width
    const startY = (e.clientY - rect.top) / rect.height
    const latestItem = itemsRef.current.find((it) => it.id === item.id) || item
    const pAspect = pagePt ? pagePt.h / pagePt.w : 1.3
    const orig = origOf(latestItem, pAspect)
    startDrag({
      mode: item.kind === 'signature' ? 'move' : 'maybe-move',
      id: item.id,
      startX,
      startY,
      anchorX: orig.x,
      anchorY: orig.y,
      origX: orig.x,
      origY: orig.y,
      origW: orig.w,
      origH: orig.h,
      overlay,
    })
  }

  const onResizePointerDown = (
    e: React.PointerEvent,
    item: PdfEditItem,
    handle: 'se' | 'sw' | 'ne' | 'nw' | 'e' | 'w' | 'n' | 's' = 'se',
  ) => {
    e.stopPropagation()
    const overlay = overlayRef.current
    if (!overlay) return
    const rect = overlay.getBoundingClientRect()
    const startX = (e.clientX - rect.left) / rect.width
    const startY = (e.clientY - rect.top) / rect.height
    const latestItem = itemsRef.current.find((it) => it.id === item.id) || item
    const pAspect = pagePt ? pagePt.h / pagePt.w : 1.3
    const orig = origOf(latestItem, pAspect)
    startDrag({
      mode: 'resize',
      id: item.id,
      startX,
      startY,
      anchorX: orig.x,
      anchorY: orig.y,
      origX: orig.x,
      origY: orig.y,
      origW: orig.w,
      origH: orig.h,
      overlay,
      handle,
    })
  }

  // ------------------------------------------------------ overlay interactions
  const onOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== overlayRef.current) return
    const overlay = overlayRef.current
    if (!overlay) return
    const rect = overlay.getBoundingClientRect()
    const fx = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    const fy = clamp((e.clientY - rect.top) / rect.height, 0, 1)

    if (tool === 'select') {
      setSelectedId(null)
      return
    }

    if (tool === 'text') {
      const item: PdfEditItem = {
        id: newId(),
        kind: 'text',
        page: pageNum - 1,
        x: clamp(fx, 0, 0.95),
        y: clamp(fy, 0, 0.98),
        text: 'Type here',
        fontSize: 14,
        color: '#111827',
      }
      commitItems([...items, item])
      setSelectedId(item.id)
      justCreatedId.current = item.id
      setTool('select')
      return
    }

    if (tool === 'date') {
      const todayStr = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(new Date())
      const item: PdfEditItem = {
        id: newId(),
        kind: 'text',
        page: pageNum - 1,
        x: clamp(fx - 0.04, 0, 0.95),
        y: clamp(fy - 0.015, 0, 0.97),
        text: todayStr,
        fontSize: 14,
        color: '#111827',
      }
      commitItems([...items, item])
      setSelectedId(item.id)
      setTool('select')
      return
    }

    if (tool === 'check') {
      const item: PdfEditItem = {
        id: newId(),
        kind: 'text',
        page: pageNum - 1,
        x: clamp(fx - 0.01, 0, 0.97),
        y: clamp(fy - 0.02, 0, 0.97),
        text: '✓',
        fontSize: 22,
        color: '#047857',
      }
      commitItems([...items, item])
      setSelectedId(item.id)
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
        y: clamp(fy - 0.05, 0, 0.95),
        w,
        aspect: pendingSig.aspect,
        dataUrl: pendingSig.dataUrl,
      }
      commitItems([...items, item])
      setSelectedId(item.id)
      setPendingSig(null)
      setTool('select')
      return
    }

    if (tool === 'highlight' || tool === 'blackout') {
      const id = newId()
      setItems((prev) => [
        ...prev,
        {
          id,
          kind: tool,
          page: pageNum - 1,
          x: fx,
          y: fy,
          w: 0,
          h: 0,
        },
      ])
      setSelectedId(id)
      startDrag({
        mode: 'create-rect',
        id,
        startX: fx,
        startY: fy,
        anchorX: fx,
        anchorY: fy,
        origX: fx,
        origY: fy,
        origW: 0,
        origH: 0,
        overlay,
      })
    }
  }

  // --------------------------------------------------------------- mutations
  const updateItem = (id: string, patch: Partial<PdfEditItem>) => {
    const updated = itemsRef.current.map((it) => (it.id === id ? ({ ...it, ...patch } as PdfEditItem) : it))
    commitItems(updated)
  }

  const deleteItem = (id: string) => {
    commitItems(itemsRef.current.filter((it) => it.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  // ------------------------------------------------------------- signature pick
  const onSelectSignature = useCallback((sig: PlacedSignature) => {
    const img = new Image()
    img.src = sig.dataUrl
    img.onload = () => {
      const aspect = (img.naturalHeight || 80) / (img.naturalWidth || 200)
      setPendingSig({ ...sig, aspect })
      setTool('signature')
      toast({
        title: 'Signature selected',
        description: 'Click anywhere on the document page to place your signature.',
      })
    }
    setSigModalOpen(false)
  }, [])

  // --------------------------------------------------------------------- rename
  const handleSaveRename = async () => {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === docName) {
      setIsEditingName(false)
      setNameInput(docName)
      return
    }
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (res.ok) {
        setDocName(trimmed)
        setIsEditingName(false)
        toast({ title: 'Document renamed' })
      } else {
        throw new Error('Rename failed')
      }
    } catch {
      toast({ title: 'Could not rename document', variant: 'destructive' })
    }
  }

  // --------------------------------------------------------------------- save
  const handleSave = async () => {
    if (pages.length === 0) return
    setSaving(true)
    try {
      const pageOps: PageOps = {
        order: pages.map((p) => p.originalIndex),
        rotations: pages.reduce<Record<number, number>>((acc, p, idx) => {
          if (p.rotation !== 0) acc[idx] = p.rotation
          return acc
        }, {}),
      }
      const res = await fetch(`/api/documents/${docId}/pdf-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, pageOps }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save the document.')
      toast({
        title: 'Saved successfully',
        description:
          'Your edits and page changes were saved into the PDF file.',
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

  const tools: { id: PdfTool; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
    { id: 'select', icon: MousePointer2, label: 'Select & move' },
    { id: 'text', icon: Type, label: 'Add text' },
    { id: 'date', icon: Calendar, label: 'Date stamp' },
    { id: 'check', icon: Check, label: 'Checkmark' },
    { id: 'highlight', icon: Highlighter, label: 'Highlight' },
    { id: 'blackout', icon: Square, label: 'Redact (black box)' },
  ]

  return (
    <div className="flex h-full flex-1 flex-col min-h-0 overflow-hidden">
      {/* top bar */}
      <header className="shrink-0 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-2.5">
          <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to library">
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">Library</span>
          </Button>
          <Separator orientation="vertical" className="hidden h-6 sm:block" />

          {/* Editable title */}
          {isEditingName ? (
            <div className="flex items-center gap-1">
              <Input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveRename()
                  if (e.key === 'Escape') {
                    setNameInput(docName)
                    setIsEditingName(false)
                  }
                }}
                className="h-8 w-48 text-sm font-semibold sm:w-64"
                autoFocus
              />
              <Button size="sm" variant="ghost" onClick={handleSaveRename} className="h-8 px-2">
                Save
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingName(true)}
              className="group flex max-w-[36vw] items-center gap-1.5 truncate text-left text-sm font-semibold hover:text-emerald-700 sm:max-w-xs"
              title="Click to rename"
            >
              <span className="truncate">{docName}</span>
              <Pencil className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}

          <Badge variant="secondary" className="uppercase">
            PDF
          </Badge>

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
          {/* Thumbnails toggle */}
          {numPages >= 1 && (
            <>
              <Button
                variant={showThumbnails ? 'secondary' : 'ghost'}
                size="icon"
                className="size-9"
                onClick={() => setShowThumbnails((v) => !v)}
                title={showThumbnails ? 'Hide page thumbnails' : 'Show page thumbnails'}
                aria-label="Toggle page thumbnails"
              >
                {showThumbnails ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
              </Button>
              <Separator orientation="vertical" className="mx-0.5 h-6" />
            </>
          )}

          {/* page nav with quick jump */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              disabled={pageNum <= 1}
              onClick={() => {
                setPageNum((p) => Math.max(1, p - 1))
                setSelectedId(null)
              }}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>

            <div className="flex items-center gap-1 text-sm tabular-nums text-muted-foreground">
              <input
                type="number"
                min={1}
                max={numPages || 1}
                value={pageNum}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (val >= 1 && val <= numPages) {
                    setPageNum(val)
                    setSelectedId(null)
                  }
                }}
                className="h-7 w-12 rounded border bg-transparent text-center font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
                aria-label="Page number"
              />
              <span>/ {numPages ? numPages : '–'}</span>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              disabled={pageNum >= numPages}
              onClick={() => {
                setPageNum((p) => Math.min(numPages, p + 1))
                setSelectedId(null)
              }}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>

            {/* Quick Rotate Active Page */}
            <div className="flex items-center gap-0.5 ml-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-9"
                onClick={() => rotatePage(pageNum - 1, -90)}
                title="Rotate current page 90° counter-clockwise"
                aria-label="Rotate CCW"
              >
                <RotateCcw className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-9"
                onClick={() => rotatePage(pageNum - 1, 90)}
                title="Rotate current page 90° clockwise"
                aria-label="Rotate CW"
              >
                <RotateCw className="size-4" />
              </Button>
            </div>
          </div>

          <Separator orientation="vertical" className="mx-1 h-6" />

          {/* Undo / Redo */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              disabled={historyIndex <= 0}
              onClick={undo}
              title="Undo (Ctrl+Z / ⌘Z)"
              aria-label="Undo"
            >
              <Undo2 className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              disabled={historyIndex >= history.length - 1}
              onClick={redo}
              title="Redo (Ctrl+Y / ⌘Shift+Z)"
              aria-label="Redo"
            >
              <Redo2 className="size-4" />
            </Button>
          </div>

          <Separator orientation="vertical" className="mx-1 h-6" />

          {/* zoom */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.2) * 10) / 10))}
              aria-label="Zoom out"
            >
              <ZoomOut className="size-4" />
            </Button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="min-w-10 rounded px-1 py-0.5 text-center text-xs tabular-nums text-muted-foreground hover:bg-muted"
              title="Reset zoom to 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
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
                className="size-9"
                onClick={() => {
                  setTool(t.id)
                  if (t.id !== 'select') setSelectedId(null)
                  if (t.id !== 'signature') setPendingSig(null)
                }}
                title={t.label}
                aria-label={t.label}
              >
                <t.icon className="size-4" />
              </Button>
            ))}

            <Button
              variant={tool === 'signature' ? 'default' : 'outline'}
              size="sm"
              className="ml-1 h-9 border-emerald-600 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-950"
              onClick={() => setSigModalOpen(true)}
            >
              <PenTool className="size-4" />
              Sign
            </Button>
          </div>
        </div>
      </header>

      {/* body with optional thumbnail sidebar */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Thumbnails Sidebar */}
        {showThumbnails && numPages >= 1 && !loading && !loadError && (
          <aside className="slim-scroll flex w-44 shrink-0 flex-col gap-3 overflow-y-auto border-r bg-muted/20 p-3 sm:w-48">
            <div className="flex items-center justify-between pb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pages ({pages.length})
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => rotateAllPages(90)}
                  title="Rotate all pages 90° clockwise"
                >
                  <RotateCw className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowThumbnails(false)}
                  title="Hide thumbnails"
                >
                  <PanelLeftClose className="size-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2.5">
              {pages.map((p, idx) => (
                <PageThumbnail
                  key={p.id}
                  pdfDoc={pdfDoc}
                  pageIndex={p.originalIndex}
                  displayPageNumber={idx + 1}
                  rotation={p.rotation}
                  isActive={pageNum === idx + 1}
                  editCount={items.filter((it) => it.page === idx).length}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < pages.length - 1}
                  canDelete={pages.length > 1}
                  onRotateCW={() => rotatePage(idx, 90)}
                  onRotateCCW={() => rotatePage(idx, -90)}
                  onMoveUp={() => movePage(idx, 'up')}
                  onMoveDown={() => movePage(idx, 'down')}
                  onDelete={() => deletePage(idx)}
                  onClick={() => {
                    setPageNum(idx + 1)
                    setSelectedId(null)
                  }}
                />
              ))}
            </div>
          </aside>
        )}

        {/* main canvas area */}
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
                style={{
                  width: displayW,
                  height: pagePt ? Math.round((displayW * pagePt.h) / pagePt.w) : displayW * 1.3,
                }}
              >
                <canvas ref={canvasRef} className="block" aria-label={`PDF page ${pageNum}`} />
                {/* editing overlay */}
                <div
                  ref={overlayRef}
                  className={cn(
                    'absolute inset-0',
                    (tool === 'text' || tool === 'date') && 'cursor-text',
                    tool === 'check' && 'cursor-pointer',
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
                            data-pdf-item="true"
                            ref={(el) => {
                              if (el) {
                                itemEls.current.set(item.id, el)
                                if (el.dataset.init !== '1') {
                                  el.dataset.init = '1'
                                  el.innerText = item.text
                                }
                                if (justCreatedId.current === item.id) {
                                  justCreatedId.current = null
                                  setTimeout(() => {
                                    el.focus()
                                    const r = document.createRange()
                                    r.selectNodeContents(el)
                                    const s = window.getSelection()
                                    s?.removeAllRanges()
                                    s?.addRange(r)
                                  }, 0)
                                }
                              } else {
                                itemEls.current.delete(item.id)
                              }
                            }}
                            contentEditable
                            suppressContentEditableWarning
                            spellCheck={false}
                            onInput={(e) => {
                              const newText = (e.currentTarget as HTMLElement).innerText
                              setItems((prev) =>
                                prev.map((it) => (it.id === item.id ? { ...it, text: newText } : it)),
                              )
                            }}
                            onBlur={(e) => {
                              const newText = (e.currentTarget as HTMLElement).innerText
                              updateItem(item.id, { text: newText })
                            }}
                            onPointerDown={(e) => onItemPointerDown(e, item)}
                            className={cn(
                              'absolute whitespace-pre-wrap rounded-sm border border-dashed border-transparent px-0.5 leading-[1.25] hover:border-zinc-300',
                              selected && 'border-emerald-500/80',
                            )}
                            style={{
                              left: `${item.x * 100}%` as const,
                              top: `${item.y * 100}%` as const,
                              maxWidth: `${(1 - item.x) * 100}%` as const,
                              fontSize: `${item.fontSize * pxPerPt}px`,
                              lineHeight: 1.25,
                              color: item.color,
                              cursor: tool === 'select' ? 'move' : 'default',
                              touchAction: 'none',
                            }}
                          />
                        )
                      }
                      if (item.kind === 'signature') {
                        const isDraggingCurrent = drag?.id === item.id && drag?.mode === 'move'
                        return (
                          <div
                            key={item.id}
                            data-pdf-item="true"
                            onPointerDown={(e) => onItemPointerDown(e, item)}
                            className={cn(
                              'group absolute select-none transition-shadow',
                              selected ? 'ring-2 ring-emerald-500 rounded shadow-md' : 'hover:ring-1 hover:ring-emerald-400/50 rounded',
                              isDraggingCurrent ? 'cursor-grabbing shadow-xl ring-2 ring-emerald-600 scale-[1.01]' : 'cursor-grab',
                            )}
                            style={{
                              left: `${item.x * 100}%`,
                              top: `${item.y * 100}%`,
                              width: `${item.w * 100}%`,
                              height: `${((typeof item.h === 'number' && item.h > 0 ? item.h : (item.w * (item.aspect || 0.4)) / (pagePt ? pagePt.h / pagePt.w : 1.3)) * 100)}%`,
                              touchAction: 'none',
                            }}
                            title="Click and drag to move signature"
                          >
                            <img
                              src={item.dataUrl}
                              alt="Signature"
                              draggable={false}
                              className="block h-full w-full select-none pointer-events-none"
                            />
                            {selected && (
                              <>
                                {/* Floating quick bar right above selected signature */}
                                <div
                                  className="pointer-events-auto absolute -top-10 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-md border bg-background/95 px-1.5 py-0.5 text-xs shadow-lg backdrop-blur select-none z-40"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onPointerDown={(e) => e.stopPropagation()}
                                >
                                  <Button
                                    type="button"
                                    variant={resizeBothSides ? 'secondary' : 'ghost'}
                                    size="sm"
                                    className="h-6 px-1.5 text-[11px] font-semibold gap-1"
                                    title={resizeBothSides ? 'Resizing from both sides (symmetrical)' : 'Resizing from one side'}
                                    onClick={() => setResizeBothSides(!resizeBothSides)}
                                  >
                                    <ArrowLeftRight className="size-3" />
                                    {resizeBothSides ? 'Both sides' : 'One side'}
                                  </Button>
                                  <div className="flex items-center gap-0.5 border-l border-r px-1">
                                    {([
                                      { label: 'S', title: 'Small', w: 0.18 },
                                      { label: 'M', title: 'Medium', w: 0.28 },
                                      { label: 'L', title: 'Large', w: 0.42 },
                                    ] as const).map((preset) => (
                                      <Button
                                        key={preset.label}
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-1.5 text-[11px] font-semibold"
                                        title={preset.title}
                                        onClick={() => {
                                          const pAspect = pagePt ? pagePt.h / pagePt.w : 1.3
                                          const maxWByHeight = Math.max(0.05, ((1 - item.y) * pAspect) / (item.aspect || 0.4))
                                          const newW = clamp(preset.w, 0.05, Math.min(0.95, maxWByHeight))
                                          const newH = clamp((newW * (item.aspect || 0.4)) / pAspect, 0.02, Math.max(0.02, 1 - item.y))
                                          if (resizeBothSides) {
                                            const origCenterX = item.x + item.w / 2
                                            const newX = clamp(origCenterX - newW / 2, 0, Math.max(0, 1 - newW))
                                            updateItem(item.id, { x: newX, w: newW, h: newH })
                                          } else {
                                            const clampedW = Math.min(newW, 1 - item.x)
                                            updateItem(item.id, { w: clampedW, h: newH })
                                          }
                                        }}
                                      >
                                        {preset.label}
                                      </Button>
                                    ))}
                                  </div>
                                  <div className="flex items-center gap-0.5">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="size-6 text-xs"
                                      title="Decrease width"
                                      onClick={() => {
                                        const newW = clamp(item.w - 0.03, 0.05, 0.95)
                                        if (resizeBothSides) {
                                          const origCenterX = item.x + item.w / 2
                                          const newX = clamp(origCenterX - newW / 2, 0, Math.max(0, 1 - newW))
                                          updateItem(item.id, { x: newX, w: newW })
                                        } else {
                                          updateItem(item.id, { w: newW })
                                        }
                                      }}
                                    >
                                      -
                                    </Button>
                                    <span className="min-w-[36px] text-center font-mono text-[11px] font-medium text-foreground">
                                      {Math.round(item.w * 100)}%
                                    </span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="size-6 text-xs"
                                      title="Increase width"
                                      onClick={() => {
                                        const pAspect = pagePt ? pagePt.h / pagePt.w : 1.3
                                        const maxWByHeight = Math.max(0.05, ((1 - item.y) * pAspect) / (item.aspect || 0.4))
                                        const newW = clamp(item.w + 0.03, 0.05, Math.min(0.95, maxWByHeight))
                                        if (resizeBothSides) {
                                          const origCenterX = item.x + item.w / 2
                                          const newX = clamp(origCenterX - newW / 2, 0, Math.max(0, 1 - newW))
                                          updateItem(item.id, { x: newX, w: newW })
                                        } else {
                                          const clampedW = Math.min(newW, 1 - item.x)
                                          updateItem(item.id, { w: clampedW })
                                        }
                                      }}
                                    >
                                      +
                                    </Button>
                                  </div>
                                  <Separator orientation="vertical" className="h-3.5 mx-0.5" />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    title="Delete"
                                    onClick={() => deleteItem(item.id)}
                                  >
                                    <Trash2 className="size-3" />
                                  </Button>
                                </div>
                                {/* Top height handle (top pill/bar) */}
                                <span
                                  role="button"
                                  aria-label="Resize height top"
                                  title="Drag upward or downward to resize height"
                                  className="absolute -top-2 left-1/2 -translate-x-1/2 h-2.5 w-7 cursor-ns-resize rounded-full border-2 border-white bg-emerald-600 shadow-md transition-transform hover:scale-125 flex items-center justify-center z-30"
                                  style={{ touchAction: 'none' }}
                                  onPointerDown={(e) => onResizePointerDown(e, item, 'n')}
                                >
                                  <span className="block h-0.5 w-2.5 bg-white/90 rounded-full" />
                                </span>

                                {/* Bottom height handle (bottom pill/bar) */}
                                <span
                                  role="button"
                                  aria-label="Resize height bottom"
                                  title="Drag downward or upward to resize height"
                                  className="absolute -bottom-2 left-1/2 -translate-x-1/2 h-2.5 w-7 cursor-ns-resize rounded-full border-2 border-white bg-emerald-600 shadow-md transition-transform hover:scale-125 flex items-center justify-center z-30"
                                  style={{ touchAction: 'none' }}
                                  onPointerDown={(e) => onResizePointerDown(e, item, 's')}
                                >
                                  <span className="block h-0.5 w-2.5 bg-white/90 rounded-full" />
                                </span>

                                {/* Top draggable edge hitbox */}
                                <div
                                  className="absolute inset-x-0 -top-1.5 h-3 cursor-ns-resize z-20"
                                  style={{ touchAction: 'none' }}
                                  title="Drag to resize height"
                                  onPointerDown={(e) => onResizePointerDown(e, item, 'n')}
                                />

                                {/* Bottom draggable edge hitbox */}
                                <div
                                  className="absolute inset-x-0 -bottom-1.5 h-3 cursor-ns-resize z-20"
                                  style={{ touchAction: 'none' }}
                                  title="Drag to resize height"
                                  onPointerDown={(e) => onResizePointerDown(e, item, 's')}
                                />

                                {/* Left width handle (side pill/bar) */}
                                <span
                                  role="button"
                                  aria-label="Resize width left"
                                  title="Drag to resize width"
                                  className="absolute top-1/2 -left-2 -translate-y-1/2 h-7 w-2.5 cursor-ew-resize rounded-full border-2 border-white bg-emerald-600 shadow-md transition-transform hover:scale-125 flex items-center justify-center z-30"
                                  style={{ touchAction: 'none' }}
                                  onPointerDown={(e) => onResizePointerDown(e, item, 'w')}
                                >
                                  <span className="block w-0.5 h-2.5 bg-white/90 rounded-full" />
                                </span>

                                {/* Right width handle (side pill/bar) */}
                                <span
                                  role="button"
                                  aria-label="Resize width right"
                                  title="Drag to resize width"
                                  className="absolute top-1/2 -right-2 -translate-y-1/2 h-7 w-2.5 cursor-ew-resize rounded-full border-2 border-white bg-emerald-600 shadow-md transition-transform hover:scale-125 flex items-center justify-center z-30"
                                  style={{ touchAction: 'none' }}
                                  onPointerDown={(e) => onResizePointerDown(e, item, 'e')}
                                >
                                  <span className="block w-0.5 h-2.5 bg-white/90 rounded-full" />
                                </span>

                                {/* Left draggable edge hitbox */}
                                <div
                                  className="absolute inset-y-0 -left-1.5 w-3 cursor-ew-resize z-20"
                                  style={{ touchAction: 'none' }}
                                  title="Drag to resize width"
                                  onPointerDown={(e) => onResizePointerDown(e, item, 'w')}
                                />

                                {/* Right draggable edge hitbox */}
                                <div
                                  className="absolute inset-y-0 -right-1.5 w-3 cursor-ew-resize z-20"
                                  style={{ touchAction: 'none' }}
                                  title="Drag to resize width"
                                  onPointerDown={(e) => onResizePointerDown(e, item, 'e')}
                                />

                                {/* Four corner handles */}
                                <span
                                  role="button"
                                  aria-label="Resize signature top-left"
                                  title="Drag to resize"
                                  className="absolute -top-1.5 -left-1.5 size-3.5 cursor-nwse-resize rounded-full border-2 border-white bg-emerald-600 shadow transition-transform hover:scale-125 z-30"
                                  style={{ touchAction: 'none' }}
                                  onPointerDown={(e) => onResizePointerDown(e, item, 'nw')}
                                />
                                <span
                                  role="button"
                                  aria-label="Resize signature top-right"
                                  title="Drag to resize"
                                  className="absolute -top-1.5 -right-1.5 size-3.5 cursor-nesw-resize rounded-full border-2 border-white bg-emerald-600 shadow transition-transform hover:scale-125 z-30"
                                  style={{ touchAction: 'none' }}
                                  onPointerDown={(e) => onResizePointerDown(e, item, 'ne')}
                                />
                                <span
                                  role="button"
                                  aria-label="Resize signature bottom-left"
                                  title="Drag to resize"
                                  className="absolute -bottom-1.5 -left-1.5 size-3.5 cursor-nesw-resize rounded-full border-2 border-white bg-emerald-600 shadow transition-transform hover:scale-125 z-30"
                                  style={{ touchAction: 'none' }}
                                  onPointerDown={(e) => onResizePointerDown(e, item, 'sw')}
                                />
                                <span
                                  role="button"
                                  aria-label="Resize signature bottom-right"
                                  title="Drag to resize"
                                  className="absolute -bottom-1.5 -right-1.5 size-3.5 cursor-nwse-resize rounded-full border-2 border-white bg-emerald-600 shadow transition-transform hover:scale-125 z-30"
                                  style={{ touchAction: 'none' }}
                                  onPointerDown={(e) => onResizePointerDown(e, item, 'se')}
                                />
                              </>
                            )}
                          </div>
                        )
                      }
                      // highlight / blackout
                      return (
                        <div key={item.id} data-pdf-item="true">
                          <div
                            onPointerDown={(e) => onItemPointerDown(e, item)}
                            className={cn(
                              'absolute',
                              item.kind === 'highlight'
                                ? 'bg-yellow-400/45 mix-blend-multiply'
                                : 'bg-zinc-900',
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
                              onPointerDown={(e) => onResizePointerDown(e, item, 'se')}
                            />
                          )}
                        </div>
                      )
                    })}
                </div>
              </div>

              {/* selected item controls */}
              {selectedItem ? (
                <div
                  ref={selectedControlsRef}
                  className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border bg-background p-3 shadow-sm"
                >
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
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>Size</span>
                        <Button
                          size="icon"
                          variant="outline"
                          className="size-7"
                          onClick={() =>
                            updateItem(selectedItem.id, {
                              fontSize: Math.max(8, selectedItem.fontSize - 2),
                            })
                          }
                        >
                          -
                        </Button>
                        <span className="w-6 text-center tabular-nums text-foreground">
                          {selectedItem.fontSize}
                        </span>
                        <Button
                          size="icon"
                          variant="outline"
                          className="size-7"
                          onClick={() =>
                            updateItem(selectedItem.id, {
                              fontSize: Math.min(96, selectedItem.fontSize + 2),
                            })
                          }
                        >
                          +
                        </Button>
                      </div>
                      <Separator orientation="vertical" className="h-6" />
                      <div className="flex items-center gap-1.5" role="group" aria-label="Text color">
                        {TEXT_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-label={`Text color ${c}`}
                            className={cn(
                              'size-6 rounded-full border shadow-sm transition-transform hover:scale-110',
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
                  {selectedItem.kind === 'signature' && (
                    <>
                      <Separator orientation="vertical" className="h-6" />
                      <Button
                        type="button"
                        variant={resizeBothSides ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 text-xs gap-1 font-medium"
                        onClick={() => setResizeBothSides(!resizeBothSides)}
                        title={resizeBothSides ? 'Resizing from both sides (symmetrical)' : 'Resizing from one side'}
                      >
                        <ArrowLeftRight className="size-3.5" />
                        {resizeBothSides ? 'Both sides' : 'One side'}
                      </Button>
                      <Separator orientation="vertical" className="h-6" />
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>Width</span>
                        <Button
                          size="icon"
                          variant="outline"
                          className="size-7"
                          title="Decrease width"
                          onClick={() => {
                            const newW = clamp(selectedItem.w - 0.03, 0.05, 0.95)
                            if (resizeBothSides) {
                              const origCenterX = selectedItem.x + selectedItem.w / 2
                              const newX = clamp(origCenterX - newW / 2, 0, 1 - newW)
                              updateItem(selectedItem.id, { x: newX, w: newW })
                            } else {
                              updateItem(selectedItem.id, { w: newW })
                            }
                          }}
                        >
                          -
                        </Button>
                        <span className="w-10 text-center font-mono text-xs tabular-nums text-foreground">
                          {Math.round(selectedItem.w * 100)}%
                        </span>
                        <Button
                          size="icon"
                          variant="outline"
                          className="size-7"
                          title="Increase width"
                          onClick={() => {
                            const newW = clamp(selectedItem.w + 0.03, 0.05, 0.95)
                            if (resizeBothSides) {
                              const origCenterX = selectedItem.x + selectedItem.w / 2
                              const newX = clamp(origCenterX - newW / 2, 0, 1 - newW)
                              updateItem(selectedItem.id, { x: newX, w: newW })
                            } else {
                              const maxWidth = Math.max(0.05, 1 - selectedItem.x)
                              updateItem(selectedItem.id, { w: Math.min(newW, maxWidth) })
                            }
                          }}
                        >
                          +
                        </Button>
                      </div>
                      <div className="flex items-center gap-1 text-xs">
                        {(
                          [
                            { label: 'Small', w: 0.18 },
                            { label: 'Medium', w: 0.28 },
                            { label: 'Large', w: 0.42 },
                          ] as const
                        ).map((preset) => (
                          <Button
                            key={preset.label}
                            variant="ghost"
                            size="sm"
                            className={cn(
                              'h-7 px-2 text-xs',
                              Math.abs(selectedItem.w - preset.w) < 0.03 && 'bg-accent font-semibold',
                            )}
                            onClick={() => {
                              const newW = clamp(preset.w, 0.05, 0.95)
                              if (resizeBothSides) {
                                const origCenterX = selectedItem.x + selectedItem.w / 2
                                const newX = clamp(origCenterX - newW / 2, 0, 1 - newW)
                                updateItem(selectedItem.id, { x: newX, w: newW })
                              } else {
                                const maxWidth = Math.max(0.05, 1 - selectedItem.x)
                                updateItem(selectedItem.id, {
                                  w: Math.min(newW, maxWidth),
                                })
                              }
                            }}
                          >
                            {preset.label}
                          </Button>
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
                  {tool === 'select' && 'Tip: click an item to select it, drag to move it, drag side or corner handles to resize width.'}
                  {tool === 'text' && 'Click anywhere on the page to add a text box.'}
                  {tool === 'date' && 'Click anywhere to stamp today’s date.'}
                  {tool === 'check' && 'Click anywhere to stamp a checkmark.'}
                  {tool === 'highlight' && 'Click and drag on the page to highlight an area.'}
                  {tool === 'blackout' && 'Click and drag to draw a redaction box. On save, everything underneath is permanently removed from the PDF.'}
                  {tool === 'signature' && 'Click anywhere on the page to place your signature.'}
                </p>
              )}
            </div>
          )}
        </main>
      </div>

      <SignatureModal open={sigModalOpen} onOpenChange={setSigModalOpen} onSelect={onSelectSignature} />
    </div>
  )
}
