import { useEffect, useRef, useState } from 'react'
import { tools } from '../lib/toolsClient'
import { Icon, Spinner } from './ui'

type ParseResult = Awaited<ReturnType<typeof tools.parseJsonTree>>
type TreeNodeData = Extract<ParseResult, { ok: true }>['tree']

function TreeNode({ node, depth }: { node: TreeNodeData; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  const children = node.children ?? []
  return <>
    <div
      className="json-row"
      style={{ paddingLeft: 10 + depth * 16 }}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={children.length ? open : undefined}
      tabIndex={depth === 0 ? 0 : -1}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' && children.length && !open) { event.preventDefault(); setOpen(true) }
        else if (event.key === 'ArrowLeft' && children.length && open) { event.preventDefault(); setOpen(false) }
      }}
    >
      {children.length ? <button className="tree-chevron" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${node.key}`}><Icon name="chevronRight" size={10} className={open ? 'rotate-90' : ''} /></button> : <span className="w-5 shrink-0" />}
      <span className="json-key" title={node.key}>{node.key}</span><span className="json-kind">{node.kind}</span><span className="json-preview">{node.preview}</span><span className="json-path" title={node.path}>{node.path}</span>
      {(node.omittedChildren || node.depthTruncated) && <span className="json-omitted">{node.depthTruncated ? 'depth limit reached' : `${node.omittedChildren} entries omitted`}</span>}
    </div>
    {open && children.map((child) => <TreeNode key={child.path} node={child} depth={depth + 1} />)}
  </>
}

export function JsonTreeDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)
  const [result, setResult] = useState<ParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void tools.parseJsonTree(text).then((value) => { if (current) setResult(value) }, (err) => { if (current) setError(err instanceof Error ? err.message : String(err)) })
    return () => { current = false }
  }, [text])
  useEffect(() => {
    restore.current = document.activeElement as HTMLElement
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => restore.current?.focus()
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? [])
      if (!controls.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return <div className="overlay fixed inset-0 z-50 flex items-center justify-center p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="json-tree-title" className="json-tree-dialog dialog">
      <header><h2 id="json-tree-title">JSON tree</h2><button className="icon-btn" onClick={onClose} aria-label="Close JSON tree"><Icon name="close" /></button></header>
      <div className="json-tree-body">
        {!result && !error && <div className="dialog-state"><Spinner /> Building tree</div>}
        {error && <div className="dialog-state text-danger">Tree unavailable: {error}</div>}
        {result && !result.ok && <div className="dialog-state text-danger">{result.message}</div>}
        {result?.ok && <div role="tree" aria-label="JSON structure" onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')].filter((item) => item.offsetParent !== null)
          const index = items.indexOf(document.activeElement as HTMLElement)
          const next = event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1) : Math.max(0, index - 1)
          if (items[next]) { event.preventDefault(); items.forEach((item) => { item.tabIndex = -1 }); items[next].tabIndex = 0; items[next].focus() }
        }}><TreeNode node={result.tree} depth={0} />{result.truncated && <div className="json-truncated" role="status">Tree truncated for responsiveness. Limits reached: {[result.limits.depth && 'depth', result.limits.children && 'children per branch', result.limits.nodes && 'total entries'].filter(Boolean).join(', ')}.{result.omittedNodes ? ` ${result.omittedNodes.toLocaleString()} direct entries were omitted; omitted branches can contain more descendants.` : ''}</div>}</div>}
      </div>
    </div>
  </div>
}
