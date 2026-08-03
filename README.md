# Sift

**Format, minify, obfuscate and validate SQL, JSON and JavaScript — locally.**
One editor, no server. Nothing you paste ever leaves your browser.

### ▶ [Try it live — mdarshit.github.io/sift](https://mdarshit.github.io/sift/)

```
Paste code → it validates as you type → Format / Minify / Obfuscate / Graph.
```

## What it does

| | SQL | JSON | JavaScript |
| --- | :-: | :-: | :-: |
| Live syntax validation (line + column, click to jump) | ✅ | ✅ | ✅ |
| Format | ✅ | ✅ | ✅ |
| Minify (comments + whitespace stripped, one line) | ✅ | ✅ | — |
| Obfuscate (rename identifiers, mask strings) | ✅ | — | — |

- **Language is auto-detected** as you type (override via the chip in the header),
  including the SQL dialect: Standard, SQLite, PostgreSQL, MySQL, PL/SQL, T-SQL.
- **SQL validation uses a real parser** (SQLite's, compiled to WASM, compile-only —
  nothing executes). Name-resolution errors are ignored — only true syntax errors are
  reported, so you don't need the tables to exist. For non-SQLite dialects the checker
  is lexical (unterminated strings/comments, unbalanced parentheses) and says so.
- **JavaScript validation uses acorn** (the parser inside webpack/Rollup); ES modules
  and scripts both parse. **JSON** uses the native parser with exact positions.
- **Obfuscation** consistently renames every table/column/alias (`t1, t2, …`) and masks
  string literals (`'s1', …`) while keywords, functions, numbers, parameters and
  structure survive — share a query's shape without leaking schema or data.
  Dollar-quoted bodies (`$fn$…$fn$`) are treated as literals, never corrupted. Download
  the private decoder map when you need to match `t1` / `s1` back to the originals.
- **Transforms are reversible**: Format, Minify and Obfuscate keep a three-step local
  history. Use the toast's **Undo** action or press `Ctrl/⌘+Z` immediately after a
  transform; once you resume editing, the shortcut leaves the editor alone.
- **Scale**: a 30,000-line / 1 MB script validates in well under a second and reports
  an error at line 15,000 precisely. Formatting the same buffer takes a few seconds —
  in a worker, so the page never freezes. Syntax highlighting bows out above 200k
  characters; editing and all tools keep working.
- **Errors are physical**: the offending line is marked in the editor, and the
  footer's `Ln 15000, Col 1 — near "SELEC"` is a button that jumps there.
- **Structure at a glance**: an **Outline** side panel lists every statement, CTE and
  subquery (runs of near-identical statements collapse into one counted row), and a
  **Graph** view draws the table/CTE dependency flow as a layered diagram. Click any
  row or node to jump to it in the editor.

## Fast, private, offline

- All parsing/formatting runs in a **Web Worker**; every parser is a lazy chunk that
  loads on first use.
- **PWA**: after the first visit the whole tool works offline and can be installed as
  an app. There are no application network requests or telemetry; same-origin requests
  only load the app's static files. Buffers under 2 MB persist in `localStorage` on your
  machine only.
- 5 runtime dependencies: react, react-dom, sql-formatter, sql.js (used purely as a
  syntax checker), acorn.

## Keyboard

| Keys | Action |
| --- | --- |
| `Ctrl+Enter` | Format |
| `Ctrl+Shift+M` | Minify |
| `Ctrl+Shift+O` | Obfuscate |
| `Ctrl+Shift+G` | Query graph |
| `Ctrl+Shift+L` | Toggle light / dark |
| `Ctrl+Z` | Undo the latest transform (while its output is unchanged) |
| `Ctrl+/` | Toggle line comment (`--` or `//` by language) |
| `Tab` | Indent |
| `?` | Full keyboard-shortcut reference |
| Click the footer error | Jump to the offending line |

(On macOS, `⌘` substitutes for `Ctrl`.) Drop a `.sql` / `.json` / `.js` / any text
file anywhere to load it.

## Development

```bash
npm install
npm run dev        # http://localhost:5180
npm run build      # static build in dist/
npm test
```

Deployment (free static hosting, step by step): **[DEPLOYMENT.md](DEPLOYMENT.md)**.

## Layout of the code

```
src/App.tsx                    the whole UI
src/components/Editor.tsx       highlighted textarea, error-line marker (zero deps)
src/components/StructurePanel.tsx  outline tree + dependency-graph views
src/worker/tools.worker.ts      validate / format / minify / obfuscate / analyze off-thread
src/lib/detect.ts               language + SQL dialect detection (tested)
src/lib/transform.ts            token-based minify + obfuscate (tested)
src/lib/analyze.ts              statement/CTE/table extraction for the outline + graph (tested)
```

## Known limits

- Full SQL parsing is SQLite's grammar; other dialects get an honest lexical check
  (the status bar tells you which one ran).
- JavaScript formatting is supported; minification and obfuscation remain SQL-only.
- Compound statements with `;` inside bodies (triggers) are handled by bounded
  re-parsing; pathological cases may mis-anchor an error by a statement.
