/**
 * Structure analysis for the outline / dependency-graph panel. One pass over
 * the shared SQL tokenizer (no AST): statements are split at top-level ';',
 * each contributes an outline node (consecutive similar statements are
 * grouped) and table/CTE data-flow edges for the graph.
 */
import { tokenize } from './transform'
import { KEYWORDS } from './sqlTokens'
import type { AnalyzeResult, GraphNode, OutlineNode } from '../types'

const OUTLINE_CAP = 2_000 // total outline nodes
const GROUP_CHILD_CAP = 200 // statements listed inside one expanded group
const GRAPH_NODE_CAP = 80

interface PTok {
  type: 'string' | 'qident' | 'param' | 'word' | 'number' | 'punct'
  text: string
  offset: number
  line: number
}

/** Significant tokens (whitespace/comments dropped) with offset + 1-based line. */
function significant(sql: string): PTok[] {
  const out: PTok[] = []
  let offset = 0
  let line = 1
  for (const t of tokenize(sql)) {
    if (t.type !== 'ws' && t.type !== 'comment') {
      out.push({ type: t.type, text: t.text, offset, line })
    }
    for (let i = 0; i < t.text.length; i++) if (t.text.charCodeAt(i) === 10) line++
    offset += t.text.length
  }
  return out
}

/** Split at top-level ';' (strings/comments are already isolated by the tokenizer). */
function splitStatements(toks: PTok[]): PTok[][] {
  const stmts: PTok[][] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.type !== 'punct') continue
    if (t.text === '(') depth++
    else if (t.text === ')') depth = Math.max(0, depth - 1)
    else if (t.text === ';' && depth === 0) {
      if (i > start) stmts.push(toks.slice(start, i))
      start = i + 1
    }
  }
  if (start < toks.length) stmts.push(toks.slice(start))
  return stmts
}

function unquote(t: PTok): string {
  return t.type === 'qident' && t.text.length > 1 ? t.text.slice(1, -1) : t.text
}

/** Read a possibly schema-qualified name at i ("s"."t", db.t…); null if not a name. */
function dottedName(toks: PTok[], i: number): { name: string; next: number } | null {
  const t = toks[i]
  if (!t || (t.type !== 'word' && t.type !== 'qident')) return null
  let name = unquote(t)
  let j = i + 1
  while (
    toks[j]?.type === 'punct' &&
    toks[j].text === '.' &&
    (toks[j + 1]?.type === 'word' || toks[j + 1]?.type === 'qident')
  ) {
    name += '.' + unquote(toks[j + 1])
    j += 2
  }
  return { name, next: j }
}

/** Index of the ')' matching the '(' at `open` (or the last token index). */
function matchParen(toks: PTok[], open: number): number {
  let depth = 0
  for (let i = open; i < toks.length; i++) {
    if (toks[i].type !== 'punct') continue
    if (toks[i].text === '(') depth++
    else if (toks[i].text === ')' && --depth === 0) return i
  }
  return toks.length - 1
}

const isWord = (t: PTok | undefined, w: string) => t?.type === 'word' && t.text.toLowerCase() === w

interface CteSpan {
  name: string
  line: number
  offset: number
  /** Token-index range of the body, exclusive of the parens. */
  bodyStart: number
  bodyEnd: number
  openIdx: number
}

/** Parse `WITH [RECURSIVE] name [cols] AS [MATERIALIZED] ( … ) [, …]`. */
function parseCtes(toks: PTok[]): { ctes: CteSpan[]; mainStart: number } {
  const ctes: CteSpan[] = []
  let i = 1
  if (isWord(toks[i], 'recursive')) i++
  while (i < toks.length) {
    const nameTok = toks[i]
    const nm = dottedName(toks, i)
    if (!nm) break
    i = nm.next
    if (toks[i]?.text === '(') i = matchParen(toks, i) + 1 // optional column list
    if (!isWord(toks[i], 'as')) break
    i++
    while (toks[i]?.type === 'word') i++ // AS [NOT] MATERIALIZED
    if (toks[i]?.text !== '(') break
    const open = i
    const close = matchParen(toks, i)
    ctes.push({
      name: nm.name,
      line: nameTok.line,
      offset: nameTok.offset,
      bodyStart: open + 1,
      bodyEnd: close,
      openIdx: open,
    })
    i = close + 1
    if (toks[i]?.text === ',') {
      i++
      continue
    }
    break
  }
  return { ctes, mainStart: i }
}

interface StmtInfo {
  kind: string
  /** CREATE/ALTER/DROP object word (TABLE, VIEW, INDEX…). */
  objectType: string | null
  target: string | null
  colCount: number | null
  firstRead: string | null
  line: number
  offset: number
  ctes: CteSpan[]
  subqueries: { line: number; offset: number }[]
  /** Table references with the position of their first token; inCte names the
   *  CTE whose body contains the reference (null = main query). */
  reads: { name: string; inCte: string | null; line: number; offset: number }[]
}

