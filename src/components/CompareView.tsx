import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detect } from '../lib/detect'
import { tools } from '../lib/toolsClient'
import { Editor, type EditorHandle, type EditorLineDecoration } from './Editor'
import { Icon, Spinner } from './ui'

type DiffResult = Awaited<ReturnType<typeof tools.diffLines>>
type DiffRow = DiffResult['rows'][number]
type Side = 'left' | 'right'

function offsetForLine(text: string, line: number) {
  let current = 1
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 13 || code === 10) {
      if (code === 13 && text.charCodeAt(i + 1) === 10) i++
      if (++current === line) return i + 1
    }
  }
  return 0
}

function decorations(rows: DiffRow[], side: Side): EditorLineDecoration[] {
  const seen = new Set<number>()
  const result: EditorLineDecoration[] = []
  for (const row of rows) {
    if (row.kind === 'same') continue
    const line = side === 'left' ? row.leftLine : row.rightLine
    if (line == null || seen.has(line)) continue
    seen.add(line)
    result.push({ line, kind: row.kind === 'changed' ? 'changed' : row.kind === 'added' ? 'added' : 'removed' })
  }
  return result
}

export function CompareView({ seedText, onUse, onExit }: { seedText: string; onUse: (text: string) => void; onExit: () => void }) {
  const [left, setLeft] = useState(seedText)
  const [right, setRight] = useState('')
  const [result, setResult] = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const request = useRef(0)
  const leftRef = useRef<EditorHandle>(null)
  const rightRef = useRef<EditorHandle>(null)
  const leftLanguage = useMemo(() => detect(left).lang, [left])
  const rightLanguage = useMemo(() => detect(right).lang, [right])

  useEffect(() => {
    const id = ++request.current
    setLoading(true)
    setError(null)
    setResult(null)
    const timer = window.setTimeout(async () => {
      try {
        const next = await tools.diffLines(left, right)
        if (request.current === id) setResult(next)
      } catch (err) {
        if (request.current === id) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (request.current === id) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [left, right])

  const differences = useMemo(() => result?.rows.filter((row) => row.kind !== 'same') ?? [], [result])
  const leftDecorations = useMemo(() => decorations(result?.rows ?? [], 'left'), [result])
  const rightDecorations = useMemo(() => decorations(result?.rows ?? [], 'right'), [result])

  const jump = useCallback((index: number) => {
    if (!differences.length) return
    const next = (index + differences.length) % differences.length
    setActive(next)
    const row = differences[next]
    const side: Side = row.rightLine != null ? 'right' : 'left'
    const line = side === 'right' ? row.rightLine : row.leftLine
    const value = side === 'right' ? right : left
    if (line != null) (side === 'right' ? rightRef : leftRef).current?.jumpTo(offsetForLine(value, line), line)
  }, [differences, left, right])

  useEffect(() => {
    if (active >= differences.length) setActive(Math.max(0, differences.length - 1))
  }, [active, differences.length])

  return (
    <div className="compare-workspace">
      <header className="compare-toolbar">
        <button className="btn" onClick={onExit}><Icon name="chevronRight" size={12} className="rotate-180" /> Exit compare</button>
        <div className="compare-summary" role="status">
          {loading && <><Spinner size={12} /> Comparing</>}
          {!loading && error && <span className="text-danger">Diff unavailable: {error}</span>}
          {!loading && !error && result && <>{result.counts.changed} changed, {result.counts.added} added, {result.counts.removed} removed{result.truncated ? ' in shown rows' : ''} {(result.approximate || result.truncated) && <span className="text-warn">({result.approximate ? 'approximated' : 'truncated'}{result.omittedRows ? `, ${result.omittedRows} rows omitted` : ''})</span>}</>}
        </div>
        <div className="compare-nav">
          <button className="btn" onClick={() => jump(active - 1)} disabled={!differences.length}>Previous</button>
          <button className="btn" onClick={() => jump(active + 1)} disabled={!differences.length}>Next</button>
          <button className="icon-btn" onClick={() => { setLeft(right); setRight(left) }} title="Swap sides" aria-label="Swap sides"><Icon name="swap" /></button>
        </div>
      </header>
      <div className="compare-editors">
        <section>
          <div className="compare-side-head"><span>Left · {leftLanguage.toUpperCase()}</span><button className="btn" onClick={() => onUse(left)}>Use left as document</button></div>
          <div className="min-h-0 flex-1"><Editor ref={leftRef} value={left} onChange={setLeft} onAction={() => {}} language={leftLanguage} lineDecorations={leftDecorations} /></div>
        </section>
        <section>
          <div className="compare-side-head"><span>Right · {rightLanguage.toUpperCase()}</span><button className="btn" onClick={() => onUse(right)}>Use right as document</button></div>
          <div className="min-h-0 flex-1"><Editor ref={rightRef} value={right} onChange={setRight} onAction={() => {}} language={rightLanguage} lineDecorations={rightDecorations} /></div>
        </section>
      </div>
      <div className="compare-diff">
        {!loading && !error && differences.length === 0 && <div className="dialog-state">No differences found.</div>}
        {!loading && !error && differences.map((row, index) => (
          <button key={index} className={`diff-row diff-${row.kind} ${differences[active] === row ? 'diff-active' : ''}`} onClick={() => { const i = differences.indexOf(row); if (i >= 0) jump(i) }}>
            <span className="diff-ln">{row.leftLine ?? ''}</span><code>{row.left}</code><span className="diff-ln">{row.rightLine ?? ''}</span><code>{row.right}</code>
          </button>
        ))}
      </div>
    </div>
  )
}
