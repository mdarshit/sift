export type Language = 'sql' | 'json' | 'js'

export type SqlDialect = 'sql' | 'sqlite' | 'postgresql' | 'mysql' | 'plsql' | 'tsql'

export interface Detection {
  lang: Language
  dialect: SqlDialect
}

/** A validation finding; null means the input is clean. */
export interface Issue {
  message: string
  /** 1-based. */
  line: number
  /** 1-based. */
  col: number
  offset: number
}

export type ValidationDepth = 'full' | 'lexical'

export interface ValidateResult {
  issue: Issue | null
  /** 'full' = real parser; 'lexical' = structure-only (non-SQLite SQL dialects). */
  depth: ValidationDepth
}

// ---------------------------------------------------------------------------
// Structure analysis (outline + dependency graph)
// ---------------------------------------------------------------------------

export interface OutlineNode {
  kind: 'statement' | 'cte' | 'subquery' | 'group'
  /** e.g. "INSERT INTO orders (42 cols)" or "… 1,112 more". */
  label: string
  /** 1-based line / 0-based char offset of the node's start, for jumpTo. */
  line: number
  offset: number
  /** Groups only: how many statements were collapsed into this row. */
  count?: number
  children?: OutlineNode[]
}

export interface GraphNode {
  id: string
  kind: 'table' | 'cte' | 'select'
  label: string
  line: number
  offset: number
}

export interface GraphData {
  nodes: GraphNode[]
  /** Data flow: source feeds consumer/target. */
  edges: { from: string; to: string }[]
}

export interface AnalyzeResult {
  outline: OutlineNode[]
  graph: GraphData
  /** True when outline or graph hit their size caps. */
  truncated: boolean
}

export interface ObfuscationMapping {
  identifiers: Record<string, string>
  strings: Record<string, string>
}

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
  counts: Record<LineDiffKind, number>
  /** True when the bounded fallback was used instead of the exact algorithm. */
  approximate: boolean
  /** True when rows were omitted from the response. */
  truncated: boolean
  omittedRows: number
}

export type JsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export interface JsonTreeNode {
  key: string
  path: string
  kind: JsonKind
  preview: string
  children?: JsonTreeNode[]
  /** Direct children omitted by the per-parent cap. */
  omittedChildren?: number
  /** Children were not traversed because the depth cap was reached. */
  depthTruncated?: boolean
}

export type JsonTreeResult =
  | {
      ok: true
      tree: JsonTreeNode
      truncated: boolean
      omittedNodes: number
      limits: { depth: boolean; nodes: boolean; children: boolean }
    }
  | { ok: false; error: 'parse'; message: string }

// ---------------------------------------------------------------------------
// Worker protocol
// ---------------------------------------------------------------------------

export type ToolRequest =
  | { id: number; action: 'validate'; lang: Language; dialect: SqlDialect; text: string }
  | { id: number; action: 'format'; lang: Language; dialect: SqlDialect; text: string }
  | { id: number; action: 'minify'; lang: Language; text: string }
  | { id: number; action: 'obfuscate'; text: string }
  | { id: number; action: 'analyze'; text: string }
  | { id: number; action: 'lineDiff'; left: string; right: string }
  | { id: number; action: 'jsonTree'; text: string }

export type ToolResponse =
  | { id: number; action: 'validate'; ok: true; validate: ValidateResult }
  | { id: number; action: 'format'; ok: true; result: string }
  | { id: number; action: 'minify'; ok: true; result: string }
  | {
      id: number
      action: 'obfuscate'
      ok: true
      result: string
      counts: { identifiers: number; strings: number }
      mapping: ObfuscationMapping
    }
  | { id: number; action: 'analyze'; ok: true; analyze: AnalyzeResult }
  | { id: number; action: 'lineDiff'; ok: true; diff: LineDiffResult }
  | { id: number; action: 'jsonTree'; ok: true; json: JsonTreeResult }
  | { id: number; ok: false; error: string }
