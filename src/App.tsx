import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnalyzeResult, Issue, Language, ObfuscationMapping, SqlDialect, ValidationDepth } from './types'
import { tools } from './lib/toolsClient'
import { detect, DIALECT_LABELS, LANG_LABELS } from './lib/detect'
import { Editor, type EditorHandle } from './components/Editor'
import { GraphDialog, StructurePanel } from './components/StructurePanel'
import { CompareView } from './components/CompareView'
import { JsonTreeDialog } from './components/JsonTreeDialog'
import { randomQuote } from './lib/quotes'
import { supportsTransform } from './lib/capabilities'
import { Icon, ShortcutsDialog, Spinner, useMenu, type MenuItem, type Shortcut } from './components/ui'

type Theme = 'dark' | 'light'

/** Accent choices (reference-style picker). Dark themes get the lighter cut. */
const ACCENTS = [
  { id: 'violet', dark: '#8f7ff7', light: '#6d4fe2' },
  { id: 'blue', dark: '#5eb2f6', light: '#1d76d2' },
  { id: 'green', dark: '#4cc38a', light: '#17803d' },
  { id: 'orange', dark: '#f5a15c', light: '#c2570e' },
  { id: 'pink', dark: '#f27bb1', light: '#d0246e' },
  { id: 'gray', dark: '#a1a1aa', light: '#52525e' },
] as const
type AccentId = (typeof ACCENTS)[number]['id']

const DIALECTS: SqlDialect[] = ['sql', 'sqlite', 'postgresql', 'mysql', 'plsql', 'tsql']


type Validation =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; depth: ValidationDepth }
  | { state: 'issue'; issue: Issue }

interface Toast {
  id: number
  kind: 'info' | 'error'
  text: string
  actions?: ToastAction[]
}

interface ToastAction {
  label: string
  onClick: () => void
}

