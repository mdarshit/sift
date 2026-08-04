import type { LineDiffResult, LineDiffRow } from '../types'

const MAX_EXACT_CELLS = 1_000_000
const MAX_ROWS = 5_000

function splitLines(text: string): string[] {
  if (!text) return []
  return text.replace(/\r\n?/g, '\n').split('\n')
}

function row(kind: LineDiffRow['kind'], left: string[], right: string[], i: number | null, j: number | null): LineDiffRow {
  return {
    kind,
    leftLine: i === null ? null : i + 1,
    rightLine: j === null ? null : j + 1,
    left: i === null ? '' : left[i],
    right: j === null ? '' : right[j],
  }
}

function compact(rows: LineDiffRow[]): LineDiffRow[] {
  const out: LineDiffRow[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind !== 'removed') {
      out.push(rows[i])
      continue
    }
    const removed: LineDiffRow[] = []
    const added: LineDiffRow[] = []
    while (rows[i]?.kind === 'removed') removed.push(rows[i++])
    while (rows[i]?.kind === 'added') added.push(rows[i++])
    i--
    const pairs = Math.min(removed.length, added.length)
    for (let p = 0; p < pairs; p++) out.push({ ...removed[p], kind: 'changed', rightLine: added[p].rightLine, right: added[p].right })
    out.push(...removed.slice(pairs), ...added.slice(pairs))
  }
  return out
}

function finish(allRows: LineDiffRow[], approximate: boolean, totalRows = allRows.length): LineDiffResult {
  const counts: LineDiffResult['counts'] = { same: 0, added: 0, removed: 0, changed: 0 }
  for (const item of allRows) counts[item.kind]++
  let rows = allRows
  if (rows.length > MAX_ROWS) {
    const changed = allRows.flatMap((item, index) => item.kind === 'same' ? [] : [index])
    const selected = new Set<number>()
    if (changed.length >= MAX_ROWS) {
      const before = Math.floor(MAX_ROWS / 2)
      changed.slice(0, before).forEach((index) => selected.add(index))
      changed.slice(-(MAX_ROWS - before)).forEach((index) => selected.add(index))
    } else {
      changed.forEach((index) => selected.add(index))
      const remaining = MAX_ROWS - selected.size
      for (let index = 0; index < allRows.length && selected.size < changed.length + Math.floor(remaining / 2); index++) selected.add(index)
      for (let index = allRows.length - 1; index >= 0 && selected.size < MAX_ROWS; index--) selected.add(index)
    }
    rows = [...selected].sort((a, b) => a - b).map((index) => allRows[index])
  }
  return { rows, counts, approximate, truncated: totalRows > rows.length, omittedRows: Math.max(0, totalRows - rows.length) }
}

function fallback(left: string[], right: string[], prefix: number, suffix: number): LineDiffResult {
  const middleLeft = left.length - prefix - suffix
  const middleRight = right.length - prefix - suffix
  const middle = Math.max(middleLeft, middleRight)
  const total = prefix + middle + suffix
  const rows: LineDiffRow[] = []
  const budgetBefore = Math.floor(MAX_ROWS / 2)
  const prefixStart = Math.max(0, prefix - budgetBefore)
  for (let i = prefixStart; i < prefix; i++) rows.push(row('same', left, right, i, i))
  for (let k = 0; k < middle && rows.length < MAX_ROWS; k++) {
    const i = k < middleLeft ? prefix + k : null
    const j = k < middleRight ? prefix + k : null
    rows.push(row(i === null ? 'added' : j === null ? 'removed' : left[i] === right[j] ? 'same' : 'changed', left, right, i, j))
  }
  const suffixBudget = MAX_ROWS - rows.length
  for (let k = Math.max(0, suffix - suffixBudget); k < suffix; k++) {
    rows.push(row('same', left, right, left.length - suffix + k, right.length - suffix + k))
  }
  return finish(rows, true, total)
}

export function diffLines(leftText: string, rightText: string): LineDiffResult {
  const left = splitLines(leftText)
  const right = splitLines(rightText)
  let prefix = 0
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++
  let suffix = 0
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++
  const lSize = left.length - prefix - suffix
  const rSize = right.length - prefix - suffix
  if ((lSize + 1) * (rSize + 1) > MAX_EXACT_CELLS) return fallback(left, right, prefix, suffix)

  const width = rSize + 1
  const dp = new Uint32Array((lSize + 1) * width)
  for (let i = lSize - 1; i >= 0; i--) for (let j = rSize - 1; j >= 0; j--) {
    dp[i * width + j] = left[prefix + i] === right[prefix + j]
      ? dp[(i + 1) * width + j + 1] + 1
      : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1])
  }
  const rows: LineDiffRow[] = []
  for (let i = 0; i < prefix; i++) rows.push(row('same', left, right, i, i))
  let i = 0
  let j = 0
  while (i < lSize || j < rSize) {
    if (i < lSize && j < rSize && left[prefix + i] === right[prefix + j]) rows.push(row('same', left, right, prefix + i++, prefix + j++))
    else if (j >= rSize || (i < lSize && dp[(i + 1) * width + j] >= dp[i * width + j + 1])) rows.push(row('removed', left, right, prefix + i++, null))
    else rows.push(row('added', left, right, null, prefix + j++))
  }
  for (let k = 0; k < suffix; k++) rows.push(row('same', left, right, left.length - suffix + k, right.length - suffix + k))
  return finish(compact(rows), false)
}
