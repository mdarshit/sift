export type JsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export interface JsonTreeNode {
  key: string
  path: string
  kind: JsonKind
  preview: string
  children?: JsonTreeNode[]
}

export type JsonParseResult = { ok: true; value: unknown; tree: JsonTreeNode } | { ok: false; message: string }

export type JsonDiffKind = 'added' | 'removed' | 'changed' | 'type'

export interface JsonDiffItem {
  kind: JsonDiffKind
  path: string
  left: string
  right: string
}

export interface JsonDiffResult {
  ok: true
  items: JsonDiffItem[]
  truncated: boolean
}

export type JsonDiffParseResult = JsonDiffResult | { ok: false; side: 'left' | 'right'; message: string }

const DIFF_LIMIT = 600
const CHILD_LIMIT = 500

function kindOf(value: unknown): JsonKind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return t
  return 'object'
}

function preview(value: unknown): string {
  const kind = kindOf(value)
  if (kind === 'object') return `{${Object.keys(value as Record<string, unknown>).length}}`
  if (kind === 'array') return `[${(value as unknown[]).length}]`
  const text = JSON.stringify(value)
  return text.length > 80 ? text.slice(0, 77) + '...' : text
}

function childPath(parent: string, key: string | number): string {
  return typeof key === 'number' ? `${parent}[${key}]` : `${parent}.${key}`
}

function buildTree(value: unknown, key = '$', path = '$'): JsonTreeNode {
  const kind = kindOf(value)
  if (kind === 'array') {
    const arr = value as unknown[]
    return {
      key,
      path,
      kind,
      preview: preview(value),
      children: arr.slice(0, CHILD_LIMIT).map((item, i) => buildTree(item, String(i), childPath(path, i))),
    }
  }
  if (kind === 'object') {
    const obj = value as Record<string, unknown>
    return {
      key,
      path,
      kind,
      preview: preview(value),
      children: Object.keys(obj)
        .slice(0, CHILD_LIMIT)
        .map((name) => buildTree(obj[name], name, childPath(path, name))),
    }
  }
  return { key, path, kind, preview: preview(value) }
}

export function parseJsonTree(text: string): JsonParseResult {
  try {
    const value = JSON.parse(text)
    return { ok: true, value, tree: buildTree(value) }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

function pushDiff(items: JsonDiffItem[], item: JsonDiffItem): boolean {
  if (items.length >= DIFF_LIMIT) return false
  items.push(item)
  return true
}

function diffValue(left: unknown, right: unknown, path: string, items: JsonDiffItem[]): boolean {
  if (Object.is(left, right)) return true
  const lk = kindOf(left)
  const rk = kindOf(right)
  if (lk !== rk) return pushDiff(items, { kind: 'type', path, left: lk, right: rk })

  if (lk === 'array') {
    const l = left as unknown[]
    const r = right as unknown[]
    const n = Math.max(l.length, r.length)
    for (let i = 0; i < n; i++) {
      if (i >= l.length && !pushDiff(items, { kind: 'added', path: childPath(path, i), left: '', right: preview(r[i]) })) return false
      else if (i >= r.length && !pushDiff(items, { kind: 'removed', path: childPath(path, i), left: preview(l[i]), right: '' })) return false
      else if (!diffValue(l[i], r[i], childPath(path, i), items)) return false
    }
    return true
  }

  if (lk === 'object') {
    const l = left as Record<string, unknown>
    const r = right as Record<string, unknown>
    const keys = [...new Set([...Object.keys(l), ...Object.keys(r)])].sort()
    for (const key of keys) {
      if (!(key in l) && !pushDiff(items, { kind: 'added', path: childPath(path, key), left: '', right: preview(r[key]) })) return false
      else if (!(key in r) && !pushDiff(items, { kind: 'removed', path: childPath(path, key), left: preview(l[key]), right: '' })) return false
      else if (!diffValue(l[key], r[key], childPath(path, key), items)) return false
    }
    return true
  }

  return pushDiff(items, { kind: 'changed', path, left: preview(left), right: preview(right) })
}

export function diffJson(leftText: string, rightText: string): JsonDiffParseResult {
  const left = parseJsonTree(leftText)
  if (!left.ok) return { ok: false, side: 'left', message: left.message }
  const right = parseJsonTree(rightText)
  if (!right.ok) return { ok: false, side: 'right', message: right.message }
  const items: JsonDiffItem[] = []
  const complete = diffValue(left.value, right.value, '$', items)
  return { ok: true, items, truncated: !complete }
}
