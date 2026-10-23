'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import {
  FileText,
  FileType,
  Loader2,
  Moon,
  PenLine,
  PenTool,
  Plus,
  Trash2,
  UploadCloud,
  Sun,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import SignatureModal from '@/components/signature-modal'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/documents'
import type { DocumentDto, SavedSignature } from '@/lib/types'

const PdfEditor = dynamic(() => import('@/components/pdf-editor'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  ),
})

const DocxEditor = dynamic(() => import('@/components/docx-editor'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  ),
})

type View =
  | { mode: 'library' }
  | { mode: 'pdf'; doc: DocumentDto }
  | { mode: 'docx'; doc: DocumentDto }

export default function Home() {
  const [docs, setDocs] = useState<DocumentDto[]>([])
  const [sigs, setSigs] = useState<SavedSignature[]>([])
  const [view, setView] = useState<View>({ mode: 'library' })
  const [loadingDocs, setLoadingDocs] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [sigModalOpen, setSigModalOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch('/api/documents')
      if (res.ok) setDocs(await res.json())
    } finally {
      setLoadingDocs(false)
    }
  }, [])

  const loadSigs = useCallback(async () => {
    const res = await fetch('/api/signatures')
    if (res.ok) setSigs(await res.json())
  }, [])

  useEffect(() => {
    void loadDocs()
    void loadSigs()
  }, [loadDocs, loadSigs])

  const handleFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase()
      if (!lower.endsWith('.pdf') && !lower.endsWith('.docx')) {
        toast({
          title: 'Unsupported file',
          description: 'Please choose a .pdf or .docx file.',
          variant: 'destructive',
        })
        return
      }
      setUploading(true)
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/documents', { method: 'POST', body: form })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Upload failed')
        toast({
          title: 'Document uploaded',
          description: `“${data.name}” is ready to edit or sign.`,
        })
        await loadDocs()
      } catch (err) {
        toast({
          title: 'Upload failed',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        })
      } finally {
        setUploading(false)
      }
    },
    [loadDocs],
  )

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  const deleteDoc = async (doc: DocumentDto) => {
    if (!window.confirm(`Delete “${doc.name}” permanently?`)) return
    const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
    if (res.ok) {
      toast({ title: 'Document deleted' })
      void loadDocs()
    } else {
      toast({ title: 'Could not delete the document', variant: 'destructive' })
    }
  }

  const deleteSig = async (sig: SavedSignature) => {
    const res = await fetch(`/api/signatures/${sig.id}`, { method: 'DELETE' })
    if (res.ok) {
      setSigs((prev) => prev.filter((s) => s.id !== sig.id))
    }
  }

  // ------------------------------------------------------------- editor views
  if (view.mode === 'pdf') {
    return (
      <div className="flex h-screen flex-col overflow-hidden">
        <PdfEditor
          docId={view.doc.id}
          name={view.doc.name}
          onBack={() => setView({ mode: 'library' })}
          onSaved={loadDocs}
        />
      </div>
    )
  }
  if (view.mode === 'docx') {
    return (
      <div className="flex h-screen flex-col overflow-hidden">
        <DocxEditor
          docId={view.doc.id}
          name={view.doc.name}
          onBack={() => setView({ mode: 'library' })}
          onSaved={loadDocs}
        />
      </div>
    )
  }

  // ------------------------------------------------------------ library view
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <PenLine className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-base font-bold leading-tight">SignFlow</p>
              <p className="text-[11px] leading-tight text-muted-foreground">Edit & sign PDFs and Word docs</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-10"
            aria-label="Toggle dark mode"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          >
            {mounted && resolvedTheme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16">
        {/* hero */}
        <section className="pt-10 pb-6 text-center sm:pt-14">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Edit & sign documents, <span className="text-emerald-600">in seconds</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Upload a PDF or Word file — add text, highlights, redactions and your signature, then download the finished document.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="gap-1.5 py-1.5"><FileText className="size-3.5 text-rose-600" /> PDF editor & signer</Badge>
            <Badge variant="outline" className="gap-1.5 py-1.5"><FileType className="size-3.5 text-emerald-600" /> Word (.docx) editor & signer</Badge>
            <Badge variant="outline" className="gap-1.5 py-1.5"><PenTool className="size-3.5 text-emerald-600" /> Draw, type or upload signatures</Badge>
          </div>
        </section>

        {/* upload zone */}
        <section aria-label="Upload a document">
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload a PDF or DOCX file"
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors sm:p-10',
              dragOver ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40' : 'border-border hover:border-emerald-500/60 hover:bg-muted/50',
            )}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {uploading ? (
              <Loader2 className="size-10 animate-spin text-emerald-600" />
            ) : (
              <UploadCloud className="size-10 text-emerald-600" aria-hidden />
            )}
            <div>
              <p className="font-semibold">{uploading ? 'Uploading…' : 'Drop a PDF or Word document here'}</p>
              <p className="mt-1 text-sm text-muted-foreground">or click to browse · .pdf and .docx · up to 25 MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
                e.target.value = ''
              }}
            />
          </div>
        </section>

        {/* saved signatures */}
        <section aria-label="Saved signatures" className="mt-8">
          <Card className="py-4">
            <CardContent className="flex flex-wrap items-center gap-4 px-4">
              <div className="flex items-center gap-2">
                <PenTool className="size-4 text-emerald-600" aria-hidden />
                <h2 className="text-sm font-semibold">Saved signatures</h2>
              </div>
              {sigs.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No signatures yet — create one while signing a document, or add one now.
                </p>
              ) : (
                <ul className="flex flex-wrap items-center gap-3">
                  {sigs.map((sig) => (
                    <li key={sig.id} className="group relative rounded-md bg-white p-1 shadow-sm">
                      <img
                        src={sig.dataUrl}
                        alt={`Saved signature: ${sig.name}`}
                        title={sig.name}
                        className="h-12 max-w-[140px] object-contain"
                        style={{
                          backgroundImage:
                            'linear-gradient(45deg,#f4f4f5 25%,transparent 25%,transparent 75%,#f4f4f5 75%),linear-gradient(45deg,#f4f4f5 25%,transparent 25%,transparent 75%,#f4f4f5 75%)',
                          backgroundSize: '12px 12px',
                          backgroundPosition: '0 0,6px 6px',
                        }}
                      />
                      <button
                        type="button"
                        aria-label={`Delete signature ${sig.name}`}
                        className="absolute -right-2 -top-2 hidden size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-destructive group-hover:flex"
                        onClick={() => void deleteSig(sig)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => setSigModalOpen(true)}
              >
                <Plus className="size-4" /> New signature
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* documents */}
        <section aria-label="Your documents" className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your documents</h2>
            <span className="text-xs text-muted-foreground">{docs.length} file{docs.length === 1 ? '' : 's'}</span>
          </div>
          {loadingDocs ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : docs.length === 0 ? (
            <div className="rounded-2xl border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
              No documents yet — upload your first PDF or Word file above.
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {docs.map((doc) => (
                <li key={doc.id}>
                  <Card className="flex h-full flex-col py-4 transition-shadow hover:shadow-md">
                    <CardContent className="flex flex-1 flex-col gap-3 px-4">
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            'flex size-10 shrink-0 items-center justify-center rounded-lg',
                            doc.type === 'pdf' ? 'bg-rose-50 text-rose-600 dark:bg-rose-950' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950',
                          )}
                        >
                          {doc.type === 'pdf' ? <FileText className="size-5" /> : <FileType className="size-5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold" title={doc.name}>
                            {doc.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(doc.size)} · updated {new Date(doc.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {doc.signed && (
                          <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
                            <PenTool className="size-3" /> Signed
                          </Badge>
                        )}
                        {doc.hasEdits && !doc.signed && <Badge variant="secondary">Edited</Badge>}
                        <Badge variant="outline" className="uppercase">{doc.type}</Badge>
                      </div>
                      <div className="mt-auto flex items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => setView({ mode: doc.type === 'pdf' ? 'pdf' : 'docx', doc })}
                        >
                          <PenLine className="size-4" />
                          {doc.type === 'pdf' ? 'Edit / Sign' : 'Edit'}
                        </Button>
                        <Button variant="outline" size="icon" className="size-10" asChild>
                          <a href={`/api/documents/${doc.id}/download`} aria-label={`Download ${doc.name}`}>
                            <UploadCloud className="size-4 rotate-180" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-10 text-muted-foreground hover:text-destructive"
                          aria-label={`Delete ${doc.name}`}
                          onClick={() => void deleteDoc(doc)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="mt-auto border-t bg-muted/40">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row">
          <p className="flex items-center gap-1.5">
            <PenLine className="size-3.5 text-emerald-600" />
            SignFlow — edit & sign PDF and Word documents
          </p>
          <p>Files are stored on this server only. Signatures are flattened into downloads.</p>
        </div>
      </footer>

      <SignatureModal
        open={sigModalOpen}
        onOpenChange={setSigModalOpen}
        onSelect={() => {
          setSigModalOpen(false)
          void loadSigs()
        }}
      />
    </div>
  )
}
