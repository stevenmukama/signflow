'use client'

// SignatureModal — add a signature by drawing, typing, uploading an image, or
// reusing one saved earlier. Emits a PlacedSignature ({ dataUrl, name }) via
// `onSelect` once the user confirms with the "Use signature" button.

// Webfonts used by the Type tab (must be imported client-side so canvas
// rendering can access them).
import '@fontsource/great-vibes'
import '@fontsource/dancing-script/400.css'
import '@fontsource/dancing-script/700.css'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react'
import SignaturePad from 'signature_pad'
import {
  Check,
  Eraser,
  History,
  Loader2,
  PenTool,
  Trash2,
  Type as TypeIcon,
  Upload,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/hooks/use-toast'
import { textToSignatureDataUrl, trimSignatureDataUrl } from '@/lib/signature-utils'
import type { PlacedSignature, SavedSignature } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface SignatureModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (sig: PlacedSignature) => void
}

type TabValue = 'draw' | 'type' | 'upload' | 'saved'

interface SignatureFontOption {
  id: string
  label: string
  /** Full CSS font-family stack used for preview + canvas rendering. */
  family: string
  weight: number
}

const SIGNATURE_FONTS: SignatureFontOption[] = [
  { id: 'great-vibes', label: 'Great Vibes', family: "'Great Vibes', cursive", weight: 400 },
  { id: 'dancing-script', label: 'Dancing Script', family: "'Dancing Script', cursive", weight: 600 },
  {
    id: 'handwriting',
    label: 'Handwriting',
    family: "'Segoe Script','Comic Sans MS',cursive",
    weight: 400,
  },
]

const SIGNATURE_COLORS = [
  { value: '#0f172a', label: 'Dark navy' },
  { value: '#000000', label: 'Black' },
  { value: '#047857', label: 'Emerald' },
  { value: '#b91c1c', label: 'Dark red' },
]

const DEFAULT_COLOR = '#0f172a'
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 // 4 MB
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

// Neutral slate checkerboard shown behind transparent signature previews.
const CHECKER_STYLE: CSSProperties = {
  backgroundImage: 'repeating-conic-gradient(#f1f5f9 0% 25%, #ffffff 0% 50%)',
  backgroundSize: '16px 16px',
}

interface UploadPreview {
  name: string
  size: number
  dataUrl: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function defaultSignatureName(): string {
  return `Signature ${new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`
}

export default function SignatureModal({ open, onOpenChange, onSelect }: SignatureModalProps) {
  const [tab, setTab] = useState<TabValue>('draw')
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(defaultSignatureName)
  const [saveChecked, setSaveChecked] = useState(true)

  // Draw tab
  const [hasInk, setHasInk] = useState(false)
  // The dialog content (Radix portal) mounts/unmounts around animations, so we
  // capture the actual DOM nodes in state — the wiring effect below re-runs
  // every time a NEW canvas/area element is mounted.
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)
  const [areaEl, setAreaEl] = useState<HTMLDivElement | null>(null)
  const padRef = useRef<SignaturePad | null>(null)

  // Type tab
  const [text, setText] = useState('')
  const [fontId, setFontId] = useState<string>(SIGNATURE_FONTS[0].id)
  const [color, setColor] = useState<string>(DEFAULT_COLOR)

  // Upload tab
  const [upload, setUpload] = useState<UploadPreview | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Saved tab
  const [savedList, setSavedList] = useState<SavedSignature[]>([])
  const [savedLoading, setSavedLoading] = useState(false)
  const [savedError, setSavedError] = useState<string | null>(null)
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const activeFont = SIGNATURE_FONTS.find((f) => f.id === fontId) ?? SIGNATURE_FONTS[0]

  const fetchSaved = useCallback(async () => {
    setSavedLoading(true)
    setSavedError(null)
    try {
      const res = await fetch('/api/signatures')
      if (!res.ok) {
        throw new Error(`Could not load saved signatures (HTTP ${res.status}).`)
      }
      const data = (await res.json()) as SavedSignature[]
      setSavedList(data)
    } catch (err) {
      setSavedError(err instanceof Error ? err.message : 'Could not load saved signatures.')
    } finally {
      setSavedLoading(false)
    }
  }, [])

