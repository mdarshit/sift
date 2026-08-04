/**
 * SQL text transforms: minify (optionally to a single line) and obfuscate.
 * Token-based, so string literals and quoted identifiers are never corrupted.
 */
import { CONTEXTUAL_KEYWORDS, FUNCTIONS, KEYWORDS } from './sqlTokens'
import type { ObfuscationMapping } from '../types'

export type TokenType = 'comment' | 'string' | 'qident' | 'param' | 'word' | 'number' | 'ws' | 'punct'

export interface Token {
  type: TokenType
  text: string
}

// Strings include PostgreSQL dollar-quoting ($$…$$ and $tag$…$tag$) so
// function bodies are treated as literals, never re-tokenized as identifiers.
const TOKEN_RE =
  /(?<comment>--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(?<str>\$(?<dtag>[A-Za-z_]*)\$[\s\S]*?\$\k<dtag>\$|'(?:[^']|'')*'?)|(?<qident>"(?:[^"]|"")*"?|`[^`]*`?|\[[^\]]*\]?)|(?<param>\$\d+|\?\d*|:[A-Za-z_]\w*|@[A-Za-z_]\w*)|(?<word>[A-Za-z_][\w$]*)|(?<number>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)|(?<ws>\s+)|(?<punct>[\s\S])/g

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(sql))) {
    const g = m.groups ?? {}
    const type: TokenType =
      g.comment != null
        ? 'comment'
        : g.str != null
          ? 'string'
          : g.qident != null
            ? 'qident'
            : g.param != null
              ? 'param'
              : g.word != null
                ? 'word'
                : g.number != null
                  ? 'number'
                  : g.ws != null
                    ? 'ws'
                    : 'punct'
    tokens.push({ type, text: m[0] })
  }
  return tokens
}

const NO_SPACE_BEFORE = new Set(['(', ')', ',', ';'])
const NO_SPACE_AFTER = new Set(['(', ','])

/**
 * Remove comments and collapse whitespace. `oneLine` puts the whole script on
 * a single line; otherwise each statement gets its own line.
 */
export function minifySql(sql: string, oneLine = false): string {
  const tokens = tokenize(sql)
  const out: string[] = []
  let pendingSpace = false

  for (const t of tokens) {
    if (t.type === 'comment') {
      if (out.length > 0) pendingSpace = true
      continue
    }
    if (t.type === 'ws') {
      if (out.length > 0) pendingSpace = true
      continue
    }
    const prev = out[out.length - 1] ?? ''
    if (pendingSpace && !NO_SPACE_BEFORE.has(t.text) && !NO_SPACE_AFTER.has(prev) && prev !== '\n') {
      out.push(' ')
    }
    pendingSpace = false
    out.push(t.text)
    if (t.text === ';' && !oneLine) {
      out.push('\n')
      pendingSpace = false
    }
  }
  return out.join('').trim()
}

export interface ObfuscateResult {
  sql: string
  identifiers: number
  strings: number
  mapping: ObfuscationMapping
}

/**
 * Consistently rename identifiers (t1, t2, …) and mask string literals
 * ('s1', 's2', …) so a query's shape can be shared without leaking schema
 * names or data. Keywords, built-in functions, numbers, parameters and
 * structure are preserved; the same input name always maps to the same output.
 */
export function obfuscateSql(sql: string): ObfuscateResult {
  const idMap = new Map<string, string>()
  const strMap = new Map<string, string>()
  const identifierMapping: Record<string, string> = {}
  const stringMapping: Record<string, string> = {}

  const mapIdent = (name: string): string => {
    const key = name.toLowerCase()
    let mapped = idMap.get(key)
    if (!mapped) {
      mapped = `t${idMap.size + 1}`
      idMap.set(key, mapped)
      identifierMapping[mapped] = name
    }
    return mapped
  }

  const tokens = tokenize(sql)
  const significant = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => token.type !== 'ws' && token.type !== 'comment')
  const significantIndex = new Map(significant.map(({ index }, position) => [index, position]))

  const isContextualSyntax = (position: number, word: string): boolean => {
    const previous = significant[position - 1]?.token
    const previousWord = previous?.type === 'word' ? previous.text.toLowerCase() : ''
    const next = significant[position + 1]?.token
    const nextWord = next?.type === 'word' ? next.text.toLowerCase() : ''
    let statementStart = position
    while (statementStart > 0 && significant[statementStart - 1].token.text !== ';') statementStart--
    const statementWords = significant
      .slice(statementStart, position)
      .filter(({ token }) => token.type === 'word')
      .map(({ token }) => token.text.toLowerCase())
    const inCreateFunction = statementWords[0] === 'create' && statementWords.includes('function')

    if (['type', 'schema', 'domain'].includes(word)) {
      return ['create', 'alter', 'drop'].includes(previousWord) || (statementWords[0] === 'comment' && previousWord === 'on')
    }
    if (word === 'comment') return nextWord === 'on'
    if (word === 'owner') return nextWord === 'to'
    if (word === 'rows') {
      return (inCreateFunction && next?.type === 'number') || ['between', 'current', 'unbounded'].includes(nextWord)
    }
    if (word === 'support') return inCreateFunction && (next?.type === 'word' || next?.type === 'qident')
    return false
  }

  const out = tokens.map((t, index) => {
    if (t.type === 'word') {
      const word = t.text.toLowerCase()
      const position = significantIndex.get(index) as number
      const syntax = KEYWORDS.has(word) && (!CONTEXTUAL_KEYWORDS.has(word) || isContextualSyntax(position, word))
      if (!syntax && !FUNCTIONS.has(word)) return mapIdent(t.text)
    }
    if (t.type === 'qident' && t.text.length > 1) {
      // Strip the quoting; generated names never need it.
      return mapIdent(t.text.slice(1, -1))
    }
    if (t.type === 'string') {
      let mapped = strMap.get(t.text)
      if (!mapped) {
        mapped = `'s${strMap.size + 1}'`
        strMap.set(t.text, mapped)
        stringMapping[mapped.slice(1, -1)] = t.text
      }
      return mapped
    }
    return t.text
  })

  return {
    sql: out.join(''),
    identifiers: idMap.size,
    strings: strMap.size,
    mapping: { identifiers: identifierMapping, strings: stringMapping },
  }
}
