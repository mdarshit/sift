import { describe, expect, it } from 'vitest'
import { parseJsonTree } from '../jsonTools'

describe('parseJsonTree', () => {
  it('uses escaped bracket paths for unusual keys', () => {
    const result = parseJsonTree('{"normal":1,"a.b":2,"quote\\\"key":3,"":4}')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tree.children?.map((node) => node.path)).toEqual([
      '$.normal',
      '$["a.b"]',
      '$["quote\\\"key"]',
      '$[""]',
    ])
  })

  it('keeps prototype-like own properties', () => {
    const result = parseJsonTree('{"__proto__":{"constructor":1},"toString":2}')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tree.children?.map((node) => node.key)).toEqual(['__proto__', 'toString'])
    expect(result.tree.children?.[0].children?.[0].path).toBe('$.__proto__.constructor')
  })

  it('reports per-parent child omissions explicitly', () => {
    const text = JSON.stringify(Object.fromEntries(Array.from({ length: 510 }, (_, i) => [`k${i}`, i])))
    const result = parseJsonTree(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tree.children).toHaveLength(500)
    expect(result.tree.omittedChildren).toBe(10)
    expect(result).toMatchObject({ truncated: true, omittedNodes: 10, limits: { children: true } })
  })

  it('caps depth without recursive traversal', () => {
    let text = '0'
    for (let i = 0; i < 60; i++) text = `{"next":${text}}`
    const result = parseJsonTree(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    let node = result.tree
    for (let i = 0; i < 40; i++) node = node.children![0]
    expect(node.depthTruncated).toBe(true)
    expect(result).toMatchObject({ truncated: true, limits: { depth: true } })
  })

  it('caps the total number of tree nodes globally', () => {
    const branch = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`leaf${i}`, i]))
    const text = JSON.stringify(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`branch${i}`, branch])))
    const result = parseJsonTree(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({ truncated: true, limits: { nodes: true } })
    expect(result.omittedNodes).toBeGreaterThan(0)
    let count = 0
    const pending = [result.tree]
    while (pending.length) {
      const node = pending.pop()!
      count++
      pending.push(...(node.children ?? []))
    }
    expect(count).toBe(5_000)
  })

  it('distinguishes parse errors from successful limited traversal', () => {
    expect(parseJsonTree('{bad')).toMatchObject({ ok: false, error: 'parse' })
  })
})