  // Reset transient state and refresh the saved list every time the dialog opens.
  useEffect(() => {
    if (!open) return
    setTab('draw')
    setSaving(false)
    setSaveChecked(true)
    setText('')
    setColor(DEFAULT_COLOR)
    setFontId(SIGNATURE_FONTS[0].id)
    setUpload(null)
    setSelectedSavedId(null)
    setName(defaultSignatureName())
    void fetchSaved()
  }, [open, fetchSaved])

  // Wire up signature_pad whenever the Draw tab becomes visible. The canvas is
  // sized to its container (× devicePixelRatio for crispness) and the pad is
  // recreated on resize, since signature_pad cannot survive canvas resizing.
  useEffect(() => {
    if (!open || tab !== 'draw' || !canvasEl || !areaEl) return
    const canvas = canvasEl
    const area = areaEl
    if (!canvas.isConnected || !area.isConnected) return

    let lastWidth = 0
    let lastHeight = 0

    const setup = () => {
      const width = area.clientWidth
      const height = area.clientHeight
      if (width < 2 || height < 2) return
      if (width === lastWidth && height === lastHeight && padRef.current) return
      lastWidth = width
      lastHeight = height

      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      // Resetting width/height clears the canvas and its transform.
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      // signature_pad draws in CSS-pixel coordinates — scale for HiDPI export.
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(ratio, ratio)

      padRef.current?.off()
      const pad = new SignaturePad(canvas, {
        penColor: '#0f172a',
        backgroundColor: 'rgba(0,0,0,0)', // keep it transparent
        minWidth: 2,
        maxWidth: 2.5,
      })
      pad.addEventListener('endStroke', () => setHasInk(!pad.isEmpty()))
      padRef.current = pad
      setHasInk(false)
    }

    setup()
    const observer = new ResizeObserver(setup)
    observer.observe(area)

    return () => {
      observer.disconnect()
      padRef.current?.off()
      padRef.current = null
    }
  }, [open, tab, canvasEl, areaEl])

