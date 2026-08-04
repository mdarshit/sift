import { useEffect, useMemo, useRef, useState } from 'react'
import { parseJsonTree, type JsonTreeNode } from '../lib/jsonTools'
import { Icon } from './ui'

function TreeNode({ node, depth }: { node: JsonTreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = (node.children?.length ?? 0) > 0
  return (
    <>
      <div className="json-row" style={{ paddingLeft: 10 + depth * 16 }}>
        {hasChildren ? (
          <button className="tree-chevron" onClick={() => setOpen((v) => !v)} aria-label={open ? 'Collapse' : 'Expand'}>
            <Icon name="chevronRight" size={10} className={open ? 'rotate-90' : ''} />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <span className="json-key">{node.key}</span>
        <span className="json-kind">{node.kind}</span>
        <span className="json-preview">{node.preview}</span>
        <span className="json-path">{node.path}</span>
      </div>
      {hasChildren && open && node.children!.map((child) => <TreeNode key={child.path} node={child} depth={depth + 1} />)}
    </>
  )
}

export function JsonTreeDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const restore = useRef<HTMLElement | null>(null)
  const parsed = useMemo(() => parseJsonTree(text), [text])

  useEffect(() => {
    restore.current = document.activeElement as HTMLElement
    return () => restore.current?.focus()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="JSON tree"
        className="dialog flex h-[min(720px,88vh)] w-[min(920px,94vw)] flex-col rounded-xl border border-border bg-panel shadow-[var(--shadow)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="font-mono text-[13px] font-semibold">JSON tree</h2>
          <button className="icon-btn h-7 w-7" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="close" size={13} />
          </button>
        </div>
        {!parsed.ok ? (
          <div className="p-4 text-[12px] text-danger">{parsed.message}</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto py-2">
            <TreeNode node={parsed.tree} depth={0} />
          </div>
        )}
      </div>
    </div>
  )
}
