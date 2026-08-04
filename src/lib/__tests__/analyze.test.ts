import { describe, expect, it } from 'vitest'
import { analyzeSql } from '../analyze'

describe('analyzeSql outline', () => {
  it('identifies statement kinds and targets', () => {
    const r = analyzeSql(`
SELECT a FROM orders;
INSERT INTO users (id, name) VALUES (1, 'x');
UPDATE accounts SET x = 1;
DELETE FROM logs;
CREATE TABLE archive (id int);`)
    expect(r.outline.map((n) => n.label)).toEqual([
      'SELECT … FROM orders',
      'INSERT INTO users (2 cols)',
      'UPDATE accounts',
      'DELETE FROM logs',
      'CREATE TABLE archive',
    ])
    expect(r.truncated).toBe(false)
  })

  it('counts INSERT columns through nested parens', () => {
    const r = analyzeSql(`INSERT INTO t (a, b, fn(c, d), e) SELECT 1;`)
    expect(r.outline[0].label).toBe('INSERT INTO t (4 cols)')
  })

  it('records line and offset for jumping', () => {
    const r = analyzeSql(`SELECT 1;\nSELECT b FROM t2;`)
    expect(r.outline[1].line).toBe(2)
    expect(r.outline[1].offset).toBe(10)
  })

  it('groups consecutive similar statements with a count', () => {
    const stmts = Array.from({ length: 5 }, (_, i) => `INSERT INTO t1 (a, b) VALUES (${i}, ${i});`).join('\n')
    const r = analyzeSql(stmts + '\nINSERT INTO other (a) VALUES (1);')
    expect(r.outline).toHaveLength(2)
    expect(r.outline[0].kind).toBe('group')
    expect(r.outline[0].count).toBe(5)
    expect(r.outline[0].label).toBe('INSERT INTO t1 (2 cols) — 5 statements')
    expect(r.outline[0].children).toHaveLength(5)
    expect(r.outline[1].label).toBe('INSERT INTO other (1 cols)')
  })

  it('does not group statements with different targets', () => {
    const r = analyzeSql(`INSERT INTO a VALUES (1); INSERT INTO b VALUES (2);`)
    expect(r.outline).toHaveLength(2)
    expect(r.outline.every((n) => n.kind === 'statement')).toBe(true)
  })

  it('caps group children and flags truncation', () => {
    const stmts = Array.from({ length: 250 }, () => `INSERT INTO big VALUES (1);`).join('\n')
    const r = analyzeSql(stmts)
    expect(r.outline[0].count).toBe(250)
    expect(r.outline[0].children).toHaveLength(201) // 200 + "… more" leaf
    expect(r.outline[0].children![200].label).toContain('50 more')
    expect(r.truncated).toBe(true)
  })

  it('nests CTEs and subqueries under their statement', () => {
    const r = analyzeSql(`
WITH recent AS (SELECT * FROM orders), tops AS (SELECT * FROM recent)
SELECT * FROM tops WHERE id IN (SELECT id FROM vips);`)
    const stmt = r.outline[0]
    expect(stmt.kind).toBe('statement')
    const labels = stmt.children!.map((c) => c.label)
    expect(labels).toContain('CTE recent')
    expect(labels).toContain('CTE tops')
    expect(labels).toContain('SELECT (subquery)')
  })

  it('handles quoted identifiers', () => {
    const r = analyzeSql(`INSERT INTO "Order Items" (a) VALUES (1); SELECT x FROM \`weird table\`;`)
    expect(r.outline[0].label).toBe('INSERT INTO Order Items (1 cols)')
    expect(r.outline[1].label).toBe('SELECT … FROM weird table')
  })
})

