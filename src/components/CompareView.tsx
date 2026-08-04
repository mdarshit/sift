import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { diffLines, type LineDiffRow } from '../lib/diff'
import { detect, LANG_LABELS } from '../lib/detect'
import { Editor, type EditorHandle, type EditorLineDecoration } from './Editor'
import { Icon } from './ui'

type DiffSide = 'left' | 'right'

interface DiffEntry {
  row: LineDiffRow
  rowIndex: number
}

function loadScratch(key: string, fallback: string) {
  return localStorage.getItem(key) ?? fallback
}

function lineCount(text: string): number {
  if (!text) return 0
  let n = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

function offsetForLine(text: string, line: number): number {
  if (line <= 1) return 0
  let current = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      current++
      if (current === line) return i + 1
    }
  }
  return text.length
}

function decorationsFor(rows: LineDiffRow[], side: DiffSide): EditorLineDecoration[] {
  const out: EditorLineDecoration[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (row.kind === 'same') continue
    const line = side === 'left' ? row.leftLine : row.rightLine
    if (line == null) continue
    const kind = row.kind === 'changed' ? 'changed' : row.kind === 'added' ? 'added' : 'removed'
    const key = `${line}:${kind}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push({ line, kind })
    }
  }
  return out
}

function sideLabel(row: LineDiffRow) {
  if (row.leftLine != null && row.rightLine != null) return `L${row.leftLine} / R${row.rightLine}`
  if (row.leftLine != null) return `L${row.leftLine}`
  return row.rightLine != null ? `R${row.rightLine}` : ''
}

function DiffRow({
  entry,
  active,
  onJump,
}: {
  entry: DiffEntry
  active: boolean
  onJump: (entry: DiffEntry, side: DiffSide) => void
}) {
  const row = entry.row
  return (
    <div className={`diff-row diff-${row.kind} ${active ? 'diff-active' : ''}`}>
      <button className="diff-ln diff-hit" disabled={row.leftLine == null} onClick={() => onJump(entry, 'left')}>
        {row.leftLine ?? ''}
      </button>
      <button className="diff-code diff-hit" disabled={row.leftLine == null} onClick={() => onJump(entry, 'left')} title="Jump left">
        {row.left}
      </button>
      <button className="diff-ln diff-hit" disabled={row.rightLine == null} onClick={() => onJump(entry, 'right')}>
        {row.rightLine ?? ''}
      </button>
      <button className="diff-code diff-hit" disabled={row.rightLine == null} onClick={() => onJump(entry, 'right')} title="Jump right">
        {row.right}
      </button>
    </div>
  )
}

function LocationPane({
  entries,
  activeIndex,
  maxLine,
  onJump,
}: {
  entries: DiffEntry[]
  activeIndex: number
  maxLine: number
  onJump: (index: number) => void
}) {
  return (
    <aside className="location-pane min-h-0 border-t border-border md:border-l md:border-t-0">
      <div className="flex h-8 items-center border-b border-border px-3 font-mono text-[11px] font-semibold text-dim">
        Locations
      </div>
      {entries.length === 0 ? (
        <div className="p-4 text-[12px] text-dim">No differences to map.</div>
      ) : (
        <div className="grid min-h-0 grid-cols-[30px_minmax(0,1fr)] gap-3 p-3">
          <div className="location-map" aria-label="Difference map">
            {entries.map((entry, i) => {
              const line = entry.row.rightLine ?? entry.row.leftLine ?? 1
              const top = maxLine <= 1 ? 0 : ((line - 1) / (maxLine - 1)) * 100
              return (
                <button
                  key={`${entry.rowIndex}-${i}`}
                  className={`location-marker location-${entry.row.kind} ${i === activeIndex ? 'location-active' : ''}`}
                  style={{ top: `${Math.max(0, Math.min(98, top))}%` }}
                  onClick={() => onJump(i)}
                  title={`${entry.row.kind} ${sideLabel(entry.row)}`}
                  aria-label={`${entry.row.kind} ${sideLabel(entry.row)}`}
                />
              )
            })}
          </div>
          <div className="min-h-0 overflow-auto">
            {entries.map((entry, i) => (
              <button
                key={entry.rowIndex}
                className={`location-row location-row-${entry.row.kind} ${i === activeIndex ? 'location-row-active' : ''}`}
                onClick={() => onJump(i)}
                title={`${entry.row.kind} ${sideLabel(entry.row)}`}
              >
                <span className="capitalize">{entry.row.kind}</span>
                <span className="font-mono text-[11px] text-faint">{sideLabel(entry.row)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}

export function CompareView({ seedText, onExit }: { seedText: string; onExit: () => void }) {
  const [left, setLeft] = useState(() => loadScratch('sift:compare:left', seedText))
  const [right, setRight] = useState(() => loadScratch('sift:compare:right', ''))
  const [showSame, setShowSame] = useState(false)
  const [activeDiffIndex, setActiveDiffIndex] = useState(0)
  const leftRef = useRef<EditorHandle>(null)
  const rightRef = useRef<EditorHandle>(null)
  const leftDetected = useMemo(() => detect(left), [left])
  const rightDetected = useMemo(() => detect(right), [right])
  const sameLanguage = leftDetected.lang === rightDetected.lang
  const lineDiff = useMemo(() => diffLines(left, right), [left, right])
  const diffEntries = useMemo<DiffEntry[]>(
    () => lineDiff.rows.map((row, rowIndex) => ({ row, rowIndex })).filter((entry) => entry.row.kind !== 'same'),
    [lineDiff.rows],
  )
  const visibleRows = useMemo(
    () => lineDiff.rows.map((row, rowIndex) => ({ row, rowIndex })).filter((entry) => showSame || entry.row.kind !== 'same'),
    [lineDiff.rows, showSame],
  )
  const leftDecorations = useMemo(() => decorationsFor(lineDiff.rows, 'left'), [lineDiff.rows])
  const rightDecorations = useMemo(() => decorationsFor(lineDiff.rows, 'right'), [lineDiff.rows])
  const maxLine = Math.max(lineCount(left), lineCount(right), 1)

  const jumpToEntry = useCallback(
    (entry: DiffEntry, side: DiffSide = 'right') => {
      const nextIndex = diffEntries.findIndex((candidate) => candidate.rowIndex === entry.rowIndex)
      if (nextIndex >= 0) setActiveDiffIndex(nextIndex)
      const row = entry.row
      const requestedLine = side === 'left' ? row.leftLine : row.rightLine
      const fallbackSide = row.rightLine != null ? 'right' : 'left'
      const targetSide = requestedLine != null ? side : fallbackSide
      const line = targetSide === 'left' ? row.leftLine : row.rightLine
      if (line == null) return
      const targetText = targetSide === 'left' ? left : right
      const targetRef = targetSide === 'left' ? leftRef : rightRef
      targetRef.current?.jumpTo(offsetForLine(targetText, line), line)
    },
    [diffEntries, left, right],
  )

  const jumpBy = useCallback(
    (delta: number) => {
      if (diffEntries.length === 0) return
      const next = (activeDiffIndex + delta + diffEntries.length) % diffEntries.length
      setActiveDiffIndex(next)
      window.requestAnimationFrame(() => jumpToEntry(diffEntries[next]))
    },
    [activeDiffIndex, diffEntries, jumpToEntry],
  )

  useEffect(() => {
    if (activeDiffIndex >= diffEntries.length) setActiveDiffIndex(Math.max(0, diffEntries.length - 1))
  }, [activeDiffIndex, diffEntries.length])

  useEffect(() => {
    const t = window.setTimeout(() => localStorage.setItem('sift:compare:left', left), 400)
    return () => clearTimeout(t)
  }, [left])
  useEffect(() => {
    const t = window.setTimeout(() => localStorage.setItem('sift:compare:right', right), 400)
    return () => clearTimeout(t)
  }, [right])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <button className="btn" onClick={onExit} title="Back to editor">
          <Icon name="chevronRight" size={12} className="rotate-180" />
          Editor
        </button>
        <span className="font-mono text-[11px] text-dim">
          {LANG_LABELS[leftDetected.lang]} {sameLanguage ? 'vs' : 'vs'} {LANG_LABELS[rightDetected.lang]}
        </span>
        <span className="hidden text-[11px] text-faint sm:inline">
          {lineDiff.counts.changed} changed, {lineDiff.counts.added} added, {lineDiff.counts.removed} removed
        </span>
        {lineDiff.truncated && <span className="text-[11px] text-warn">large diff approximated</span>}
        <div className="flex-1" />
        <button className="btn" onClick={() => jumpBy(-1)} disabled={diffEntries.length === 0} title="Previous difference">
          <Icon name="chevronRight" size={12} className="rotate-180" />
          Previous
        </button>
        <button className="btn" onClick={() => jumpBy(1)} disabled={diffEntries.length === 0} title="Next difference">
          Next
          <Icon name="chevronRight" size={12} />
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            setLeft(right)
            setRight(left)
          }}
          title="Swap sides"
          aria-label="Swap sides"
        >
          <Icon name="swap" size={14} />
        </button>
      </div>

      <div className="grid min-h-0 flex-[1.25] grid-cols-1 border-b border-border md:grid-cols-2">
        <section className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
          <div className="flex h-8 items-center border-b border-border px-3 font-mono text-[11px] text-dim">Left</div>
          <div className="min-h-0 flex-1">
            <Editor ref={leftRef} value={left} onChange={setLeft} onAction={() => {}} language={leftDetected.lang} lineDecorations={leftDecorations} />
          </div>
        </section>
        <section className="flex min-h-0 flex-col">
          <div className="flex h-8 items-center border-b border-border px-3 font-mono text-[11px] text-dim">Right</div>
          <div className="min-h-0 flex-1">
            <Editor ref={rightRef} value={right} onChange={setRight} onAction={() => {}} language={rightDetected.lang} lineDecorations={rightDecorations} />
          </div>
        </section>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_280px]">
        <section className="min-h-0 overflow-hidden">
          <div className="flex h-8 items-center gap-2 border-b border-border px-3">
            <span className="font-mono text-[11px] font-semibold text-dim">Line diff</span>
            <button className="tab" aria-selected={showSame} onClick={() => setShowSame((v) => !v)}>
              {showSame ? 'Hide same' : 'Show same'}
            </button>
          </div>
          <div className="diff-grid min-h-0 overflow-auto">
            {visibleRows.length === 0 ? (
              <div className="p-4 text-[12px] text-dim">No differences found.</div>
            ) : (
              visibleRows.map((entry) => (
                <DiffRow
                  key={entry.rowIndex}
                  entry={entry}
                  active={diffEntries[activeDiffIndex]?.rowIndex === entry.rowIndex}
                  onJump={jumpToEntry}
                />
              ))
            )}
          </div>
        </section>

        <LocationPane entries={diffEntries} activeIndex={activeDiffIndex} maxLine={maxLine} onJump={(index) => jumpToEntry(diffEntries[index])} />
      </div>
    </div>
  )
}