function analyzeStatement(toks: PTok[]): StmtInfo {
  const first = toks[0]
  let kind = first.type === 'word' ? first.text.toUpperCase() : 'STATEMENT'
  let ctes: CteSpan[] = []
  let mainStart = 0
  if (kind === 'WITH') {
    const parsed = parseCtes(toks)
    ctes = parsed.ctes
    mainStart = parsed.mainStart
    const mainTok = toks[mainStart]
    kind = mainTok?.type === 'word' ? mainTok.text.toUpperCase() : 'STATEMENT'
  }
  const cteOpens = new Set(ctes.map((c) => c.openIdx))
  const inCteAt = (k: number): string | null => {
    for (const c of ctes) if (k >= c.bodyStart && k < c.bodyEnd) return c.name
    return null
  }

  let target: string | null = null
  let objectType: string | null = null
  let colCount: number | null = null
  const reads: StmtInfo['reads'] = []
  const subqueries: StmtInfo['subqueries'] = []

  // Kind-specific target that isn't introduced by INTO/FROM.
  if (kind === 'UPDATE') {
    let j = mainStart + 1
    if (isWord(toks[j], 'only')) j++
    target = dottedName(toks, j)?.name ?? null
  } else if (kind === 'CREATE' || kind === 'ALTER' || kind === 'DROP') {
    // CREATE [OR REPLACE] [TEMP] [UNIQUE] [MATERIALIZED] TABLE/VIEW/… [IF NOT EXISTS] name
    let j = mainStart + 1
    const modifiers = new Set(['or', 'replace', 'temp', 'temporary', 'unique', 'materialized', 'global', 'local'])
    while (toks[j]?.type === 'word' && modifiers.has(toks[j].text.toLowerCase())) j++
    if (toks[j]?.type === 'word') {
      objectType = toks[j].text.toUpperCase()
      j++
    }
    while (toks[j]?.type === 'word' && ['if', 'not', 'exists'].includes(toks[j].text.toLowerCase())) j++
    target = dottedName(toks, j)?.name ?? null
  }

  // Scan the whole statement (CTE bodies included; inCteAt attributes them).
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (t.type === 'punct' && t.text === '(' && isWord(toks[k + 1], 'select') && !cteOpens.has(k)) {
      if (subqueries.length < 20) subqueries.push({ line: t.line, offset: t.offset })
      continue
    }
    if (t.type !== 'word') continue
    const w = t.text.toLowerCase()
    if (w === 'into') {
      const nm = dottedName(toks, k + 1)
      if (nm) {
        target ??= nm.name
        // INSERT column list: (a, b, c) right after the target name
        if (kind === 'INSERT' && toks[nm.next]?.text === '(' && !isWord(toks[nm.next + 1], 'select')) {
          const close = matchParen(toks, nm.next)
          let commas = 0
          let depth = 0
          for (let p = nm.next + 1; p < close; p++) {
            const pt = toks[p]
            if (pt.type !== 'punct') continue
            if (pt.text === '(') depth++
            else if (pt.text === ')') depth--
            else if (pt.text === ',' && depth === 0) commas++
          }
          colCount = commas + 1
        }
        k = nm.next - 1
      }
    } else if (w === 'from' || w === 'join') {
      // DELETE FROM t: the FROM name is the write target, not a read.
      if (w === 'from' && kind === 'DELETE' && target === null) {
        const nm = dottedName(toks, k + 1)
        if (nm) {
          target = nm.name
          k = nm.next - 1
        }
        continue
      }
      let j = k + 1
      for (;;) {
        const nm = dottedName(toks, j)
        if (!nm) break
        reads.push({ name: nm.name, inCte: inCteAt(j), line: toks[j].line, offset: toks[j].offset })
        j = nm.next
        // optional alias: [AS] word
        if (isWord(toks[j], 'as')) j++
        if (toks[j]?.type === 'word' && !KEYWORDS.has(toks[j].text.toLowerCase())) j++
        if (w === 'from' && toks[j]?.type === 'punct' && toks[j].text === ',') {
          j++
          continue
        }
        break
      }
      k = j - 1
    }
  }

  const firstRead = reads.find((r) => r.inCte === null)?.name ?? reads[0]?.name ?? null
  return { kind, objectType, target, colCount, firstRead, line: first.line, offset: first.offset, ctes, subqueries, reads }
}

function stmtLabel(s: StmtInfo): string {
  const t = s.target
  switch (s.kind) {
    case 'INSERT':
      return `INSERT INTO ${t ?? '…'}${s.colCount ? ` (${s.colCount} cols)` : ''}`
    case 'DELETE':
      return `DELETE FROM ${t ?? '…'}`
    case 'UPDATE':
      return `UPDATE ${t ?? '…'}`
    case 'SELECT':
      return s.firstRead ? `SELECT … FROM ${s.firstRead}` : 'SELECT'
    default: {
      const parts = [s.kind, s.objectType, t].filter(Boolean)
      return parts.join(' ')
    }
  }
}

/** Key for grouping runs of near-identical statements. */
function groupKey(s: StmtInfo): string | null {
  if (s.ctes.length > 0 || s.subqueries.length > 0) return null
  return stmtLabel(s).toLowerCase()
}