describe('analyzeSql graph', () => {
  it('builds data-flow edges from sources to targets', () => {
    const r = analyzeSql(`INSERT INTO archive SELECT * FROM orders o JOIN customers c ON c.id = o.cid;`)
    const ids = r.graph.nodes.map((n) => n.id).sort()
    expect(ids).toEqual(['archive', 'customers', 'orders'])
    expect(r.graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'orders', to: 'archive' },
        { from: 'customers', to: 'archive' },
      ]),
    )
  })

  it('routes CTE-body reads into the CTE node and CTE reads into the consumer', () => {
    const r = analyzeSql(`WITH recent AS (SELECT * FROM orders) SELECT * FROM recent;`)
    const cte = r.graph.nodes.find((n) => n.id === '#cte-1-recent')
    expect(cte?.kind).toBe('cte')
    expect(r.graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'orders', to: '#cte-1-recent' },
        { from: '#cte-1-recent', to: '#select-1' },
      ]),
    )
  })

  it('keeps CTEs distinct from same-named tables', () => {
    const r = analyzeSql(`WITH items AS (SELECT * FROM source) INSERT INTO items SELECT * FROM items;`)
    expect(r.graph.nodes.map((n) => [n.id, n.kind])).toEqual(
      expect.arrayContaining([
        ['items', 'table'],
        ['#cte-1-items', 'cte'],
      ]),
    )
    expect(r.graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'source', to: '#cte-1-items' },
        { from: '#cte-1-items', to: 'items' },
      ]),
    )
  })

  it('scopes repeated CTE names to their statements', () => {
    const r = analyzeSql(`WITH x AS (SELECT * FROM a) SELECT * FROM x; WITH x AS (SELECT * FROM b) SELECT * FROM x;`)
    expect(r.graph.nodes.filter((n) => n.kind === 'cte').map((n) => n.id)).toEqual(['#cte-1-x', '#cte-2-x'])
    expect(r.graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'a', to: '#cte-1-x' },
        { from: 'b', to: '#cte-2-x' },
      ]),
    )
  })

  it('dedupes table nodes across statements', () => {
    const r = analyzeSql(`INSERT INTO t SELECT * FROM src; INSERT INTO t SELECT * FROM src;`)
    expect(r.graph.nodes.filter((n) => n.id === 'src')).toHaveLength(1)
    expect(r.graph.nodes.filter((n) => n.id === 't')).toHaveLength(1)
    expect(r.graph.edges).toEqual([{ from: 'src', to: 't' }])
  })

  it('handles comma-separated FROM lists', () => {
    const r = analyzeSql(`SELECT * FROM a, b WHERE a.id = b.id;`)
    const ids = r.graph.nodes.map((n) => n.id)
    expect(ids).toContain('a')
    expect(ids).toContain('b')
  })

  it('recognizes contextual words as table names and write targets', () => {
    const r = analyzeSql(
      'SELECT * FROM type JOIN owner ON type.id = owner.id; INSERT INTO comment SELECT * FROM schema; UPDATE domain SET x = 1;'
    )

    expect(r.outline.map((node) => node.label)).toEqual([
      'SELECT … FROM type',
      'INSERT INTO comment',
      'UPDATE domain',
    ])
    expect(r.graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['type', 'owner', 'comment', 'schema', 'domain']),
    )
    expect(r.graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'owner', to: '#select-1' },
        { from: 'schema', to: 'comment' },
      ]),
    )
  })

  it('caps graph nodes and flags truncation', () => {
    const stmts = Array.from({ length: 100 }, (_, i) => `INSERT INTO table_${i} VALUES (1);`).join('\n')
    const r = analyzeSql(stmts)
    expect(r.graph.nodes).toHaveLength(80)
    expect(r.truncated).toBe(true)
  })

  it('anchors read nodes at the reference, not the statement start', () => {
    const r = analyzeSql(`INSERT INTO t (a)\nSELECT a\nFROM src;`)
    const src = r.graph.nodes.find((n) => n.id === 'src')
    expect(src?.line).toBe(3)
    expect(src?.offset).toBe(`INSERT INTO t (a)\nSELECT a\nFROM `.length)
  })

  it('empty input produces an empty result', () => {
    const r = analyzeSql('')
    expect(r.outline).toEqual([])
    expect(r.graph.nodes).toEqual([])
    expect(r.truncated).toBe(false)
  })
})
