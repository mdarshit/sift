export type LineDiffKind = 'same' | 'added' | 'removed' | 'changed'

export interface LineDiffRow {
  kind: LineDiffKind
  leftLine: number | null
  rightLine: number | null
  left: string
  right: string
}

export interface LineDiffResult {
  rows: LineDiffRow[]
  counts: {
    added: number
    removed: number
    changed: number
    same: number
  }
  truncated: boolean
}

const MAX_EXACT_CELLS = 4_000_000
const MAX_ROWS = 5_000

function splitLines(text: string): string[] {
  if (text.length === 0) return []
  return text.replace(/\r\n?/g, '\n').split('\n')
}

function countRows(rows: LineDiffRow[]): LineDiffResult['counts'] {
  const counts = { added: 0, removed: 0, changed: 0, same: 0 }
  for (const row of rows) counts[row.kind]++
  return counts
}

function pairwiseDiff(left: string[], right: string[]): LineDiffRow[] {
  const rows: LineDiffRow[] = []
  const n = Math.max(left.length, right.length)
  for (let i = 0; i < n; i++) {
    const hasLeft = i < left.length
    const hasRight = i < right.length
    if (hasLeft && hasRight && left[i] === right[i]) {
      rows.push({ kind: 'same', leftLine: i + 1, rightLine: i + 1, left: left[i], right: right[i] })
    } else if (hasLeft && hasRight) {
      rows.push({ kind: 'changed', leftLine: i + 1, rightLine: i + 1, left: left[i], right: right[i] })
    } else if (hasLeft) {
      rows.push({ kind: 'removed', leftLine: i + 1, rightLine: null, left: left[i], right: '' })
    } else {
      rows.push({ kind: 'added', leftLine: null, rightLine: i + 1, left: '', right: right[i] })
    }
    if (rows.length >= MAX_ROWS) break
  }
  return rows
}

function compactAdjacentChanges(rows: LineDiffRow[]): LineDiffRow[] {
  const out: LineDiffRow[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.kind !== 'removed') {
      out.push(row)
      continue
    }

    const removed: LineDiffRow[] = []
    while (rows[i]?.kind === 'removed') {
      removed.push(rows[i])
      i++
    }
    const added: LineDiffRow[] = []
    while (rows[i]?.kind === 'added') {
      added.push(rows[i])
      i++
    }
    i--

    const pairs = Math.min(removed.length, added.length)
    for (let p = 0; p < pairs; p++) {
      out.push({
        kind: 'changed',
        leftLine: removed[p].leftLine,
        rightLine: added[p].rightLine,
        left: removed[p].left,
        right: added[p].right,
      })
    }
    for (let p = pairs; p < removed.length; p++) out.push(removed[p])
    for (let p = pairs; p < added.length; p++) out.push(added[p])
  }
  return out
}

export function diffLines(leftText: string, rightText: string): LineDiffResult {
  const left = splitLines(leftText)
  const right = splitLines(rightText)
  const cells = (left.length + 1) * (right.length + 1)
  const truncated = Math.max(left.length, right.length) > MAX_ROWS || cells > MAX_EXACT_CELLS

  if (truncated) {
    const rows = pairwiseDiff(left, right)
    return { rows, counts: countRows(rows), truncated: true }
  }

  const width = right.length + 1
  const dp = new Uint32Array((left.length + 1) * width)
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      dp[i * width + j] =
        left[i] === right[j] ? dp[(i + 1) * width + j + 1] + 1 : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1])
    }
  }

  const rows: LineDiffRow[] = []
  let i = 0
  let j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      rows.push({ kind: 'same', leftLine: i + 1, rightLine: j + 1, left: left[i], right: right[j] })
      i++
      j++
    } else if (j >= right.length || (i < left.length && dp[(i + 1) * width + j] >= dp[i * width + j + 1])) {
      rows.push({ kind: 'removed', leftLine: i + 1, rightLine: null, left: left[i], right: '' })
      i++
    } else {
      rows.push({ kind: 'added', leftLine: null, rightLine: j + 1, left: '', right: right[j] })
      j++
    }
    if (rows.length >= MAX_ROWS) break
  }

  const compacted = compactAdjacentChanges(rows)
  return { rows: compacted, counts: countRows(compacted), truncated: rows.length >= MAX_ROWS }
}
