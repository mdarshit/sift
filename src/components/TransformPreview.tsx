import { useEffect, useRef } from 'react'
import type { ObfuscationMapping } from '../types'
import { Icon } from './ui'

export interface ObfuscationPreview {
  source: string
  result: string
  identifiers: number
  strings: number
  mapping: ObfuscationMapping
}

export function ObfuscationConfirm({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restore.current = document.activeElement as HTMLElement
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-primary]')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'Tab') {
        const controls = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        if (controls.length === 0) return
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      restore.current?.focus()
    }
  }, [onClose])

  return (
    <div className="overlay fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} className="confirm-dialog dialog" role="alertdialog" aria-modal="true" aria-labelledby="obfuscate-title" aria-describedby="obfuscate-description">
        <span className="eyebrow">Before you continue</span>
        <h2 id="obfuscate-title">Obfuscate this SQL document?</h2>
        <p id="obfuscate-description">Sift will replace identifiers and quoted strings with aliases. Comments, numbers, parameters, and SQL structure remain visible. You will review a preview before applying anything.</p>
        <div className="confirm-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" data-primary onClick={onConfirm}>Continue to preview</button>
        </div>
      </div>
    </div>
  )
}

export function TransformPreview({
  preview,
  onApply,
  onCopy,
  onDownloadMap,
  onClose,
}: {
  preview: ObfuscationPreview
  onApply: () => void
  onCopy: () => void
  onDownloadMap: () => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restore.current = document.activeElement as HTMLElement
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-primary]')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'Tab') {
        const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button,[tabindex]:not([tabindex="-1"])') ?? [])]
        if (controls.length === 0) return
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      restore.current?.focus()
    }
  }, [onClose])

  return (
    <div className="overlay fixed inset-0 z-50 flex items-center justify-center p-3" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} className="preview-dialog dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title">
        <header>
          <div>
            <span className="eyebrow">Review before applying</span>
            <h2 id="preview-title">Obfuscation preview</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close preview"><Icon name="close" size={14} /></button>
        </header>
        <div className="preview-warning">
          Identifiers and quoted strings are replaced. Comments, numbers, parameters, and SQL structure remain visible, so review the result before sharing it.
        </div>
        <div className="preview-grid">
          <section><h3>Source</h3><pre>{preview.source}</pre></section>
          <section><h3>Obfuscated result</h3><pre>{preview.result}</pre></section>
        </div>
        <footer>
          <span>{preview.identifiers} identifiers · {preview.strings} strings</span>
          <div>
            <button className="btn" onClick={onDownloadMap}>Download private map</button>
            <button className="btn" onClick={onCopy}>Copy result</button>
            <button className="btn" onClick={onClose}>Discard</button>
            <button className="btn btn-primary" data-primary onClick={onApply}>Apply</button>
          </div>
        </footer>
      </div>
    </div>
  )
}
