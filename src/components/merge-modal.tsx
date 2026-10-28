'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  FileText,
  FileUp,
  Layers,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { formatBytes } from '@/lib/documents'
import type { DocumentDto } from '@/lib/types'

interface MergeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  documents: DocumentDto[]
  initialSelectedIds?: string[]
  onMerged: (mergedDoc: DocumentDto) => void
  onUploadFile?: (file: File) => Promise<void>
}

export default function MergeModal({
  open,
  onOpenChange,
  documents,
  initialSelectedIds = [],
  onMerged,
  onUploadFile,
}: MergeModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [outputName, setOutputName] = useState('Combined Document.pdf')
  const [merging, setMerging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Map of all PDF documents
  const pdfDocs = useMemo(() => documents.filter((d) => d.type === 'pdf'), [documents])
  const pdfMap = useMemo(() => new Map(pdfDocs.map((d) => [d.id, d])), [pdfDocs])

  // Initialize selected files when dialog opens
  useEffect(() => {
    if (open) {
      if (initialSelectedIds.length > 0) {
        setSelectedIds(initialSelectedIds.filter((id) => pdfMap.has(id)))
      } else if (pdfDocs.length >= 2) {
        setSelectedIds([pdfDocs[0].id, pdfDocs[1].id])
      } else if (pdfDocs.length === 1) {
        setSelectedIds([pdfDocs[0].id])
      } else {
        setSelectedIds([])
      }
      setOutputName('Combined Document.pdf')
    }
  }, [open, initialSelectedIds, pdfDocs, pdfMap])

  // Current queue of documents in order
  const queue = useMemo(() => {
    return selectedIds
      .map((id) => pdfMap.get(id))
      .filter((d): d is DocumentDto => d !== undefined)
  }, [selectedIds, pdfMap])

  // Documents available to add from library
  const availableToAdd = useMemo(() => {
    const selectedSet = new Set(selectedIds)
    return pdfDocs.filter((d) => !selectedSet.has(d.id))
  }, [pdfDocs, selectedIds])

  const moveUp = (index: number) => {
    if (index <= 0) return
    setSelectedIds((prev) => {
      const next = [...prev]
      const temp = next[index]
      next[index] = next[index - 1]
      next[index - 1] = temp
      return next
    })
  }

  const moveDown = (index: number) => {
    if (index >= selectedIds.length - 1) return
    setSelectedIds((prev) => {
      const next = [...prev]
      const temp = next[index]
      next[index] = next[index + 1]
      next[index + 1] = temp
      return next
    })
  }

  const removeDoc = (id: string) => {
    setSelectedIds((prev) => prev.filter((item) => item !== id))
  }

  const addDoc = (id: string) => {
    setSelectedIds((prev) => [...prev, id])
  }

  const handleMerge = async () => {
    if (queue.length < 2) {
      toast({
        title: 'Select at least 2 documents',
        description: 'You need at least two PDF documents to merge.',
        variant: 'destructive',
      })
      return
    }

    setMerging(true)
    try {
      const res = await fetch('/api/documents/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentIds: queue.map((d) => d.id),
          name: outputName.trim() || 'Combined Document.pdf',
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to merge documents')
      }

      toast({
        title: 'Documents merged successfully!',
        description: `Combined ${queue.length} files into "${data.document.name}" (${data.pageCount} pages).`,
      })

      onMerged(data.document)
      onOpenChange(false)
    } catch (err) {
      toast({
        title: 'Merge failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setMerging(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="shrink-0 pb-2">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
              <Layers className="size-4" />
            </span>
            <DialogTitle className="text-lg">Merge PDF Documents</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Combine multiple PDFs into a single organized document. Reorder pages by adjusting file sequence.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-4 py-2">
          {/* Output Document Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">
              Merged Document Name
            </label>
            <Input
              type="text"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              placeholder="Combined Document.pdf"
              className="h-9 text-sm"
            />
          </div>

          {/* Merge Order Queue */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground">
                Documents to Combine ({queue.length})
              </label>
              <span className="text-[11px] text-muted-foreground">
                Top document appears first in output
              </span>
            </div>

            {queue.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground bg-muted/20">
                No PDFs selected yet. Add files from below to begin.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {queue.map((doc, idx) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-card p-2.5 transition-all shadow-2xs hover:border-emerald-500/40"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-600/10 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                        {idx + 1}
                      </span>
                      <FileText className="size-4 shrink-0 text-rose-600" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground" title={doc.name}>
                          {doc.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatBytes(doc.size)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={idx === 0}
                        onClick={() => moveUp(idx)}
                        title="Move up"
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={idx === queue.length - 1}
                        onClick={() => moveDown(idx)}
                        title="Move down"
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeDoc(doc.id)}
                        title="Remove from merge list"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Available from Library */}
          {availableToAdd.length > 0 && (
            <div className="space-y-2 pt-2 border-t">
              <label className="text-xs font-semibold text-muted-foreground">
                Add other PDFs from your library
              </label>
              <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-1">
                {availableToAdd.map((doc) => (
                  <Button
                    key={doc.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs border-dashed hover:border-emerald-600 hover:text-emerald-700"
                    onClick={() => addDoc(doc.id)}
                  >
                    <Plus className="size-3" />
                    <span className="max-w-[160px] truncate">{doc.name}</span>
                    <span className="text-[10px] text-muted-foreground">({formatBytes(doc.size)})</span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Quick Upload Button */}
          {onUploadFile && (
            <div className="pt-2 border-t">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (f) {
                    await onUploadFile(f)
                    e.target.value = ''
                  }
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground hover:text-foreground border border-dashed py-3 h-auto gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="size-4 text-emerald-600" />
                Upload and add another PDF from computer
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 pt-3 border-t flex flex-row items-center justify-between sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {queue.length < 2 ? (
              <span className="text-amber-600 dark:text-amber-400">
                Select {2 - queue.length} more {queue.length === 1 ? 'file' : 'files'}
              </span>
            ) : (
              <Badge variant="outline" className="font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300">
                Ready to combine {queue.length} files
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={merging}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={queue.length < 2 || merging}
              onClick={handleMerge}
              className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[130px]"
            >
              {merging ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-1.5" />
                  Merging…
                </>
              ) : (
                <>
                  <Layers className="size-4 mr-1.5" />
                  Merge PDFs
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
