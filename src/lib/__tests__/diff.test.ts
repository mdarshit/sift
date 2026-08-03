import { describe, expect, it } from 'vitest'
import { diffLines } from '../diff'

describe('diffLines', () => {
  it('reports identical input as unchanged', () => {
    const r = diffLines('a\nb', 'a\nb')
    expect(r.counts.same).toBe(2)
    expect(r.counts.added + r.counts.removed + r.counts.changed).toBe(0)
  })

  it('pairs adjacent remove/add runs as changed rows', () => {
    const r = diffLines('select 1;\nfrom old;', 'select 1;\nfrom new;')
    expect(r.rows.map((row) => row.kind)).toEqual(['same', 'changed'])
    expect(r.rows[1]).toMatchObject({ leftLine: 2, rightLine: 2, left: 'from old;', right: 'from new;' })
  })

  it('keeps insertions and removals anchored to the correct side', () => {
    const r = diffLines('a\nb\nd', 'a\nb\nc\nd')
    expect(r.rows.map((row) => row.kind)).toEqual(['same', 'same', 'added', 'same'])
    expect(r.rows[2]).toMatchObject({ leftLine: null, rightLine: 3, right: 'c' })
  })
})