function stmtNode(s: StmtInfo): OutlineNode {
  const children: OutlineNode[] = [
    ...s.ctes.map<OutlineNode>((c) => ({ kind: 'cte', label: `CTE ${c.name}`, line: c.line, offset: c.offset })),
    ...s.subqueries.map<OutlineNode>((q) => ({ kind: 'subquery', label: 'SELECT (subquery)', line: q.line, offset: q.offset })),
  ]
  return {
    kind: 'statement',
    label: stmtLabel(s),
    line: s.line,
    offset: s.offset,
    ...(children.length > 0 ? { children } : {}),
  }
}

export function analyzeSql(sql: string): AnalyzeResult {
  const stmts = splitStatements(significant(sql))
    .filter((s) => s.length > 0)
    .map(analyzeStatement)

  let truncated = false

  // ---- Outline, with consecutive-run grouping --------------------------------
  const outline: OutlineNode[] = []
  let emitted = 0
  let i = 0
  while (i < stmts.length) {
    if (emitted >= OUTLINE_CAP) {
      outline.push({
        kind: 'group',
        label: `… ${(stmts.length - i).toLocaleString()} more statements`,
        line: stmts[i].line,
        offset: stmts[i].offset,
        count: stmts.length - i,
      })
      truncated = true
      break
    }
    const key = groupKey(stmts[i])
    let run = 1
    while (key !== null && i + run < stmts.length && groupKey(stmts[i + run]) === key) run++
    if (run >= 2) {
      const members = stmts.slice(i, i + run)
      const children = members.slice(0, GROUP_CHILD_CAP).map<OutlineNode>((s, idx) => ({
        kind: 'statement',
        label: `#${(idx + 1).toLocaleString()}  ${stmtLabel(s)}`,
        line: s.line,
        offset: s.offset,
      }))
      if (run > GROUP_CHILD_CAP) {
        children.push({
          kind: 'group',
          label: `… ${(run - GROUP_CHILD_CAP).toLocaleString()} more`,
          line: members[GROUP_CHILD_CAP].line,
          offset: members[GROUP_CHILD_CAP].offset,
          count: run - GROUP_CHILD_CAP,
        })
        truncated = true
      }
      outline.push({
        kind: 'group',
        label: `${stmtLabel(members[0])} — ${run.toLocaleString()} statements`,
        line: members[0].line,
        offset: members[0].offset,
        count: run,
        children,
      })
      emitted += 1 + children.length
    } else {
      const node = stmtNode(stmts[i])
      outline.push(node)
      emitted += 1 + (node.children?.length ?? 0)
    }
    i += run
  }

  // ---- Graph ------------------------------------------------------------------
  const nodes = new Map<string, GraphNode>()
  const edges = new Set<string>()
  let selectSeq = 0

  const addNode = (id: string, node: () => GraphNode): boolean => {
    if (nodes.has(id)) return true
    if (nodes.size >= GRAPH_NODE_CAP) {
      truncated = true
      return false
    }
    nodes.set(id, node())
    return true
  }
  const addEdge = (from: string, to: string) => {
    if (from !== to && nodes.has(from) && nodes.has(to)) edges.add(`${from} ${to}`)
  }

  for (let stmtIndex = 0; stmtIndex < stmts.length; stmtIndex++) {
    const s = stmts[stmtIndex]
    const cteIds = new Map(s.ctes.map((c) => [c.name.toLowerCase(), `#cte-${stmtIndex + 1}-${c.name.toLowerCase()}`]))
    for (const c of s.ctes) {
      const id = cteIds.get(c.name.toLowerCase()) as string
      addNode(id, () => ({
        id,
        kind: 'cte',
        label: c.name,
        line: c.line,
        offset: c.offset,
      }))
    }
    let targetId: string | null = null
    if (s.target) {
      targetId = s.target.toLowerCase()
      addNode(targetId, () => ({ id: targetId!, kind: 'table', label: s.target!, line: s.line, offset: s.offset }))
    } else if (s.kind === 'SELECT' && s.reads.some((r) => r.inCte === null)) {
      selectSeq++
      targetId = `#select-${selectSeq}`
      addNode(targetId, () => ({
        id: targetId!,
        kind: 'select',
        label: `SELECT #${selectSeq}`,
        line: s.line,
        offset: s.offset,
      }))
    }
    for (const r of s.reads) {
      const nameKey = r.name.toLowerCase()
      const id = cteIds.get(nameKey) ?? nameKey
      addNode(id, () => ({
        id,
        kind: cteIds.has(nameKey) ? 'cte' : 'table',
        label: r.name,
        line: r.line,
        offset: r.offset,
      }))
      const to = r.inCte !== null ? (cteIds.get(r.inCte.toLowerCase()) ?? null) : targetId
      if (to) addEdge(id, to)
    }
  }

  return {
    outline,
    graph: {
      nodes: [...nodes.values()],
      edges: [...edges].map((e) => {
        const [from, to] = e.split(' ')
        return { from, to }
      }),
    },
    truncated,
  }
}