  const handleClearDraw = () => {
    padRef.current?.clear()
    setHasInk(false)
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset so selecting the same file again still fires a change event.
    e.target.value = ''
    if (!file) return

    if (file.type && !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast({
        title: 'Unsupported file type',
        description: 'Please choose a PNG, JPEG or WebP image.',
        variant: 'destructive',
      })
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({
        title: 'Image too large',
        description: 'Please choose an image smaller than 4 MB.',
        variant: 'destructive',
      })
      return
    }

    const reader = new FileReader()
    reader.onerror = () => {
      toast({
        title: 'Could not read the file',
        description: 'Please try a different image.',
        variant: 'destructive',
      })
    }
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl.startsWith('data:image/')) {
        toast({
          title: 'Unsupported file type',
          description: 'Please choose a PNG, JPEG or WebP image.',
          variant: 'destructive',
        })
        return
      }
      setUpload({ name: file.name, size: file.size, dataUrl })
    }
    reader.readAsDataURL(file)
  }

  const selectSaved = (sig: SavedSignature) => {
    setSelectedSavedId(sig.id)
    // Prefill the name with the saved label; the user can still edit it.
    setName(sig.name)
  }

  const deleteSaved = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/signatures/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? 'That signature no longer exists.'
            : `Delete failed (HTTP ${res.status}).`,
        )
      }
      if (selectedSavedId === id) setSelectedSavedId(null)
      await fetchSaved()
    } catch (err) {
      toast({
        title: 'Could not delete signature',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setDeletingId(null)
    }
  }

  const handleUse = async () => {
    if (saving) return
    const finalName = name.trim() || defaultSignatureName()

    // Validate the active tab before doing any async work.
    if (tab === 'draw' && (!padRef.current || padRef.current.isEmpty())) {
      toast({
        title: 'Your signature is empty',
        description: 'Draw your signature in the box first.',
        variant: 'destructive',
      })
      return
    }
    if (tab === 'type' && !text.trim()) {
      toast({
        title: 'Nothing to sign',
        description: 'Type your name first.',
        variant: 'destructive',
      })
      return
    }
    if (tab === 'upload' && !upload) {
      toast({
        title: 'No image selected',
        description: 'Upload a PNG, JPEG or WebP image first.',
        variant: 'destructive',
      })
      return
    }
    if (tab === 'saved' && !selectedSavedId) {
      toast({
        title: 'No signature selected',
        description: 'Pick one of your saved signatures first.',
        variant: 'destructive',
      })
      return
    }

    setSaving(true)
    try {
      let dataUrl: string
      let type: 'draw' | 'type' | 'upload' = 'draw'

      if (tab === 'draw') {
        const pad = padRef.current
        if (!pad) throw new Error('The drawing pad is not ready yet.')
        // Flatten + trim transparent margins so the PNG places cleanly on pages.
        dataUrl = await trimSignatureDataUrl(pad.toDataURL('image/png'))
        type = 'draw'
      } else if (tab === 'type') {
        dataUrl = await textToSignatureDataUrl(text, activeFont.family, color)
        type = 'type'
      } else if (tab === 'upload') {
        if (!upload) throw new Error('No image selected.')
        // Keep uploads as-is (a JPEG's white background is fine on paper).
        dataUrl = upload.dataUrl
        type = 'upload'
      } else {
        const saved = savedList.find((s) => s.id === selectedSavedId)
        if (!saved) throw new Error('That saved signature is no longer available.')
        dataUrl = saved.dataUrl
      }

      if (tab !== 'saved' && saveChecked) {
        const res = await fetch('/api/signatures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: finalName, type, dataUrl }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? `Could not save the signature (HTTP ${res.status}).`)
        }
      }

      onSelect({ dataUrl, name: finalName })
      onOpenChange(false)
    } catch (err) {
      toast({
        title: 'Could not use this signature',
        description:
          err instanceof Error ? err.message : 'Something went wrong. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add your signature</DialogTitle>
          <DialogDescription>
            Draw, type or upload a signature — or reuse one you saved earlier.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="gap-4">
          <TabsList className="grid h-auto w-full grid-cols-4">
            <TabsTrigger value="draw" className="min-h-[44px] gap-1.5">
              <PenTool className="size-4" aria-hidden />
              Draw
            </TabsTrigger>
            <TabsTrigger value="type" className="min-h-[44px] gap-1.5">
              <TypeIcon className="size-4" aria-hidden />
              Type
            </TabsTrigger>
            <TabsTrigger value="upload" className="min-h-[44px] gap-1.5">
              <Upload className="size-4" aria-hidden />
              Upload
            </TabsTrigger>
            <TabsTrigger value="saved" className="min-h-[44px] gap-1.5">
              <History className="size-4" aria-hidden />
              Saved
            </TabsTrigger>
          </TabsList>

          {/* ------------------------------ Draw ------------------------------ */}
          <TabsContent value="draw" className="space-y-3">
            <div
              ref={setAreaEl}
              className="relative h-44 w-full overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-white sm:h-48"
            >
              <canvas
                ref={setCanvasEl}
                role="img"
                aria-label="Signature drawing area"
                className="absolute inset-0 touch-none"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Draw with a mouse, trackpad, pen or finger.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                onClick={handleClearDraw}
                disabled={!hasInk}
              >
                <Eraser className="size-4" aria-hidden />
                Clear
              </Button>
            </div>
          </TabsContent>

          {/* ------------------------------ Type ------------------------------ */}
          <TabsContent value="type" className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="signature-text">Your name</Label>
              <Input
                id="signature-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Jordan Blake"
                autoComplete="name"
                maxLength={80}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Font</Label>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Signature font">
                {SIGNATURE_FONTS.map((font) => (
                  <button
                    key={font.id}
                    type="button"
                    onClick={() => setFontId(font.id)}
                    aria-pressed={fontId === font.id}
                    className={cn(
                      'flex min-h-[44px] items-center justify-center rounded-lg border px-2 py-2 text-xl leading-tight transition-colors',
                      fontId === font.id
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-600'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                    )}
                    style={{ fontFamily: font.family, fontWeight: font.weight }}
                  >
                    {font.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Ink color</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Ink color">
                {SIGNATURE_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    aria-pressed={color === c.value}
                    aria-label={`Ink color: ${c.label}`}
                    title={c.label}
                    className={cn(
                      'size-11 rounded-full border-2 transition-transform',
                      color === c.value
                        ? 'scale-110 border-white ring-2 ring-emerald-600'
                        : 'border-slate-200 hover:scale-105',
                    )}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-xl border bg-slate-50 p-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Live preview</p>
              <div
                className="flex min-h-[64px] items-center justify-center overflow-hidden text-[40px] leading-tight"
                style={{
                  fontFamily: activeFont.family,
                  fontWeight: activeFont.weight,
                  color,
                }}
                aria-hidden
              >
                {text.trim() ? (
                  <span className="truncate">{text}</span>
                ) : (
                  <span className="text-slate-300">Your signature</span>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ----------------------------- Upload ----------------------------- */}
          <TabsContent value="upload" className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileChange}
              className="sr-only"
              aria-label="Choose a signature image"
              tabIndex={-1}
            />
            {!upload ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-44 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 transition-colors hover:border-emerald-600 hover:bg-emerald-50/60 hover:text-emerald-700 sm:h-48"
              >
                <Upload className="size-6" aria-hidden />
                <span className="text-sm font-medium">Click to upload an image</span>
                <span className="text-xs text-muted-foreground">
                  PNG, JPEG or WebP · up to 4 MB
                </span>
              </button>
            ) : (
              <div className="space-y-3">
                <div
                  className="flex h-44 items-center justify-center rounded-xl border p-4 sm:h-48"
                  style={CHECKER_STYLE}
                >
                  <img
                    src={upload.dataUrl}
                    alt={`Uploaded signature preview: ${upload.name}`}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{upload.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(upload.size)}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[44px]"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Replace
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[44px]"
                      onClick={() => setUpload(null)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ------------------------------ Saved ------------------------------ */}
          <TabsContent value="saved" className="space-y-3">
            {savedLoading ? (
              <div
                className="flex h-44 items-center justify-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Loading saved signatures…
              </div>
            ) : savedError ? (
              <div className="flex h-44 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
                <p className="max-w-xs px-4 text-sm text-destructive">{savedError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => void fetchSaved()}
                >
                  Try again
                </Button>
              </div>
            ) : savedList.length === 0 ? (
              <div className="flex h-44 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-center">
                <History className="size-6 text-slate-300" aria-hidden />
                <p className="text-sm font-medium">No saved signatures yet</p>
                <p className="text-xs text-muted-foreground">
                  Create one in Draw, Type or Upload and tick “Save to my signatures”.
                </p>
              </div>
            ) : (
              <ScrollArea className="max-h-64">
                <div className="grid grid-cols-2 gap-3 pr-3 sm:grid-cols-3">
                  {savedList.map((sig) => {
                    const selected = sig.id === selectedSavedId
                    return (
                      <div key={sig.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => selectSaved(sig)}
                          aria-pressed={selected}
                          className={cn(
                            'flex w-full flex-col items-center gap-2 rounded-xl border bg-white p-3 transition-colors',
                            selected
                              ? 'border-emerald-600 ring-1 ring-emerald-600'
                              : 'border-slate-200 hover:border-emerald-600/60',
                          )}
                        >
                          <span
                            className="flex h-24 w-full items-center justify-center overflow-hidden rounded-lg p-1"
                            style={CHECKER_STYLE}
                          >
                            <img
                              src={sig.dataUrl}
                              alt={`Saved signature: ${sig.name}`}
                              className="max-h-24 w-auto max-w-full object-contain"
                            />
                          </span>
                          <span className="w-full truncate text-center text-xs font-medium text-slate-700">
                            {sig.name}
                          </span>
                        </button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={`Delete saved signature: ${sig.name}`}
                          onClick={() => void deleteSaved(sig.id)}
                          disabled={deletingId === sig.id}
                          className="absolute -right-2 -top-2 size-9 rounded-full bg-white opacity-100 shadow-sm sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                        >
                          {deletingId === sig.id ? (
                            <Loader2 className="size-4 animate-spin text-destructive" aria-hidden />
                          ) : (
                            <Trash2 className="size-4 text-destructive" aria-hidden />
                          )}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>

        {/* ------------------------------ Footer ------------------------------ */}
        <div className="space-y-3 border-t pt-4">
          {tab !== 'saved' && (
            <label
              htmlFor="signature-save-checkbox"
              className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm font-medium"
            >
              <Checkbox
                id="signature-save-checkbox"
                checked={saveChecked}
                onCheckedChange={(checked) => setSaveChecked(checked === true)}
              />
              Save to my signatures
            </label>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="signature-name">Signature name</Label>
            <Input
              id="signature-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jordan Blake"
              maxLength={120}
              autoComplete="off"
            />
          </div>
          <Button
            type="button"
            onClick={handleUse}
            disabled={saving}
            className="min-h-[44px] w-full bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600/40"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Check className="size-4" aria-hidden />
            )}
            {saving ? 'Placing…' : 'Use signature'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
