/// <reference lib="webworker" />
/**
 * All heavy text work happens here so a 50k-line paste never blocks the UI:
 * formatting (sql-formatter), SQL syntax validation (SQLite's real parser),
 * JS validation (acorn), JSON validation, minify and obfuscate. Every parser
 * is a lazy import - nothing loads until the matching action first runs.
 */
import type { Issue, ToolRequest, ToolResponse, ValidateResult } from '../types'
import { formatterLanguage } from '../lib/detect'
import { minifySql, obfuscateSql } from '../lib/transform'
import { analyzeSql } from '../lib/analyze'

function post(msg: ToolResponse) {
  ;(self as unknown as { postMessage: (m: unknown) => void }).postMessage(msg)
}

function issueAt(text: string, offset: number, message: string): Issue {
  const clamped = Math.max(0, Math.min(offset, text.length))
  let line = 1
  let lineStart = 0
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { message, line, col: clamped - lineStart + 1, offset: clamped }
}

// ---------------------------------------------------------------------------
// SQL validation
// ---------------------------------------------------------------------------

import type { Database, SqlJsStatic } from 'sql.js'

let sqlJs: Promise<SqlJsStatic> | null = null
let sdb: Database | null = null

async function sqliteDb(): Promise<Database> {
  if (!sqlJs) {
    sqlJs = (async () => {
      const [{ default: initSqlJs }, wasm] = await Promise.all([
        import('sql.js'),
        import('sql.js/dist/sql-wasm.wasm?url'),
      ])
      return initSqlJs({ locateFile: () => wasm.default })
    })()
  }
  const SQL = await sqlJs
  sdb ??= new SQL.Database()
  return sdb
}

const SYNTAX_RE = /syntax error|unrecognized token|incomplete input/i

/** Index just past the next top-level ';' at/after `from` (quote-aware), or -1. */
function statementEndFrom(sql: string, from: number): number {
  let i = from
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    if (c === "'") {
      i++
      while (i < n && (sql[i] !== "'" || sql[i + 1] === "'")) i += sql[i] === "'" ? 2 : 1
      i++
    } else if (c === '"') {
      i++
      while (i < n && sql[i] !== '"') i++
      i++
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
    } else if (c === ';') {
      return i + 1
    } else {
      i++
    }
  }
  return -1
}