interface TransformSnapshot {
  id: number
  before: string
  after: string
}
let toastSeq = 1
let transformSeq = 1

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function downloadObfuscationMap(mapping: ObfuscationMapping) {
  const payload = {
    format: 'sift-obfuscation-map',
    version: 1,
    createdAt: new Date().toISOString(),
    warning: 'Keep this file private: it contains the original identifiers and string literals.',
    ...mapping,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = `sift-obfuscation-map-${payload.createdAt.replace(/[:.]/g, '-')}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}

/** Persist the buffer unless it is too large for localStorage. */
function saveText(text: string) {
  try {
    if (text.length < 2_000_000) localStorage.setItem('sift:text', text)
  } catch {
    /* quota - the buffer simply won't survive a reload */
  }
}

function loadTheme(): Theme {
  const stored = localStorage.getItem('sift:theme') ?? ''
  if (stored.includes('light')) return 'light'
  return 'dark'
}

export default function App() {
  const [text, setText] = useState(() => localStorage.getItem('sift:text') ?? '')
  const [emptyQuote] = useState(randomQuote)
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [accent, setAccent] = useState<AccentId>(
    () => (localStorage.getItem('sift:accent') as AccentId) ?? 'violet',
  )
  const [langOverride, setLangOverride] = useState<Language | null>(null)
  const [dialectOverride, setDialectOverride] = useState<SqlDialect | null>(null)
  const [validation, setValidation] = useState<Validation>({ state: 'idle' })
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [busy, setBusy] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [showHelp, setShowHelp] = useState(false)
  const [showStructure, setShowStructure] = useState(false)
  const [showGraph, setShowGraph] = useState(false)
  const [mode, setMode] = useState<'editor' | 'compare'>('editor')
  const [structure, setStructure] = useState<AnalyzeResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const editorRef = useRef<EditorHandle>(null)
  const textRef = useRef(text)
  const transformHistory = useRef<TransformSnapshot[]>([])
  const menu = useMenu()

  textRef.current = text

  const detected = useMemo(() => detect(text), [text])
  const lang: Language = langOverride ?? detected.lang
  const dialect: SqlDialect = lang === 'sql' ? (dialectOverride ?? detected.dialect) : 'sql'

  const toast = useCallback((msg: string, kind: Toast['kind'] = 'info', actions?: ToastAction[]) => {
    const id = toastSeq++
    setToasts((t) => [...t, { id, kind, text: msg, actions }])
    const lifetime = actions?.length ? 15_000 : kind === 'error' ? 5000 : 2600
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), lifetime)
  }, [])

  const rememberTransform = useCallback((before: string, after: string): TransformSnapshot | null => {
    if (before === after) return null
    const snapshot = { id: transformSeq++, before, after }
    transformHistory.current = [...transformHistory.current, snapshot].slice(-3)
    textRef.current = after
    setText(after)
    return snapshot
  }, [])

  const undoTransform = useCallback(
    (snapshotId?: number): boolean => {
      const history = transformHistory.current
      const index = snapshotId == null ? history.length - 1 : history.findIndex((x) => x.id === snapshotId)
      if (index < 0) return false
      const snapshot = history[index]
      if (textRef.current !== snapshot.after) return false

      transformHistory.current = history.slice(0, index)
      textRef.current = snapshot.before
      setText(snapshot.before)
      toast('Transform undone')
      window.requestAnimationFrame(() => editorRef.current?.focus())
      return true
    },
    [toast],
  )

  const undoAction = useCallback(
    (snapshot: TransformSnapshot): ToastAction => ({
      label: 'Undo',
      onClick: () => {
        if (!undoTransform(snapshot.id)) toast('Undo unavailable — the buffer changed', 'error')
      },
    }),
    [toast, undoTransform],
  )

  const handleEditorChange = useCallback((next: string) => {
    transformHistory.current = []
    textRef.current = next
    setText(next)
  }, [])

  // Theme + accent are applied as root attributes / CSS variables.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('sift:theme', theme)
    const a = ACCENTS.find((x) => x.id === accent) ?? ACCENTS[0]
    document.documentElement.style.setProperty('--accent', theme === 'dark' ? a.dark : a.light)
    localStorage.setItem('sift:accent', accent)
  }, [theme, accent])

  useEffect(() => {
    const t = window.setTimeout(() => saveText(text), 500)
    return () => clearTimeout(t)
  }, [text])
  useEffect(() => {
    editorRef.current?.focus()
  }, [])

  // Live validation, debounced. A sequence counter drops stale results.
  const validateSeq = useRef(0)
  useEffect(() => {
    if (!text.trim()) {
      setValidation({ state: 'idle' })
      return
    }
    const seq = ++validateSeq.current
    const t = window.setTimeout(async () => {
      setValidation({ state: 'checking' })
      try {
        const r = await tools.validate(lang, dialect, text)
        if (validateSeq.current !== seq) return
        setValidation(r.issue ? { state: 'issue', issue: r.issue } : { state: 'ok', depth: r.depth })
      } catch (err) {
        if (validateSeq.current !== seq) return
        setValidation({
          state: 'issue',
          issue: { message: err instanceof Error ? err.message : String(err), line: 1, col: 1, offset: 0 },
        })
      }
    }, 500)
    return () => clearTimeout(t)
  }, [text, lang, dialect])

  // Structure analysis, debounced, only while a structure view is open on a SQL buffer.
  const structureOpen = showStructure || showGraph
  const analyzeSeq = useRef(0)
  useEffect(() => {
    if (!structureOpen || lang !== 'sql' || !text.trim()) {
      setStructure(null)
      setAnalyzing(false)
      return
    }
    const seq = ++analyzeSeq.current
    setAnalyzing(true)
    const t = window.setTimeout(async () => {
      try {
        const r = await tools.analyze(text)
        if (analyzeSeq.current !== seq) return
        setStructure(r)
      } catch {
        if (analyzeSeq.current === seq) setStructure(null)
      } finally {
        if (analyzeSeq.current === seq) setAnalyzing(false)
      }
    }, 500)
    return () => clearTimeout(t)
  }, [structureOpen, lang, text])

  const transform = useCallback(
    async (kind: 'format' | 'minify' | 'obfuscate') => {
      if (busy || !text.trim()) return
      // Language guard — the buttons are disabled for unsupported transforms, but
      // Ctrl+Enter and the keyboard shortcuts reach here directly, so the same
      // check must live here too or a shortcut could mangle the buffer.
      if (!supportsTransform(kind, lang)) return
      setBusy(true)
      try {
        if (kind === 'format') {
          const snapshot = rememberTransform(text, await tools.format(lang, dialect, text))
          toast(snapshot ? 'Formatted' : 'Already formatted', 'info', snapshot ? [undoAction(snapshot)] : undefined)
        } else if (kind === 'minify') {
          const snapshot = rememberTransform(text, await tools.minify(lang, text))
          toast(snapshot ? 'Minified' : 'Already minified', 'info', snapshot ? [undoAction(snapshot)] : undefined)
        } else {
          const r = await tools.obfuscate(text)
          const snapshot = rememberTransform(text, r.result)
          const actions: ToastAction[] = []
          if (snapshot) actions.push(undoAction(snapshot))
          if (r.identifiers + r.strings > 0) {
            actions.push({ label: 'Download map', onClick: () => downloadObfuscationMap(r.mapping) })
          }
          toast(
            `Obfuscated ${r.identifiers} identifier${r.identifiers === 1 ? '' : 's'}, ${r.strings} string${r.strings === 1 ? '' : 's'}`,
            'info',
            actions,
          )
        }
      } catch (err) {
        const label = kind === 'format' ? 'Format' : kind === 'minify' ? 'Minify' : 'Obfuscate'
        // First line only — Prettier/parse errors carry a multi-line code frame
        // that has no business unfurling inside a toast.
        const detail = (err instanceof Error ? err.message : String(err)).split('\n')[0]
        toast(`${label} failed: ${detail}`, 'error')
      } finally {
        setBusy(false)
      }
    },
    [busy, text, lang, dialect, rememberTransform, toast, undoAction],
  )

  const copyAll = useCallback(async () => {
    toast((await copyToClipboard(text)) ? 'Copied' : 'Clipboard unavailable', 'info')
  }, [text, toast])

  // Global shortcuts. The editor owns mod+Enter / mod+/ / Tab; these are the rest.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !typing) {
        e.preventDefault()
        setShowHelp((v) => !v)
        return
      }
      if (showHelp || showGraph) return // a modal is open; it owns the keyboard
      if (
        el instanceof HTMLTextAreaElement &&
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'z' &&
        undoTransform()
      ) {
        e.preventDefault()
        return
      }
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return
      const k = e.key.toLowerCase()
      if (k === 'm') {
        e.preventDefault()
        void transform('minify')
      } else if (k === 'o') {
        e.preventDefault()
        void transform('obfuscate')
      } else if (k === 'l') {
        e.preventDefault()
        setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
      } else if (k === 'g' && lang !== 'js') {
        e.preventDefault()
        setShowGraph((v) => !v)
      } else if (k === 'd') {
        e.preventDefault()
        setMode((v) => (v === 'editor' ? 'compare' : 'editor'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [transform, showHelp, showGraph, undoTransform, lang])

  const isMac = useMemo(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
    const platform = nav.userAgentData?.platform || navigator.platform || navigator.userAgent
    return /mac|iphone|ipad/i.test(platform)
  }, [])
  const shortcuts = useMemo<Shortcut[]>(() => {
    const mod = isMac ? '⌘' : 'Ctrl'
    const shift = isMac ? '⇧' : 'Shift'
    return [
      { keys: [mod, 'Enter'], label: 'Format' },
      { keys: [mod, shift, 'M'], label: 'Minify' },
      { keys: [mod, shift, 'O'], label: 'Obfuscate' },
      { keys: [mod, '/'], label: 'Toggle line comment' },
      { keys: ['Tab'], label: 'Indent' },
      { keys: [mod, shift, 'G'], label: 'Graph / JSON tree' },
      { keys: [mod, shift, 'D'], label: 'Compare mode' },
      { keys: [mod, shift, 'L'], label: 'Toggle theme' },
      { keys: [mod, 'Z'], label: 'Undo latest transform' },
      { keys: ['?'], label: 'This help' },
    ]
  }, [isMac])

  const loadFile = useCallback(
    async (file: File) => {
      if (file.size > 8_000_000) {
        toast('File too large (8 MB max)', 'error')
        return
      }
      handleEditorChange(await file.text())
      setLangOverride(null)
      setDialectOverride(null)
    },
    [handleEditorChange, toast],
  )

  const langMenuItems = (): MenuItem[] => {
    const items: MenuItem[] = [
      {
        label: (langOverride === null ? '● ' : '  ') + `Auto (${LANG_LABELS[detected.lang]})`,
        onClick: () => setLangOverride(null),
      },
      ...(['sql', 'json', 'js'] as Language[]).map((l) => ({
        label: (langOverride === l ? '● ' : '  ') + LANG_LABELS[l],
        onClick: () => setLangOverride(l),
      })),
    ]
    if (lang === 'sql') {
      items.push(
        {
          label: (dialectOverride === null ? '● ' : '  ') + `Auto dialect (${DIALECT_LABELS[detected.dialect]})`,
          separatorAbove: true,
          onClick: () => setDialectOverride(null),
        },
        ...DIALECTS.map((d) => ({
          label: (dialectOverride === d ? '● ' : '  ') + DIALECT_LABELS[d],
          onClick: () => setDialectOverride(d),
        })),
      )
    }
    return items
  }

  const chipLabel = lang === 'sql' ? `SQL · ${DIALECT_LABELS[dialect]}` : LANG_LABELS[lang]
  const lines = useMemo(() => (text ? text.split('\n').length : 0), [text])
  const errorLine = validation.state === 'issue' ? validation.issue.line : undefined

  const canMinify = supportsTransform('minify', lang)
  const canObfuscate = supportsTransform('obfuscate', lang)

  // Header controls that don't fit a phone screen, offered via the ⋯ menu.
  const overflowItems = (): MenuItem[] => [
    { label: (mode === 'compare' ? '● ' : '  ') + 'Compare mode', onClick: () => setMode((v) => (v === 'editor' ? 'compare' : 'editor')) },
    ...(lang !== 'js' ? [{ label: lang === 'json' ? 'JSON tree' : 'Query graph', onClick: () => setShowGraph(true) }] : []),
    { label: 'Copy buffer', onClick: () => void copyAll() },
    { label: (showStructure ? '● ' : '  ') + 'Outline panel', onClick: () => setShowStructure((v) => !v) },
    { label: theme === 'dark' ? 'Light theme' : 'Dark theme', onClick: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
  ]

  return (
    <div
      className="flex h-full flex-col p-3 md:p-5"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length > 0) {
          e.preventDefault()
          void loadFile(e.dataTransfer.files[0])
        }
      }}
    >
      {/* The tool is one card on the page. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-[var(--shadow)]">
        {/* Header */}
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
          <div className="mr-2 flex select-none items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white">
              <img src={`${import.meta.env.BASE_URL}sift-logo.svg`} alt="" width="16" height="16" />
            </span>
            <h1 className="font-mono text-[13px] font-semibold tracking-tight sr-only sm:not-sr-only">Sift</h1>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => void transform('format')}
            disabled={busy || !supportsTransform('format', lang)}
            title="Format (Ctrl+Enter)"
          >
            {busy ? <Spinner size={13} /> : <Icon name="braces" size={13} />}
            Format
          </button>
          <button
            className="btn"
            onClick={() => void transform('minify')}
            disabled={busy || !canMinify}
            title={canMinify ? 'Strip comments and whitespace, one line (Ctrl+Shift+M)' : 'JavaScript: format only, no minify'}
          >
            <Icon name="shrink" size={13} />
            <span className="hidden sm:inline">Minify</span>
          </button>
          <button
            className="btn"
            onClick={() => void transform('obfuscate')}
            disabled={busy || !canObfuscate}
            title={canObfuscate ? 'Rename identifiers, mask strings - share a query without leaking schema or data (Ctrl+Shift+O)' : 'SQL only'}
          >
            <Icon name="mask" size={13} />
            <span className="hidden sm:inline">Obfuscate</span>
          </button>
          <button
            className={mode === 'compare' ? 'btn btn-primary' : 'btn'}
            onClick={() => setMode((v) => (v === 'editor' ? 'compare' : 'editor'))}
            title="Compare two buffers (Ctrl+Shift+D)"
          >
            <Icon name="compare" size={13} />
            <span className="hidden sm:inline">Compare</span>
          </button>
          {/* Graph stays with the transforms on desktop; on phones it moves into
              the ⋯ menu. Wrapped in a plain element because the unlayered .btn
              display rule would otherwise beat the `hidden` utility. */}
          <div className="hidden shrink-0 sm:flex">
            <button
              className="btn"
              onClick={() => setShowGraph(true)}
              disabled={lang === 'js'}
              title={lang === 'json' ? 'JSON tree (Ctrl+Shift+G)' : lang === 'sql' ? 'Table/CTE dependency graph (Ctrl+Shift+G)' : 'SQL/JSON only'}
            >
              <Icon name="graph" size={13} />
              {lang === 'json' ? 'Tree' : 'Graph'}
            </button>
          </div>
          <div className="flex-1" />
          {/* Utility cluster: icons from sm+, accent swatches only once there's
              real room for them (lg+); all collapse into the ⋯ menu on phones. */}
          <div className="hidden items-center gap-1 sm:flex">
            <div className="hidden items-center gap-0.5 lg:flex" role="group" aria-label="Accent color">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  className="swatch"
                  aria-pressed={accent === a.id}
                  aria-label={`${a.id} accent`}
                  title={a.id}
                  onClick={() => setAccent(a.id)}
                >
                  <span style={{ background: theme === 'dark' ? a.dark : a.light }} />
                </button>
              ))}
            </div>
            <div className="mx-1 hidden h-5 w-px bg-border lg:block" />
            <button className="icon-btn" onClick={() => void copyAll()} title="Copy buffer" aria-label="Copy buffer">
              <Icon name="copy" size={14} />
            </button>
            <button
              className="icon-btn"
              onClick={() => setShowStructure((v) => !v)}
              title="Toggle outline panel"
              aria-label="Toggle structure panel"
              aria-pressed={showStructure}
            >
              <Icon name="structure" size={14} />
            </button>
            <button
              className="icon-btn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
              aria-label="Toggle theme"
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
            </button>
            <button
              className="icon-btn"
              onClick={() => setShowHelp(true)}
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
            >
              <Icon name="keyboard" size={15} />
            </button>
          </div>
          {/* Mobile-only overflow: the controls that don't fit a phone header. */}
          <div className="flex sm:hidden">
            <button
              className="icon-btn"
              onClick={(e) => menu.openFor(e, overflowItems())}
              title="More actions"
              aria-label="More actions"
            >
              <Icon name="more" size={16} />
            </button>
          </div>
        </header>

        {/* Editor / compare workspace */}
        {mode === 'compare' ? (
          <CompareView seedText={text} onExit={() => setMode('editor')} />
        ) : (
          <div className="relative flex min-h-0 flex-1">
            <div className="min-w-0 flex-1">
              <Editor
                ref={editorRef}
                value={text}
                onChange={handleEditorChange}
                onAction={() => void transform('format')}
                language={lang}
                errorLine={errorLine}
                onCursor={(line, col) => setCursor({ line, col })}
                emptyState={emptyQuote}
              />
            </div>
            {showStructure && (
              <StructurePanel
                result={structure}
                loading={analyzing}
                sqlActive={lang === 'sql'}
                onJump={(offset, line) => editorRef.current?.jumpTo(offset, line)}
                onClose={() => setShowStructure(false)}
              />
            )}
          </div>
        )}
        {/* Status bar */}
        <footer className="flex h-9 shrink-0 items-center gap-4 border-t border-border px-3 font-mono text-[11px] text-dim select-none">
          <button
            className="btn h-6 gap-1 rounded-lg border border-border bg-panel2 px-2 font-mono text-[11px]"
            onClick={(e) => menu.openFor(e, langMenuItems())}
            title="Detected language - click to override"
          >
            {chipLabel}
            <Icon name="chevronDown" size={9} className="text-faint" />
          </button>
          {validation.state === 'issue' && (
            <button
              className="max-w-[46vw] overflow-hidden text-ellipsis whitespace-nowrap text-danger hover:underline"
              onClick={() => editorRef.current?.jumpTo(validation.issue.offset, validation.issue.line)}
              title="Jump to error"
            >
              ✗ Ln {validation.issue.line}, Col {validation.issue.col} — {validation.issue.message}
            </button>
          )}
          <div className="flex-1" />
          <span className="tabular-nums">
            Ln {cursor.line}, Col {cursor.col}
          </span>
          <span className="tabular-nums">{lines.toLocaleString()} lines</span>
          {validation.state === 'ok' && (
            <span className="flex items-center gap-1.5 text-ok" role="status" title={validation.depth === 'lexical' ? `Structure check - full parsing covers SQLite/standard SQL only` : undefined}>
              <span className="inline-block h-2 w-2 rounded-full bg-ok" />
              Valid{validation.depth === 'lexical' ? '*' : ''}
            </span>
          )}
          {validation.state === 'checking' && (
            <span className="flex items-center gap-1.5" role="status">
              <span className="pulse inline-block h-2 w-2 rounded-full bg-warn" />
              Checking
            </span>
          )}
          {validation.state === 'issue' && (
            <span className="flex items-center gap-1.5 text-danger" role="status">
              <span className="inline-block h-2 w-2 rounded-full bg-danger" />
              Invalid
            </span>
          )}
          {validation.state === 'idle' && (
            <span className="flex items-center gap-1.5" role="status">
              <span className="inline-block h-2 w-2 rounded-full bg-faint" />
              Ready
            </span>
          )}
        </footer>
      </div>

      {/* Toasts */}
      {toasts.length > 0 && (
        <div
          className="pointer-events-none fixed bottom-10 left-3 right-3 z-50 flex flex-col items-end gap-2 sm:left-auto sm:right-5"
          role="status"
          aria-live="polite"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pop pointer-events-auto flex w-full max-w-96 flex-col gap-2 rounded-lg border bg-panel px-3 py-2 text-[13px] shadow-[var(--shadow)] sm:w-auto sm:flex-row sm:items-center ${
                t.kind === 'error' ? 'border-danger/40 text-danger' : 'border-border text-ink'
              }`}
            >
              <span className="line-clamp-4 break-words">{t.text}</span>
              {t.actions && t.actions.length > 0 && (
                <span className="inline-flex gap-1.5 self-end sm:ml-3">
                  {t.actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      className="min-h-10 rounded-md border border-border bg-panel2 px-2 py-1 text-[12px] font-medium text-ink transition-colors hover:bg-hover sm:min-h-0"
                      onClick={() => {
                        setToasts((items) => items.filter((item) => item.id !== t.id))
                        action.onClick()
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {menu.element}
      {showHelp && <ShortcutsDialog shortcuts={shortcuts} onClose={() => setShowHelp(false)} />}
      {showGraph && lang === 'sql' && (
        <GraphDialog
          result={structure}
          loading={analyzing}
          sqlActive
          onJump={(offset, line) => editorRef.current?.jumpTo(offset, line)}
          onClose={() => setShowGraph(false)}
        />
      )}
      {showGraph && lang === 'json' && <JsonTreeDialog text={text} onClose={() => setShowGraph(false)} />}
    </div>
  )
}
