/**
 * Zero-dependency code editor: line-number gutter + a transparent <textarea>
 * layered over a syntax-highlighted mirror. Native text editing, instant
 * load; beyond the highlight cap it degrades to plain text but stays fully
 * editable. Gutter, mirror and textarea share identical font metrics.
 */
import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import { KEYWORDS, JS_KEYWORDS } from '../lib/sqlTokens'
import type { Quote } from '../lib/quotes'
import type { Language } from '../types'

export interface EditorHandle {
  /** Selected text, '' when the selection is collapsed. */
  getSelection(): string
  focus(): void
  /** Move the caret to a 0-based character offset and scroll it into view. */
  jumpTo(offset: number, line: number): void
}

// One pass, one regex: comments, strings, numbers, words.
const TOKEN_RE =
  /(--[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^'\\]|\\.|'')*'?|"(?:[^"\\]|\\.)*"?)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)/g

const HIGHLIGHT_LIMIT = 200_000 // chars; beyond this fall back to plain text
export const LINE_HEIGHT_EM = 1.55
const FONT_PX = 13.5
const EDITOR_PAD_PX = 16 // must match the .ed-layer top padding in styles.css
const JUMP_CONTEXT_LINES = 3 // lines of breathing room kept above a jump target

function highlight(text: string, lang: Language): ReactNode[] {
  if (text.length > HIGHLIGHT_LIMIT) return [text]
  const keywords = lang === 'sql' ? KEYWORDS : JS_KEYWORDS
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const [full, comment, str, num, word] = m
    if (comment != null) out.push(<span key={key++} className="tok-com">{full}</span>)
    else if (str != null) out.push(<span key={key++} className="tok-str">{full}</span>)
    else if (num != null) out.push(<span key={key++} className="tok-num">{full}</span>)
    else if (word != null && keywords.has(lang === 'sql' ? word.toLowerCase() : word))
      out.push(<span key={key++} className="tok-kw">{full}</span>)
    else out.push(full)
    last = m.index + full.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function lineColAt(lineStarts: number[], offset: number): { line: number; col: number } {
  let low = 0
  let high = lineStarts.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (lineStarts[mid] <= offset) low = mid + 1
    else high = mid
  }
  const index = Math.max(0, low - 1)
  return { line: index + 1, col: offset - lineStarts[index] + 1 }
}

export const Editor = forwardRef<
  EditorHandle,
  {
    value: string
    onChange: (value: string) => void
    /** Ctrl+Enter - the primary action (Format). */
    onAction: () => void
    language: Language
    /** 1-based line to mark as the current validation error. */
    errorLine?: number
    onCursor?: (line: number, col: number) => void
    /** Shown dead-center while the buffer is empty. */
    emptyState?: Quote
  }
