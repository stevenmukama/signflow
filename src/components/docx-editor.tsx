'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowLeftRight,
  Bold,
  Download,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Move,
  Pencil,
  PenTool,
  Plus,
  RemoveFormatting,
  Save,
  Strikethrough,
  Trash2,
  Underline,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { ALLOWED_ATTRIBUTES, ALLOWED_TAGS, isSafeLinkUrl } from '@/lib/html-policy'
import type { PlacedSignature } from '@/lib/types'

/** Same allowlist as the server sanitizer (src/lib/html-sanitizer.ts). */
const PURIFY_CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR: Array.from(new Set(Object.values(ALLOWED_ATTRIBUTES).flat())),
}

interface DocxEditorProps {
  docId: string
  name: string
  onBack: () => void
  onSaved: () => void
}

type BlockTag = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'blockquote'

export default function DocxEditor({ docId, name: initialName, onBack, onSaved }: DocxEditorProps) {
  const [docName, setDocName] = useState(initialName)
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(initialName)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [initialHtml, setInitialHtml] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [sigModalOpen, setSigModalOpen] = useState(false)
  const [blockTag, setBlockTag] = useState<BlockTag>('p')
  const [fontSize, setFontSize] = useState('3')
  const [active, setActive] = useState({ bold: false, italic: false, underline: false, strike: false })
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)

  const mainRef = useRef<HTMLElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)
  const savedRangeRef = useRef<Range | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null)
  const selectedImgRef = useRef<HTMLImageElement | null>(null)
  useEffect(() => {
    selectedImgRef.current = selectedImg
  }, [selectedImg])
  const [imgBox, setImgBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null)

  const syncImgBox = useCallback((overrideImg?: HTMLImageElement | null) => {
    const targetImg = overrideImg !== undefined ? overrideImg : selectedImgRef.current
    if (!targetImg || !mainRef.current || !editorRef.current?.contains(targetImg)) {
      setImgBox(null)
      return
    }
    const mainRect = mainRef.current.getBoundingClientRect()
    const imgRect = targetImg.getBoundingClientRect()
    setImgBox({
      top: imgRect.top - mainRect.top + mainRef.current.scrollTop,
      left: imgRect.left - mainRect.left + mainRef.current.scrollLeft,
      width: imgRect.width,
      height: imgRect.height,
    })
  }, [])

  const updateCounts = useCallback(() => {
    const text = editorRef.current?.innerText || ''
    const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0
    setWordCount(words)
    setCharCount(text.length)
  }, [])

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
      // The server already sanitizes this HTML; sanitize again here so the editor
      // never injects executable markup even if a response is tampered with.
      editorRef.current.innerHTML = DOMPurify.sanitize(initialHtml, PURIFY_CONFIG)
      initializedRef.current = true
      updateCounts()
    }
  }, [loading, loadError, initialHtml, updateCounts])

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

  // Track position of the selected image on scroll / resize
  useEffect(() => {
    syncImgBox(selectedImg)
    const onScrollOrResize = () => syncImgBox()
    const mainEl = mainRef.current
    mainEl?.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('resize', onScrollOrResize, { passive: true })
    return () => {
      mainEl?.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [selectedImg, syncImgBox])

  // Detect clicks on images or outside images in the window
  useEffect(() => {
    const handleGlobalPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return

      // Don't deselect if clicking inside modals/dialogs, popovers, or menus
      if (
        target.closest('[role="dialog"]') ||
        target.closest('[role="menu"]') ||
        target.closest('[data-radix-portal]') ||
        target.closest('[data-radix-popper-content-wrapper]')
      ) {
        return
      }

      // Check if clicking inside the overlay itself (handles, floating toolbar, etc.)
      const overlay = document.getElementById('docx-image-resize-overlay')
      if (overlay?.contains(target)) {
        return
      }

      // Check if clicking on an image inside the editor
      const img = target.closest('img')
      if (img && editorRef.current?.contains(img)) {
        // Normalize any old hardcoded 220px maxWidth so resizing is unrestricted
        if (img.style.maxWidth === '220px') {
          img.style.maxWidth = '100%'
        }
        selectedImgRef.current = img
        setSelectedImg(img)
        syncImgBox(img)
        startDocxImageDrag(e, img)
        return
      }

      // Clicked outside image and outside overlay! Stop highlighting
      setSelectedImg(null)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedImg(null)
      }
    }

    window.addEventListener('pointerdown', handleGlobalPointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const [resizeBothSides, setResizeBothSides] = useState(true)

  // Helper to get the inner content bounds of the DOCX paper
  const getPaperBounds = (el?: HTMLElement | null) => {
    const paper = editorRef.current
    if (!paper) return { left: 0, right: 722, width: 722 }
    const pRect = paper.getBoundingClientRect()
    const cs = window.getComputedStyle(paper)
    const padL = parseFloat(cs.paddingLeft || '64') || 64
    const padR = parseFloat(cs.paddingRight || '64') || 64

    // If inside a table cell or narrower block, respect its bounds too
    const cell = el?.closest('td, th, blockquote')
    if (cell && paper.contains(cell)) {
      const cRect = cell.getBoundingClientRect()
      const ccs = window.getComputedStyle(cell)
      const cPadL = parseFloat(ccs.paddingLeft || '8') || 8
      const cPadR = parseFloat(ccs.paddingRight || '8') || 8
      const left = cRect.left + cPadL
      const right = cRect.right - cPadR
      return { left, right, width: Math.max(80, right - left) }
    }

    const left = pRect.left + padL
    const right = pRect.right - padR
    return { left, right, width: Math.max(120, right - left) }
  }

  // Drag and move signature/image anywhere horizontally or vertically in the document
  const startDocxImageDrag = (e: PointerEvent | React.PointerEvent, targetImg?: HTMLImageElement | null) => {
    const img = targetImg || selectedImg
    if (!img || !editorRef.current) return
    e.preventDefault()
    e.stopPropagation()

    const wrapper =
      img.parentElement && img.parentElement.tagName === 'SPAN' && img.parentElement.childElementCount === 1
        ? img.parentElement
        : img

    // Normalize any legacy relative left offset into marginLeft so position persists on save
    if (wrapper.style.left && wrapper.style.left !== '0px') {
      const legacyLeft = parseFloat(wrapper.style.left) || 0
      const curML = parseFloat(wrapper.style.marginLeft || '0') || 0
      wrapper.style.marginLeft = `${Math.max(0, Math.round(curML + legacyLeft))}px`
      wrapper.style.left = ''
      wrapper.style.position = ''
    }

    const startX = e.clientX
    const startY = e.clientY
    const startBox = img.getBoundingClientRect()
    const grabOffsetX = startX - startBox.left
    const grabOffsetY = startY - startBox.top
    let isDragging = false

    // Create a floating ghost clone that tracks cursor
    const ghost = img.cloneNode(true) as HTMLElement
    ghost.style.position = 'fixed'
    ghost.style.pointerEvents = 'none'
    ghost.style.zIndex = '9999'
    ghost.style.opacity = '0.88'
    ghost.style.boxShadow = '0 12px 28px rgba(0, 0, 0, 0.25)'
    ghost.style.border = '2px solid #10b981'
    ghost.style.borderRadius = '4px'
    ghost.style.width = `${startBox.width}px`
    ghost.style.height = `${startBox.height}px`
    ghost.style.left = `${startBox.left}px`
    ghost.style.top = `${startBox.top}px`
    ghost.style.margin = '0'
    ghost.style.transition = 'none'
    ghost.style.display = 'none'
    document.body.appendChild(ghost)

    // Visual target line / box indicator
    const dropIndicator = document.createElement('div')
    dropIndicator.style.position = 'fixed'
    dropIndicator.style.pointerEvents = 'none'
    dropIndicator.style.zIndex = '9998'
    dropIndicator.style.height = '3px'
    dropIndicator.style.backgroundColor = '#10b981'
    dropIndicator.style.borderRadius = '2px'
    dropIndicator.style.boxShadow = '0 0 8px rgba(16, 185, 129, 0.75)'
    dropIndicator.style.display = 'none'
    document.body.appendChild(dropIndicator)

    const findTargetBlock = (x: number, y: number): { block: HTMLElement; insertAfter: boolean } | null => {
      const paper = editorRef.current
      if (!paper) return null
      const blocks = Array.from(
        paper.querySelectorAll('p, h1, h2, h3, h4, li, blockquote, td, th')
      ).filter((b) => !wrapper.contains(b)) as HTMLElement[]

      if (blocks.length === 0) return null

      let bestBlock = blocks[0]
      let bestDist = Infinity
      let insertAfter = false

      for (const b of blocks) {
        const r = b.getBoundingClientRect()
        if (y >= r.top && y <= r.bottom) {
          return { block: b, insertAfter: y > r.top + r.height / 2 }
        }
        const dist = y < r.top ? r.top - y : y - r.bottom
        if (dist < bestDist) {
          bestDist = dist
          bestBlock = b
          insertAfter = y > r.top + r.height / 2
        }
      }
      return { block: bestBlock, insertAfter }
    }

    const onPointerMove = (moveEv: PointerEvent) => {
      moveEv.preventDefault()
      const dx = moveEv.clientX - startX
      const dy = moveEv.clientY - startY
      if (!isDragging && Math.hypot(dx, dy) > 3) {
        isDragging = true
        ghost.style.display = 'block'
        wrapper.style.opacity = '0.25'
        document.body.style.cursor = 'grabbing'
      }
      if (!isDragging) return

      // Auto-scroll editor container if dragging near top or bottom
      const mainEl = mainRef.current
      if (mainEl) {
        const mRect = mainEl.getBoundingClientRect()
        if (moveEv.clientY < mRect.top + 70) {
          mainEl.scrollTop -= 10
        } else if (moveEv.clientY > mRect.bottom - 70) {
          mainEl.scrollTop += 10
        }
      }

      const bounds = getPaperBounds(img)
      const desiredLeft = Math.max(
        bounds.left,
        Math.min(bounds.right - startBox.width, moveEv.clientX - grabOffsetX)
      )
      const desiredTop = moveEv.clientY - grabOffsetY

      ghost.style.left = `${desiredLeft}px`
      ghost.style.top = `${desiredTop}px`

      const targetInfo = findTargetBlock(moveEv.clientX, moveEv.clientY)
      if (targetInfo) {
        const bRect = targetInfo.block.getBoundingClientRect()
        dropIndicator.style.display = 'block'
        dropIndicator.style.left = `${desiredLeft}px`
        dropIndicator.style.width = `${startBox.width}px`
        dropIndicator.style.top = `${targetInfo.insertAfter ? bRect.bottom : bRect.top}px`
      }
    }

    const onPointerUp = (upEv: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      ghost.remove()
      dropIndicator.remove()
      wrapper.style.opacity = '1'
      document.body.style.cursor = ''

      if (!isDragging) {
        syncImgBox(img)
        return
      }

      const paper = editorRef.current
      if (!paper) return

      const currentBlock = wrapper.closest('p, h1, h2, h3, h4, li, blockquote, td, th') as HTMLElement | null
      const targetInfo = findTargetBlock(upEv.clientX, upEv.clientY)

      // Determine if user dragged vertically to another line/block or stayed on the same line
      const curBlockRect = currentBlock?.getBoundingClientRect()
      const stayedInSameBlock =
        currentBlock &&
        curBlockRect &&
        upEv.clientY >= curBlockRect.top - 18 &&
        upEv.clientY <= curBlockRect.bottom + 18

      if (!stayedInSameBlock && targetInfo && targetInfo.block !== currentBlock) {
        const targetBlock = targetInfo.block
        // Check if targetBlock is an empty paragraph or if we should place wrapper inside/around it
        const targetText = targetBlock.innerText.replace(/\u00a0/g, '').trim()
        const targetHasOtherImages = Array.from(targetBlock.querySelectorAll('img')).some((i) => i !== img)

        if (!targetText && !targetHasOtherImages && (targetBlock.tagName === 'P' || targetBlock.tagName === 'DIV')) {
          targetBlock.innerHTML = ''
          targetBlock.appendChild(wrapper)
        } else if (targetBlock.tagName === 'TD' || targetBlock.tagName === 'TH') {
          targetBlock.appendChild(wrapper)
        } else {
          // If wrapper was the sole child of an empty paragraph, clean up the old empty paragraph
          const oldParentP =
            wrapper.parentElement &&
            wrapper.parentElement.tagName === 'P' &&
            wrapper.parentElement.innerText.replace(/\u00a0/g, '').trim() === '' &&
            wrapper.parentElement.querySelectorAll('img').length === 1
              ? wrapper.parentElement
              : null

          const newP = document.createElement('p')
          newP.appendChild(wrapper)
          if (targetInfo.insertAfter) {
            targetBlock.after(newP)
          } else {
            targetBlock.before(newP)
          }
          if (oldParentP && oldParentP !== newP && oldParentP.childNodes.length === 0) {
            oldParentP.remove()
          }
        }
      }

      // Now calculate and apply the exact horizontal position inside the paper so it stays where dropped!
      const bounds = getPaperBounds(wrapper)
      const imgW = img.getBoundingClientRect().width || startBox.width
      const desiredViewportLeft = Math.max(
        bounds.left,
        Math.min(bounds.right - imgW, upEv.clientX - grabOffsetX)
      )

      // Reset marginLeft to 0 first to measure wrapper's natural X position in the line
      wrapper.style.position = ''
      wrapper.style.left = ''
      wrapper.style.marginLeft = '0px'

      // Ensure parent block is left-aligned so marginLeft positions accurately from the left
      const parentBlock = wrapper.closest('p, h1, h2, h3, h4, li, blockquote, td, th') as HTMLElement | null
      if (parentBlock && parentBlock.style.textAlign && parentBlock.style.textAlign !== 'left') {
        const onlyHasThisImg =
          parentBlock.innerText.replace(/\u00a0/g, '').trim() === '' &&
          parentBlock.querySelectorAll('img').length === 1
        if (onlyHasThisImg) {
          parentBlock.style.textAlign = 'left'
        }
      }

      let naturalLeft = wrapper.getBoundingClientRect().left

      // If wrapper is on the same line after text and the user dragged it further left than the text ends,
      // move wrapper to its own line or adjust so it can reach the desired horizontal position
      if (desiredViewportLeft < naturalLeft - 12 && parentBlock && parentBlock.innerText.trim().length > 0) {
        // If user dragged significantly left of the inline text, put it on a new line right below or clamp to naturalLeft
        if (upEv.clientY > startBox.bottom) {
          const newP = document.createElement('p')
          newP.appendChild(wrapper)
          parentBlock.after(newP)
          naturalLeft = wrapper.getBoundingClientRect().left
        }
      }

      const maxMarginLeft = Math.max(0, bounds.right - naturalLeft - imgW)
      const newMarginLeft = Math.max(0, Math.min(maxMarginLeft, Math.round(desiredViewportLeft - naturalLeft)))
      wrapper.style.marginLeft = `${newMarginLeft}px`

      syncImgBox(img)
      updateCounts()
      toast({ title: 'Signature moved' })
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  // Explicit width preset / stepper
  const setExactImageWidth = (newWidth: number) => {
    if (!selectedImg) return
    const wrapper =
      selectedImg.parentElement &&
      selectedImg.parentElement.tagName === 'SPAN' &&
      selectedImg.parentElement.childElementCount === 1
        ? selectedImg.parentElement
        : selectedImg

    // Normalize any legacy relative left offset into marginLeft
    if (wrapper.style.left && wrapper.style.left !== '0px') {
      const legacyLeft = parseFloat(wrapper.style.left) || 0
      const curML = parseFloat(wrapper.style.marginLeft || '0') || 0
      wrapper.style.marginLeft = `${Math.max(0, Math.round(curML + legacyLeft))}px`
      wrapper.style.left = ''
      wrapper.style.position = ''
    }

    const bounds = getPaperBounds(selectedImg)
    const curRect = selectedImg.getBoundingClientRect()
    const curWidth = curRect.width
    const curMarginLeft = parseFloat(wrapper.style.marginLeft || '0') || 0
    const naturalLeft = curRect.left - curMarginLeft

    const maxPossibleWidth = Math.max(50, Math.floor(bounds.right - naturalLeft))
    const clamped = Math.max(50, Math.min(maxPossibleWidth, Math.round(newWidth)))
    const deltaW = clamped - curWidth

    if (resizeBothSides) {
      const maxML = Math.max(0, Math.floor(bounds.right - naturalLeft - clamped))
      const newML = Math.max(0, Math.min(maxML, Math.round(curMarginLeft - deltaW / 2)))
      wrapper.style.marginLeft = `${newML}px`
    } else {
      const maxML = Math.max(0, Math.floor(bounds.right - naturalLeft - clamped))
      if (curMarginLeft > maxML) {
        wrapper.style.marginLeft = `${maxML}px`
      }
    }

    selectedImg.style.width = `${clamped}px`
    selectedImg.style.maxWidth = '100%'
    selectedImg.style.height = 'auto'
    selectedImg.removeAttribute('height')
    selectedImg.setAttribute('width', String(clamped))
    syncImgBox(selectedImg)
    updateCounts()
  }

  // Interactive resize handle for corner, width (left/right), and height (top/bottom) edges
  const handleResize = (
    e: React.PointerEvent,
    handle: 'se' | 'sw' | 'ne' | 'nw' | 'e' | 'w' | 'n' | 's',
  ) => {
    if (!selectedImg) return
    e.preventDefault()
    e.stopPropagation()

    const wrapper =
      selectedImg.parentElement &&
      selectedImg.parentElement.tagName === 'SPAN' &&
      selectedImg.parentElement.childElementCount === 1
        ? selectedImg.parentElement
        : selectedImg

    // Normalize any legacy relative left offset into marginLeft
    if (wrapper.style.left && wrapper.style.left !== '0px') {
      const legacyLeft = parseFloat(wrapper.style.left) || 0
      const curML = parseFloat(wrapper.style.marginLeft || '0') || 0
      wrapper.style.marginLeft = `${Math.max(0, Math.round(curML + legacyLeft))}px`
      wrapper.style.left = ''
      wrapper.style.position = ''
    }

    const startX = e.clientX
    const startY = e.clientY
    const startRect = selectedImg.getBoundingClientRect()
    const initialWidth = startRect.width
    const initialHeight = startRect.height
    const origMarginLeft = parseFloat(wrapper.style.marginLeft || '0') || 0
    const origMarginTop = parseFloat(wrapper.style.marginTop || '0') || 0
    const naturalLeft = startRect.left - origMarginLeft
    const bounds = getPaperBounds(selectedImg)

    // Available horizontal space to the left (down to naturalLeft) and to the right (up to bounds.right)
    const availLeft = Math.max(0, origMarginLeft)
    const availRight = Math.max(0, bounds.right - startRect.right)
    const maxTotalWidth = Math.max(50, Math.floor(bounds.right - naturalLeft))
    const maxTotalHeight = 500

    const affectsX =
      handle === 'e' ||
      handle === 'w' ||
      handle === 'se' ||
      handle === 'sw' ||
      handle === 'ne' ||
      handle === 'nw'
    const affectsY =
      handle === 'n' ||
      handle === 's' ||
      handle === 'se' ||
      handle === 'sw' ||
      handle === 'ne' ||
      handle === 'nw'

    const onPointerMove = (moveEv: PointerEvent) => {
      moveEv.preventDefault()
      const isBoth = resizeBothSides || moveEv.altKey

      if (affectsX) {
        const isRightSide = handle === 'e' || handle === 'se' || handle === 'ne'
        const rawDeltaX = isRightSide ? moveEv.clientX - startX : startX - moveEv.clientX

        if (isBoth) {
          const deltaW = rawDeltaX * 2
          const newWidth = Math.max(50, Math.min(maxTotalWidth, Math.round(initialWidth + deltaW)))
          const actualDeltaW = newWidth - initialWidth
          const maxML = Math.max(0, Math.floor(bounds.right - naturalLeft - newWidth))
          const newML = Math.max(0, Math.min(maxML, Math.round(origMarginLeft - actualDeltaW / 2)))

          wrapper.style.marginLeft = `${newML}px`
          selectedImg.style.width = `${newWidth}px`
          selectedImg.style.maxWidth = '100%'
          selectedImg.setAttribute('width', String(newWidth))
        } else if (isRightSide) {
          const maxRightWidth = Math.max(50, Math.floor(initialWidth + availRight))
          const newWidth = Math.max(50, Math.min(maxRightWidth, Math.round(initialWidth + rawDeltaX)))

          wrapper.style.marginLeft = `${origMarginLeft}px`
          selectedImg.style.width = `${newWidth}px`
          selectedImg.style.maxWidth = '100%'
          selectedImg.setAttribute('width', String(newWidth))
        } else {
          const maxLeftWidth = Math.max(50, Math.floor(initialWidth + availLeft))
          const newWidth = Math.max(50, Math.min(maxLeftWidth, Math.round(initialWidth + rawDeltaX)))
          const actualDeltaW = newWidth - initialWidth
          const newML = Math.max(0, Math.round(origMarginLeft - actualDeltaW))

          wrapper.style.marginLeft = `${newML}px`
          selectedImg.style.width = `${newWidth}px`
          selectedImg.style.maxWidth = '100%'
          selectedImg.setAttribute('width', String(newWidth))
        }

        // If pure horizontal handle (e or w) and no explicit height was set, keep height auto
        if (!affectsY && !selectedImg.getAttribute('height')) {
          selectedImg.style.height = 'auto'
        }
      }

      if (affectsY) {
        const isBottomSide = handle === 's' || handle === 'se' || handle === 'sw'
        const rawDeltaY = isBottomSide ? moveEv.clientY - startY : startY - moveEv.clientY

        if (isBoth) {
          const deltaH = rawDeltaY * 2
          const newHeight = Math.max(24, Math.min(maxTotalHeight, Math.round(initialHeight + deltaH)))
          const actualDeltaH = newHeight - initialHeight
          const newMT = Math.max(0, Math.round(origMarginTop - actualDeltaH / 2))

          wrapper.style.marginTop = `${newMT}px`
          selectedImg.style.height = `${newHeight}px`
          selectedImg.setAttribute('height', String(newHeight))
        } else if (isBottomSide) {
          // Downward resize: top stays fixed, bottom edge moves down/up
          const newHeight = Math.max(24, Math.min(maxTotalHeight, Math.round(initialHeight + rawDeltaY)))
          wrapper.style.marginTop = `${origMarginTop}px`
          selectedImg.style.height = `${newHeight}px`
          selectedImg.setAttribute('height', String(newHeight))
        } else {
          // Upward resize: enlarge/shrink from top edge
          const newHeight = Math.max(24, Math.min(maxTotalHeight, Math.round(initialHeight + rawDeltaY)))
          const actualDeltaH = newHeight - initialHeight
          const newMT = Math.max(0, Math.round(origMarginTop - actualDeltaH))
          wrapper.style.marginTop = `${newMT}px`
          selectedImg.style.height = `${newHeight}px`
          selectedImg.setAttribute('height', String(newHeight))
        }
      }

      syncImgBox(selectedImg)
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      syncImgBox(selectedImg)
      updateCounts()
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  const deleteSelectedImage = () => {
    if (!selectedImg) return
    const parent = selectedImg.parentElement
    if (parent && parent.tagName === 'SPAN' && parent.childElementCount === 1) {
      parent.remove()
    } else {
      selectedImg.remove()
    }
    setSelectedImg(null)
    setImgBox(null)
    updateCounts()
    toast({ title: 'Removed', description: 'Item was deleted from document.' })
  }

  // ------------------------------------------------------------------ exec
  const exec = (command: string, value?: string) => {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    syncActiveStates()
    updateCounts()
  }

  // -------------------------------------------------------- insert signature
  const openSignatureModal = () => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange()
    } else {
      savedRangeRef.current = null
    }
    setSigModalOpen(true)
  }

  const insertSignature = (sig: PlacedSignature) => {
    editorRef.current?.focus()
    const sel = window.getSelection()
    let range: Range | null = null

    if (savedRangeRef.current && editorRef.current?.contains(savedRangeRef.current.commonAncestorContainer)) {
      range = savedRangeRef.current
      if (sel) {
        sel.removeAllRanges()
        sel.addRange(range)
      }
    } else if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0)
    }

    const wrapper = document.createElement('span')
    wrapper.className = 'inline-block my-1 align-middle'
    wrapper.style.display = 'inline-block'

    const img = document.createElement('img')
    img.src = sig.dataUrl
    img.alt = 'Signature'
    img.dataset.signature = '1'
    img.style.width = '200px'
    img.style.maxWidth = '100%'
    img.style.height = 'auto'
    img.style.display = 'inline-block'
    img.style.verticalAlign = 'middle'
    img.setAttribute('width', '200')
    img.className = 'select-none rounded border border-emerald-500/50 bg-white/70 p-1 cursor-pointer transition-shadow hover:ring-2 hover:ring-emerald-400'

    wrapper.appendChild(img)

    if (range) {
      range.deleteContents()
      range.insertNode(wrapper)
      const after = document.createRange()
      after.setStartAfter(wrapper)
      after.collapse(true)
      sel?.removeAllRanges()
      sel?.addRange(after)
    } else if (editorRef.current) {
      editorRef.current.appendChild(wrapper)
    }

    setSelectedImg(img)
    setTimeout(() => {
      syncImgBox()
    }, 0)

    setSigModalOpen(false)
    savedRangeRef.current = null
    updateCounts()
    toast({
      title: 'Signature placed',
      description: 'Your signature was inserted into the document. Drag the side or corner handles to resize width.',
    })
  }

  // ------------------------------------------------------------ insert image
  const insertImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Please select an image file', variant: 'destructive' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      editorRef.current?.focus()
      const sel = window.getSelection()
      let range: Range | null = null

      if (savedRangeRef.current && editorRef.current?.contains(savedRangeRef.current.commonAncestorContainer)) {
        range = savedRangeRef.current
        if (sel) {
          sel.removeAllRanges()
          sel.addRange(range)
        }
      } else if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
        range = sel.getRangeAt(0)
      }

      const img = document.createElement('img')
      img.src = dataUrl
      img.alt = file.name
      img.style.width = '300px'
      img.style.maxWidth = '100%'
      img.style.height = 'auto'
      img.setAttribute('width', '300')
      img.className = 'my-2 rounded border cursor-pointer transition-shadow hover:ring-2 hover:ring-emerald-400'

      if (range) {
        range.deleteContents()
        range.insertNode(img)
      } else if (editorRef.current) {
        editorRef.current.appendChild(img)
      }
      setSelectedImg(img)
      setTimeout(() => {
        syncImgBox()
      }, 0)
      updateCounts()
    }
    reader.readAsDataURL(file)
  }

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
    if (!editorRef.current) return
    setSaving(true)
    try {
      const html = editorRef.current.innerHTML
      const res = await fetch(`/api/documents/${docId}/docx-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save the document.')
      toast({
        title: 'Saved successfully',
        description: 'Document updated and recompiled to DOCX.',
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

  // ----------------------------------------------------------------- toolbar
  const toolBtn = (
    isActive: boolean,
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
  ) => (
    <Button
      type="button"
      variant={isActive ? 'default' : 'ghost'}
      size="icon"
      className="size-9"
      title={label}
      aria-label={label}
      onMouseDown={(e) => {
        // Prevent button click from stealing focus & selection from the editor
        e.preventDefault()
      }}
      onClick={onClick}
    >
      {icon}
    </Button>
  )

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
            DOCX
          </Badge>

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
        {/* rich text toolbar */}
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-1 px-4 py-2">
          {/* Block type */}
          <Select
            value={blockTag}
            onValueChange={(val) => {
              exec('formatBlock', val === 'p' ? '<p>' : `<${val}>`)
            }}
          >
            <SelectTrigger className="h-9 w-32 text-xs" aria-label="Paragraph style">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="p">Paragraph</SelectItem>
              <SelectItem value="h1">Heading 1</SelectItem>
              <SelectItem value="h2">Heading 2</SelectItem>
              <SelectItem value="h3">Heading 3</SelectItem>
              <SelectItem value="h4">Heading 4</SelectItem>
              <SelectItem value="blockquote">Quote</SelectItem>
            </SelectContent>
          </Select>

          {/* Font size */}
          <Select
            value={fontSize}
            onValueChange={(val) => {
              setFontSize(val)
              exec('fontSize', val)
            }}
          >
            <SelectTrigger className="h-9 w-20 text-xs" aria-label="Font size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Small</SelectItem>
              <SelectItem value="3">Normal</SelectItem>
              <SelectItem value="5">Large</SelectItem>
              <SelectItem value="7">Huge</SelectItem>
            </SelectContent>
          </Select>

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
            const url = window.prompt('Link URL (https://…)')?.trim()
            if (!url) return
            if (!isSafeLinkUrl(url)) {
              toast({
                title: 'Unsupported link',
                description: 'Links must start with https://, http://, mailto: or tel:',
                variant: 'destructive',
              })
              return
            }
            exec('createLink', url)
          })}
          {toolBtn(false, 'Clear formatting', <RemoveFormatting className="size-4" />, () => exec('removeFormat'))}
          {toolBtn(false, 'Insert image', <ImageIcon className="size-4" />, () => imageInputRef.current?.click())}
          <Button
            size="sm"
            variant="outline"
            className="ml-1 h-9 border-emerald-600 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-950"
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

          {/* Word and character counters */}
          <div className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
            <span className="font-medium text-foreground">{wordCount}</span>
            <span>words</span>
            <span className="text-zinc-400">·</span>
            <span className="font-medium text-foreground">{charCount}</span>
            <span>chars</span>
          </div>
        </div>
      </header>

      {/* paper */}
      <main ref={mainRef} className="relative slim-scroll flex-1 min-h-0 overflow-y-auto bg-zinc-200/60 py-6 pb-20 dark:bg-zinc-900">
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
            onInput={updateCounts}
            onBlur={() => {
              const sel = window.getSelection()
              if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
                savedRangeRef.current = sel.getRangeAt(0).cloneRange()
              }
            }}
          />
        )}

        {/* Floating resize controls & bounding box for selected signature / image */}
        {selectedImg && imgBox && (
          <div
            id="docx-image-resize-overlay"
            className="pointer-events-none absolute z-20"
            style={{
              top: imgBox.top,
              left: imgBox.left,
              width: imgBox.width,
              height: imgBox.height,
            }}
          >
            {/* Outline highlight */}
            <div className="absolute inset-0 rounded border-2 border-emerald-500 ring-1 ring-emerald-500/40 pointer-events-none" />

            {/* Draggable move body - allows clicking and dragging anywhere inside to move around */}
            <div
              className="pointer-events-auto absolute inset-1 cursor-grab active:cursor-grabbing rounded flex items-center justify-center bg-emerald-500/5 transition-colors hover:bg-emerald-500/10"
              title="Click and drag to move signature"
              onPointerDown={(e) => startDocxImageDrag(e, selectedImg)}
            >
              <div className="opacity-0 hover:opacity-100 transition-opacity flex items-center gap-1 rounded bg-black/70 px-2 py-0.5 text-[10px] text-white shadow pointer-events-none">
                <Move className="size-3" />
                <span>Drag to move</span>
              </div>
            </div>

            {/* Floating quick control bar */}
            <div
              className="pointer-events-auto absolute -top-10 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-md border bg-background/95 px-1.5 py-0.5 text-xs shadow-lg backdrop-blur select-none"
              onMouseDown={(e) => e.stopPropagation()}
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
              <Separator orientation="vertical" className="h-3.5 mx-0.5" />
              <div className="flex items-center gap-0.5 border-r pr-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px] font-semibold"
                  title="Small (120px)"
                  onClick={() => setExactImageWidth(120)}
                >
                  S
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px] font-semibold"
                  title="Medium (200px)"
                  onClick={() => setExactImageWidth(200)}
                >
                  M
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px] font-semibold"
                  title="Large (300px)"
                  onClick={() => setExactImageWidth(300)}
                >
                  L
                </Button>
              </div>
              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 text-xs"
                  title="Decrease width"
                  onClick={() => setExactImageWidth(imgBox.width - 25)}
                >
                  <Minus className="size-3" />
                </Button>
                <span className="min-w-[40px] text-center font-mono text-[11px] font-medium text-foreground">
                  {Math.round(imgBox.width)}px
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 text-xs"
                  title="Increase width"
                  onClick={() => setExactImageWidth(imgBox.width + 25)}
                >
                  <Plus className="size-3" />
                </Button>
              </div>
              <Separator orientation="vertical" className="h-3.5 mx-0.5" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
                title="Delete"
                onClick={deleteSelectedImage}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>

            {/* Top height handle (top pill/bar) */}
            <div
              className="pointer-events-auto absolute -top-2.5 left-1/2 -translate-x-1/2 h-3 w-8 cursor-ns-resize rounded-full border-2 border-white bg-emerald-600 shadow-md transition-transform hover:scale-125 flex items-center justify-center z-30"
              title="Drag upward or downward to resize height"
              aria-label="Resize height top"
              onPointerDown={(e) => handleResize(e, 'n')}
            >
              <div className="h-0.5 w-3 bg-white/90 rounded-full pointer-events-none" />
            </div>

            {/* Bottom height handle (bottom pill/bar) */}
            <div
              className="pointer-events-auto absolute -bottom-2.5 left-1/2 -translate-x-1/2 h-3 w-8 cursor-ns-resize rounded-full border-2 border-white bg-emerald-600 shadow-md transition-transform hover:scale-125 flex items-center justify-center z-30"
              title="Drag downward or upward to resize height"
              aria-label="Resize height bottom"
              onPointerDown={(e) => handleResize(e, 's')}
            >
              <div className="h-0.5 w-3 bg-white/90 rounded-full pointer-events-none" />
            </div>

            {/* Left width handle (side pill/bar) */}
            <div
              className="pointer-events-auto absolute top-1/2 -left-2.5 -translate-y-1/2 h-8 w-3 cursor-ew-resize rounded-full border-2 border-white bg-emerald-600 shadow-md transition-transform hover:scale-125 flex items-center justify-center z-30"
              title="Drag to resize width"
              aria-label="Resize width left"
              onPointerDown={(e) => handleResize(e, 'w')}
            >
              <div className="w-0.5 h-3 bg-white/90 rounded-full pointer-events-none" />
            </div>

            {/* Right width handle (side pill/bar) */}
            <div
              className="pointer-events-auto absolute top-1/2 -right-2.5 -translate-y-1/2 h-8 w-3 cursor-ew-resize rounded-full border-2 border-white bg-emerald-600 shadow-md transition-transform hover:scale-125 flex items-center justify-center z-30"
              title="Drag to resize width"
              aria-label="Resize width right"
              onPointerDown={(e) => handleResize(e, 'e')}
            >
              <div className="w-0.5 h-3 bg-white/90 rounded-full pointer-events-none" />
            </div>

            {/* Resize corner handles */}
            <div
              className="pointer-events-auto absolute -top-1.5 -left-1.5 size-3.5 cursor-nw-resize rounded-full border-2 border-white bg-emerald-600 shadow transition-transform hover:scale-125 z-30"
              title="Drag to resize"
              onPointerDown={(e) => handleResize(e, 'nw')}
            />
            <div
              className="pointer-events-auto absolute -top-1.5 -right-1.5 size-3.5 cursor-ne-resize rounded-full border-2 border-white bg-emerald-600 shadow transition-transform hover:scale-125 z-30"
              title="Drag to resize"
              onPointerDown={(e) => handleResize(e, 'ne')}
            />
            <div
              className="pointer-events-auto absolute -bottom-1.5 -right-1.5 size-3.5 cursor-se-resize rounded-full border-2 border-white bg-emerald-600 shadow transition-transform hover:scale-125 z-30"
              title="Drag to resize"
              onPointerDown={(e) => handleResize(e, 'se')}
            />
            <div
              className="pointer-events-auto absolute -bottom-1.5 -left-1.5 size-3.5 cursor-sw-resize rounded-full border-2 border-white bg-emerald-600 shadow transition-transform hover:scale-125 z-30"
              title="Drag to resize"
              onPointerDown={(e) => handleResize(e, 'sw')}
            />
          </div>
        )}
      </main>

      <SignatureModal open={sigModalOpen} onOpenChange={setSigModalOpen} onSelect={insertSignature} />
    </div>
  )
}