/** Prepare (compile-only, nothing executes); returns the error message or null. */
function tryPrepare(db: Database, sql: string): string | null {
  try {
    db.prepare(sql).free()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Validate SQL with SQLite's parser in ONE linear pass: each statement is
 * sliced out and prepared individually. Name-resolution errors ("no such
 * table") mean the syntax parsed fine and are ignored. A statement that fails
 * with a syntax error is extended across further ';' boundaries a bounded
 * number of times before the error is reported - this accepts compound
 * statements (CREATE TRIGGER ... BEGIN ...; ...; END) whose bodies contain
 * semicolons.
 */
async function validateSqlFull(text: string): Promise<Issue | null> {
  const db = await sqliteDb()
  const n = text.length
  let pos = 0

  while (pos < n) {
    const firstEnd = statementEndFrom(text, pos)
    let end = firstEnd < 0 ? n : firstEnd
    const stmt = text.slice(pos, end)
    if (!stmt.trim()) {
      if (firstEnd < 0) break
      pos = end
      continue
    }

    let err = tryPrepare(db, stmt)
    if (err && SYNTAX_RE.test(err)) {
      const firstErr = err
      // Compound-statement extension: try swallowing up to 25 more ';' chunks.
      let extended = end
      for (let tries = 0; tries < 25 && extended < n; tries++) {
        const nextEnd0 = statementEndFrom(text, extended)
        extended = nextEnd0 < 0 ? n : nextEnd0
        const candidate = tryPrepare(db, text.slice(pos, extended))
        if (!candidate || !SYNTAX_RE.test(candidate)) {
          err = null
          end = extended
          break
        }
        if (nextEnd0 < 0) break
      }
      if (err) {
        // Still a syntax error: report the first, anchored on its token.
        const near = /near "(.+?)"/.exec(firstErr)
        if (near) {
          const idx = text.indexOf(near[1], pos)
          if (idx >= 0 && idx < end + 200) return issueAt(text, idx, firstErr)
        }
        return issueAt(text, pos + (stmt.length - stmt.trimStart().length), firstErr)
      }
    }
    pos = end // firstEnd < 0 implies end === n, so the loop terminates
  }
  return null
}

/**
 * Lexical check for SQL dialects SQLite's parser would false-flag
 * (PostgreSQL casts, MySQL backticks…): unterminated strings/comments and
 * unbalanced parentheses.
 */
function validateSqlLexical(text: string): Issue | null {
  let depth = 0
  let lastOpen = -1
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === "'") {
      const start = i
      i++
      while (i < n && (text[i] !== "'" || text[i + 1] === "'")) i += text[i] === "'" ? 2 : 1
      if (i >= n) return issueAt(text, start, 'Unterminated string literal')
      i++
    } else if (c === '"' || c === '`') {
      const start = i
      const quote = c
      i++
      while (i < n && text[i] !== quote) i++
      if (i >= n) return issueAt(text, start, `Unterminated ${quote === '`' ? 'backtick' : 'quoted'} identifier`)
      i++
    } else if (c === '-' && text[i + 1] === '-') {
      while (i < n && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end < 0) return issueAt(text, i, 'Unterminated block comment')
      i = end + 2
    } else if (c === '$' && /[A-Za-z_$]/.test(text[i + 1] ?? '')) {
      const m = /^\$[A-Za-z_]*\$/.exec(text.slice(i, i + 80))
      if (m) {
        const close = text.indexOf(m[0], i + m[0].length)
        if (close < 0) return issueAt(text, i, 'Unterminated dollar-quoted string')
        i = close + m[0].length
      } else {
        i++
      }
    } else {
      if (c === '(') {
        if (depth === 0) lastOpen = i
        depth++
      } else if (c === ')') {
        depth--
        if (depth < 0) return issueAt(text, i, 'Unmatched closing parenthesis')
      }
      i++
    }
  }
  if (depth > 0) return issueAt(text, lastOpen, `${depth} unclosed parenthes${depth === 1 ? 'is' : 'es'}`)
  return null
}

// ---------------------------------------------------------------------------
// JSON / JS validation
// ---------------------------------------------------------------------------

function validateJson(text: string): Issue | null {
  try {
    JSON.parse(text)
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const lc = /line (\d+) column (\d+)/.exec(msg)
    const pos = /position (\d+)/.exec(msg)
    if (lc) {
      const line = Number(lc[1])
      const col = Number(lc[2])
      const offset = pos ? Number(pos[1]) : 0
      return { message: msg.replace(/ in JSON.*$/, ''), line, col, offset }
    }
    return issueAt(text, pos ? Number(pos[1]) : 0, msg)
  }
}

async function validateJs(text: string): Promise<Issue | null> {
  const acorn = await import('acorn')
  const opts = { ecmaVersion: 'latest', locations: true, allowHashBang: true } as const
  try {
    acorn.parse(text, { ...opts, sourceType: 'module' })
    return null
  } catch {
    try {
      acorn.parse(text, { ...opts, sourceType: 'script', allowReturnOutsideFunction: true })
      return null
    } catch (err) {
      const e = err as { message?: string; loc?: { line: number; column: number }; pos?: number }
      return {
        message: String(e.message ?? err).replace(/ \(\d+:\d+\)$/, ''),
        line: e.loc?.line ?? 1,
        col: (e.loc?.column ?? 0) + 1,
        offset: e.pos ?? 0,
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function validate(req: Extract<ToolRequest, { action: 'validate' }>): Promise<ValidateResult> {
  if (req.lang === 'json') return { issue: validateJson(req.text), depth: 'full' }
  if (req.lang === 'js') return { issue: await validateJs(req.text), depth: 'full' }
  // SQLite's parser rejects other dialects' operators, so full parsing is
  // only honest for SQLite/standard SQL; the rest get a lexical pass.
  if (req.dialect === 'sqlite' || req.dialect === 'sql') {
    return { issue: await validateSqlFull(req.text), depth: 'full' }
  }
  return { issue: validateSqlLexical(req.text), depth: 'lexical' }
}

async function format(req: Extract<ToolRequest, { action: 'format' }>): Promise<string> {
  if (req.lang === 'json') return JSON.stringify(JSON.parse(req.text), null, 2)
  if (req.lang === 'js') {
    // Prettier's browser build + its babel parser and estree printer, loaded on
    // first JS format only — kept out of the main bundle like every other parser.
    const [prettier, babel, estree] = await Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
    ])
    return prettier.format(req.text, {
      parser: 'babel',
      plugins: [babel, estree],
      tabWidth: 2,
    })
  }
  const { format } = await import('sql-formatter')
  return format(req.text, {
    language: formatterLanguage(req.dialect) as 'sql',
    keywordCase: 'upper',
    tabWidth: 2,
  })
}

function minify(req: Extract<ToolRequest, { action: 'minify' }>): string {
  if (req.lang === 'json') return JSON.stringify(JSON.parse(req.text))
  return minifySql(req.text, true)
}

self.onmessage = async (e: MessageEvent<ToolRequest>) => {
  const req = e.data
  try {
    switch (req.action) {
      case 'validate':
        post({ id: req.id, action: req.action, ok: true, validate: await validate(req) })
        break
      case 'format':
        post({ id: req.id, action: req.action, ok: true, result: await format(req) })
        break
      case 'minify':
        post({ id: req.id, action: req.action, ok: true, result: minify(req) })
        break
      case 'obfuscate': {
        const r = obfuscateSql(req.text)
        post({
          id: req.id,
          action: req.action,
          ok: true,
          result: r.sql,
          counts: { identifiers: r.identifiers, strings: r.strings },
          mapping: r.mapping,
        })
        break
      }
      case 'analyze':
        post({ id: req.id, action: req.action, ok: true, analyze: analyzeSql(req.text) })
        break
    }
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