>(function Editor({ value, onChange, onAction, language, errorLine, onCursor, emptyState }, ref) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLPreElement>(null)
  const [tabMovesFocus, setTabMovesFocus] = useState(false)

  useImperativeHandle(ref, () => ({
    getSelection() {
      const ta = taRef.current
      if (!ta || ta.selectionStart === ta.selectionEnd) return ''
      return ta.value.slice(ta.selectionStart, ta.selectionEnd)
    },
    focus() {
      taRef.current?.focus()
    },
    jumpTo(offset: number, line: number) {
      const ta = taRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(offset, offset)
      ta.scrollTop = Math.max(0, EDITOR_PAD_PX + (line - 1 - JUMP_CONTEXT_LINES) * FONT_PX * LINE_HEIGHT_EM)
      syncScroll()
      reportCursor()
    },
  }))

  const tokens = useMemo(() => highlight(value, language), [value, language])

  const lineCount = useMemo(() => {
    let n = 1
    for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 10) n++
    return n
  }, [value])

  const lineStarts = useMemo(() => {
    const starts = [0]
    for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 10) starts.push(i + 1)
    return starts
  }, [value])

  // One string, one text node - cheap even at 100k lines.
  const gutterText = useMemo(() => {
    if (lineCount > 100_000) return '·\n'
    let s = ''
    for (let i = 1; i <= lineCount; i++) s += i + '\n'
    return s
  }, [lineCount])
  const gutterWidth = `calc(${String(lineCount).length}ch + 26px)`

  const syncScroll = () => {
    const ta = taRef.current
    if (!ta) return
    if (mirrorRef.current) {
      mirrorRef.current.scrollTop = ta.scrollTop
      mirrorRef.current.scrollLeft = ta.scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop
  }

  const reportCursor = () => {
    const ta = taRef.current
    if (!ta || !onCursor) return
    const { line, col } = lineColAt(lineStarts, ta.selectionStart)
    onCursor(line, col)
  }

  const toggleComment = (ta: HTMLTextAreaElement) => {
    const prefix = language === 'sql' ? '--' : '//'
    const { selectionStart: s, selectionEnd: end, value: v } = ta
    const lineStart = v.lastIndexOf('\n', s - 1) + 1
    let lineEnd = v.indexOf('\n', end)
    if (lineEnd < 0) lineEnd = v.length
    const lines = v.slice(lineStart, lineEnd).split('\n')
    const allCommented = lines.filter((l) => l.trim()).every((l) => l.trimStart().startsWith(prefix))
    const next = lines
      .map((l) => {
        if (!l.trim()) return l
        return allCommented
          ? l.replace(new RegExp(`^(\\s*)${prefix}\\s?`), '$1')
          : l.replace(/^(\s*)/, `$1${prefix} `)
      })
      .join('\n')
    onChange(v.slice(0, lineStart) + next + v.slice(lineEnd))
    requestAnimationFrame(() => ta.setSelectionRange(lineStart, lineStart + next.length))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey
    if (e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'm') {
      e.preventDefault()
      setTabMovesFocus((value) => !value)
      return
    }
    if (mod && e.key === 'Enter') {
      e.preventDefault()
      onAction()
      return
    }
    if (mod && e.key === '/') {
      e.preventDefault()
      toggleComment(e.currentTarget)
      return
    }
    if (e.key === 'Tab' && !tabMovesFocus) {
      e.preventDefault()
      const ta = e.currentTarget
      const { selectionStart: s, selectionEnd: end } = ta
      const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1
      if (s !== end && ta.value.slice(s, end).includes('\n')) {
        const selected = ta.value.slice(lineStart, end)
        const lines = selected.split('\n')
        const changed = lines.map((line) => (e.shiftKey ? line.replace(/^ {1,2}/, '') : `  ${line}`)).join('\n')
        const delta = changed.length - selected.length
        onChange(ta.value.slice(0, lineStart) + changed + ta.value.slice(end))
        requestAnimationFrame(() => ta.setSelectionRange(lineStart, end + delta))
        return
      }
      if (e.shiftKey) {
        const before = ta.value.slice(lineStart, s)
        const remove = before.match(/^ {1,2}/)?.[0].length ?? 0
        if (!remove) return
        onChange(ta.value.slice(0, lineStart) + ta.value.slice(lineStart + remove))
        requestAnimationFrame(() => ta.setSelectionRange(Math.max(lineStart, s - remove), Math.max(lineStart, end - remove)))
      } else {
        onChange(ta.value.slice(0, s) + '  ' + ta.value.slice(end))
        requestAnimationFrame(() => ta.setSelectionRange(s + 2, s + 2))
      }
    }
  }

  return (
    <div className="flex h-full w-full bg-bg">
      <pre ref={gutterRef} className="ed-gutter" style={{ width: gutterWidth }} aria-hidden="true">
        {gutterText}
      </pre>
      <div className="relative min-w-0 flex-1">
        <pre ref={mirrorRef} className="ed-layer ed-mirror text-ink" aria-hidden="true">
          {errorLine != null && (
            <span className="ed-errline" style={{ top: `calc(16px + ${(errorLine - 1) * LINE_HEIGHT_EM}em)` }} />
          )}
          {tokens}
          {'\n'}
        </pre>
        {value.length === 0 && emptyState && (
          <div className="ed-empty" aria-hidden="true">
            <div className="ed-empty-inner pop">
              <p className="ed-quote">{emptyState.text}</p>
              {emptyState.by && <p className="ed-quote-by">{emptyState.by}</p>}
              <span className="ed-quote-rule" />
              <p className="ed-quote-hint">Paste or start typing — SQL, JSON or JavaScript</p>
            </div>
          </div>
        )}
        <textarea
          ref={taRef}
          className="ed-layer ed-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          onSelect={reportCursor}
          onClick={reportCursor}
          onKeyUp={reportCursor}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          wrap="off"
          aria-label="Code editor"
          aria-describedby="editor-keyboard-hint"
        />
        <span id="editor-keyboard-hint" className="sr-only">
          Press Control M to toggle whether Tab indents code or moves focus.
        </span>
      </div>
    </div>
  )
})
