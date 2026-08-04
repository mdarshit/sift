import { describe, expect, it } from 'vitest'
import { diffLines } from '../diff'

describe('diffLines', () => {
  it('finds unchanged, changed, inserted, and removed lines', () => {
    const result = diffLines('a\nold\nremove\nz', 'a\nnew\ninsert\nz')
    expect(result.rows.map((item) => item.kind)).toEqual(['same', 'changed', 'changed', 'same'])
    expect(result.rows[1]).toMatchObject({ leftLine: 2, rightLine: 2, left: 'old', right: 'new' })
    expect(result.approximate).toBe(false)
  })

  it('normalizes CRLF while preserving a trailing newline as an empty line', () => {
    const result = diffLines('a\r\nb\r\n', 'a\nb\n')
    expect(result.rows).toHaveLength(3)
    expect(result.counts).toEqual({ same: 3, added: 0, removed: 0, changed: 0 })
  })

  it('uses the exact reduced region for a large file with one insertion', () => {
    const lines = Array.from({ length: 6_000 }, (_, i) => `line ${i}`)
    const right = [...lines.slice(0, 3_000), 'inserted', ...lines.slice(3_000)]
    const result = diffLines(lines.join('\n'), right.join('\n'))
    const insertion = result.rows.find((item) => item.kind === 'added')
    expect(result.approximate).toBe(false)
    expect(result.truncated).toBe(true)
    expect(insertion).toMatchObject({ leftLine: null, rightLine: 3001, right: 'inserted' })
    expect(result.rows.at(-1)).toMatchObject({ leftLine: 6000, rightLine: 6001, kind: 'same' })
  })

  it('uses the large fallback only when the unmatched region exceeds the cell budget', () => {
    const left = Array.from({ length: 1200 }, (_, index) => `left ${index}`).join('\n')
    const right = Array.from({ length: 1200 }, (_, index) => `right ${index}`).join('\n')
    const result = diffLines(left, right)
    expect(result.approximate).toBe(true)
    expect(result.counts.changed).toBe(1200)
  })
})
