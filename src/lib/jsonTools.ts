import type { JsonKind, JsonTreeNode, JsonTreeResult } from '../types'

const MAX_DEPTH = 40
const MAX_NODES = 5_000
const MAX_CHILDREN = 500
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

function kindOf(value: unknown): JsonKind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const kind = typeof value
  return kind === 'string' || kind === 'number' || kind === 'boolean' ? kind : 'object'
}

function preview(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).length}}`
  const text = JSON.stringify(value)
  return text.length > 80 ? `${text.slice(0, 77)}...` : text
}

function pathFor(parent: string, key: string, arrayIndex: boolean): string {
  if (arrayIndex) return `${parent}[${key}]`
  return IDENTIFIER.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`
}

function makeNode(value: unknown, key: string, path: string): JsonTreeNode {
  return { key, path, kind: kindOf(value), preview: preview(value) }
}

export function parseJsonTree(text: string): JsonTreeResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: 'parse', message: err instanceof Error ? err.message : String(err) }
  }
  const tree = makeNode(value, '$', '$')
  const limits = { depth: false, nodes: false, children: false }
  let nodes = 1
  let omittedNodes = 0
  const stack: { value: unknown; node: JsonTreeNode; depth: number }[] = [{ value, node: tree, depth: 0 }]
  while (stack.length) {
    const current = stack.pop()!
    if (current.node.kind !== 'array' && current.node.kind !== 'object') continue
    const keys = Array.isArray(current.value) ? current.value.map((_, i) => String(i)) : Object.keys(current.value as object)
    if (current.depth >= MAX_DEPTH) {
      current.node.depthTruncated = keys.length > 0
      if (keys.length) {
        limits.depth = true
        omittedNodes += keys.length
      }
      continue
    }
    const allowed = Math.min(keys.length, MAX_CHILDREN, MAX_NODES - nodes)
    if (allowed < keys.length) {
      current.node.omittedChildren = keys.length - allowed
      omittedNodes += keys.length - allowed
      if (keys.length > MAX_CHILDREN) limits.children = true
      if (nodes >= MAX_NODES || allowed < Math.min(keys.length, MAX_CHILDREN)) limits.nodes = true
    }
    const children: JsonTreeNode[] = []
    for (let i = 0; i < allowed; i++) {
      const key = keys[i]
      const container = current.value as Record<string, unknown>
      if (!Object.prototype.hasOwnProperty.call(container, key)) continue
      const childValue = container[key]
      const child = makeNode(childValue, key, pathFor(current.node.path, key, Array.isArray(current.value)))
      children.push(child)
      nodes++
      stack.push({ value: childValue, node: child, depth: current.depth + 1 })
    }
    current.node.children = children
  }
  const truncated = limits.depth || limits.nodes || limits.children
  return { ok: true, tree, truncated, omittedNodes, limits }
}
