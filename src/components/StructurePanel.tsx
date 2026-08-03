/**
 * Query structure views: an outline side panel (statements/CTEs/subqueries,
 * clickable to jump) and a dependency-graph dialog opened from the header.
 * Rendering is plain DOM + SVG — the graph is a simple layered DAG (longest
 * path from sources), matching the project's zero-dependency approach.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnalyzeResult, GraphData, OutlineNode } from '../types'
import { Icon, Spinner } from './ui'

// ---------------------------------------------------------------------------
// Outline tree
// ---------------------------------------------------------------------------

function OutlineRow({
  node,
  depth,
  path,
  collapsed,
  onToggle,
  onJump,
}: {
  node: OutlineNode
  depth: number
  path: string
  collapsed: Set<string>
  onToggle: (path: string) => void
  onJump: (offset: number, line: number) => void
}) {
  const hasChildren = (node.children?.length ?? 0) > 0
  const isCollapsed = collapsed.has(path)
  return (
    <>
      <div className="flex items-center" style={{ paddingLeft: depth * 14 }}>
        {hasChildren ? (
          <button
            className="tree-chevron"
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            aria-expanded={!isCollapsed}
            onClick={() => onToggle(path)}
          >
            <Icon name="chevronRight" size={10} className={isCollapsed ? '' : 'rotate-90'} />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <button
          className="tree-row"
          title={`${node.label} — Ln ${node.line}`}
          onClick={() => onJump(node.offset, node.line)}
        >
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{node.label}</span>
          {node.kind === 'group' && node.count != null && (
            <span className="tree-badge">{node.count.toLocaleString()}</span>
          )}
        </button>
      </div>
      {hasChildren &&
        !isCollapsed &&
        node.children!.map((c, i) => (
          <OutlineRow
            key={i}
            node={c}
            depth={depth + 1}
            path={`${path}.${i}`}
            collapsed={collapsed}
            onToggle={onToggle}
            onJump={onJump}
          />
        ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Graph: layered layout (longest path from sources), cubic edges.
// ---------------------------------------------------------------------------

const NODE_W = 132
const NODE_H = 28
const GAP_X = 64
const GAP_Y = 12
const PAD = 20

interface Placed {
  id: string
  kind: 'table' | 'cte' | 'select'
  label: string
  line: number
  offset: number
  x: number
  y: number
}

function layout(graph: GraphData): {
  placed: Placed[]
  edges: { x1: number; y1: number; x2: number; y2: number }[]
  w: number
  h: number
} {
  const layer = new Map<string, number>()
  const incoming = new Map<string, string[]>()
  for (const n of graph.nodes) incoming.set(n.id, [])
  for (const e of graph.edges) incoming.get(e.to)?.push(e.from)

  // Longest path from sources; the visiting set breaks recursive-CTE cycles.
  const visiting = new Set<string>()
  const layerOf = (id: string): number => {
    const known = layer.get(id)
    if (known != null) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    const parents = incoming.get(id) ?? []
    const l = parents.length === 0 ? 0 : Math.max(...parents.map(layerOf)) + 1
    visiting.delete(id)
    layer.set(id, l)
    return l
  }
  for (const n of graph.nodes) layerOf(n.id)

  const byLayer = new Map<number, string[]>()
  for (const n of graph.nodes) {
    const l = layer.get(n.id) ?? 0
    if (!byLayer.has(l)) byLayer.set(l, [])
    byLayer.get(l)!.push(n.id)
  }

  const maxRows = Math.max(...[...byLayer.values()].map((ids) => ids.length), 1)
  const maxH = maxRows * NODE_H + (maxRows - 1) * GAP_Y
  const pos = new Map<string, { x: number; y: number }>()
  for (const [l, ids] of byLayer) {
    // Center each layer vertically against the tallest one.
    const layerH = ids.length * NODE_H + (ids.length - 1) * GAP_Y
    const yOff = (maxH - layerH) / 2
    ids.forEach((id, row) => {
      pos.set(id, { x: PAD + l * (NODE_W + GAP_X), y: PAD + yOff + row * (NODE_H + GAP_Y) })
    })
  }
  const placed = graph.nodes.map<Placed>((n) => ({ ...n, ...pos.get(n.id)! }))
  const edges = graph.edges.flatMap((e) => {
    const a = pos.get(e.from)
    const b = pos.get(e.to)
    if (!a || !b) return []
    return [{ x1: a.x + NODE_W, y1: a.y + NODE_H / 2, x2: b.x, y2: b.y + NODE_H / 2 }]
  })
  const layers = byLayer.size
  return {
    placed,
    edges,
    w: PAD * 2 + layers * NODE_W + (layers - 1) * GAP_X,
    h: PAD * 2 + maxH,
  }
}

function Graph({ graph, onJump }: { graph: GraphData; onJump: (offset: number, line: number) => void }) {
  const { placed, edges, w, h } = useMemo(() => layout(graph), [graph])
  if (placed.length === 0) {
    return <div className="p-4 text-[12px] text-dim">No tables or CTEs found.</div>
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <svg width={w} height={h} className="block">
        {edges.map((e, i) => {
          const mx = (e.x1 + e.x2) / 2
          return (
            <path
              key={i}
              d={`M ${e.x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${e.x2} ${e.y2}`}
              fill="none"
              stroke="var(--faint)"
              strokeWidth="1.2"
            />
          )
        })}
        {placed.map((n) => (
          <g
            key={n.id}
            className="cursor-pointer"
            onClick={() => onJump(n.offset, n.line)}
            role="button"
            tabIndex={0}
            aria-label={`${n.kind === 'cte' ? 'CTE' : n.kind === 'select' ? 'Result set' : 'Table'} ${n.label}, line ${n.line}`}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onJump(n.offset, n.line)
              }
            }}
          >
            <title>{`${n.label} — Ln ${n.line}`}</title>
            <rect
              x={n.x}
              y={n.y}
              width={NODE_W}
              height={NODE_H}
              rx="6"
              fill="var(--panel2)"
              stroke={n.kind === 'cte' ? 'var(--accent)' : 'var(--border)'}
              strokeWidth={n.kind === 'cte' ? 1.5 : 1}
              strokeDasharray={n.kind === 'select' ? '3 3' : undefined}
            />
            <text
              x={n.x + NODE_W / 2}
              y={n.y + NODE_H / 2 + 4}
              textAnchor="middle"
              fontSize="11"
              fontFamily="var(--font-mono)"
              fill="var(--ink)"
            >
              {n.label.length > 18 ? n.label.slice(0, 17) + '…' : n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Graph dialog (opened from the header, next to Obfuscate)
// ---------------------------------------------------------------------------

export function GraphDialog({
  result,
  loading,
  error,
  sqlActive,
  onJump,
  onClose,
}: {
  result: AnalyzeResult | null
  loading: boolean
  error: string | null
  sqlActive: boolean
  onJump: (offset: number, line: number) => void
  onClose: () => void
}) {
  const restore = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    restore.current = document.activeElement as HTMLElement
    window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('button')?.focus())
    return () => restore.current?.focus()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Tab') {
        const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button,[href],[tabindex]:not([tabindex="-1"])') ?? [])]
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Query graph"
        className="dialog flex h-[min(640px,85vh)] w-[min(960px,92vw)] flex-col rounded-xl border border-border bg-panel shadow-[var(--shadow)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="font-mono text-[13px] font-semibold">Query graph</h2>
          <div className="flex items-center gap-2">
            {loading && <Spinner size={12} />}
            <button className="icon-btn h-7 w-7" onClick={onClose} aria-label="Close" title="Close (Esc)">
              <Icon name="close" size={13} />
            </button>
          </div>
        </div>
        {!sqlActive ? (
          <div className="p-4 text-[12px] text-dim">The graph is for SQL buffers.</div>
        ) : error ? (
          <div className="p-4 text-[12px] text-danger">Analysis unavailable: {error}</div>
        ) : !result ? (
          <div className="p-4 text-[12px] text-dim">{loading ? 'Analyzing…' : 'Nothing to analyze.'}</div>
        ) : (
          <Graph graph={result.graph} onJump={(offset, line) => { onJump(offset, line); onClose() }} />
        )}
        {result && sqlActive && (
          <div className="flex shrink-0 items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-faint">
            <span>{result.graph.nodes.length} nodes</span>
            <span>{result.graph.edges.length} edges</span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-[3px] border border-[var(--accent)]" /> CTE
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-[3px] border border-dashed border-[var(--faint)]" /> result set
            </span>
            {result.truncated && <span>view truncated</span>}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Outline side panel
// ---------------------------------------------------------------------------

export function StructurePanel({
  result,
  loading,
  error,
  sqlActive,
  onJump,
  onClose,
}: {
  result: AnalyzeResult | null
  loading: boolean
  error: string | null
  sqlActive: boolean
  onJump: (offset: number, line: number) => void
  onClose: () => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  return (
    <aside
      className="panel-slide flex w-[min(320px,100%)] shrink-0 flex-col border-l border-border bg-panel max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-10 max-md:shadow-[var(--shadow)]"
      aria-label="Query structure"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-3">
        <span className="font-mono text-[11px] font-semibold text-dim select-none">Outline</span>
        <div className="flex-1" />
        {loading && <Spinner size={12} />}
        <button className="icon-btn h-7 w-7" onClick={onClose} title="Close outline" aria-label="Close outline">
          <Icon name="close" size={12} />
        </button>
      </div>

      {!sqlActive ? (
        <div className="p-4 text-[12px] text-dim">Structure view is for SQL buffers.</div>
      ) : error ? (
        <div className="p-4 text-[12px] text-danger">Analysis unavailable: {error}</div>
      ) : !result ? (
        <div className="p-4 text-[12px] text-dim">{loading ? 'Analyzing…' : 'Nothing to analyze.'}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto py-1.5 pr-1.5">
          {result.outline.length === 0 ? (
            <div className="p-4 text-[12px] text-dim">No statements found.</div>
          ) : (
            result.outline.map((n, i) => (
              <OutlineRow
                key={i}
                node={n}
                depth={0}
                path={String(i)}
                collapsed={collapsed}
                onToggle={toggle}
                onJump={onJump}
              />
            ))
          )}
        </div>
      )}

      {result?.truncated && sqlActive && (
        <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-faint">
          Large buffer — view truncated.
        </div>
      )}
    </aside>
  )
}
