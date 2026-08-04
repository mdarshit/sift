import { describe, expect, it } from 'vitest'
import { diffJson, parseJsonTree } from '../jsonTools'

describe('parseJsonTree', () => {
  it('builds a navigable object tree with paths', () => {
    const r = parseJsonTree('{"user":{"name":"Ada","roles":["admin"]}}')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tree.children?.[0].path).toBe('$.user')
    expect(r.tree.children?.[0].children?.[1].path).toBe('$.user.roles')
  })

  it('returns parser errors without throwing', () => {
    const r = parseJsonTree('{bad')
    expect(r.ok).toBe(false)
  })
})

describe('diffJson', () => {
  it('reports added, removed and changed paths', () => {
    const r = diffJson('{"a":1,"b":2,"c":3}', '{"a":1,"b":4,"d":5}')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items).toEqual(
      expect.arrayContaining([
        { kind: 'changed', path: '$.b', left: '2', right: '4' },
        { kind: 'removed', path: '$.c', left: '3', right: '' },
        { kind: 'added', path: '$.d', left: '', right: '5' },
      ]),
    )
  })

  it('reports which side failed to parse', () => {
    const r = diffJson('{"a":1}', '{bad')
    expect(r).toMatchObject({ ok: false, side: 'right' })
  })
})