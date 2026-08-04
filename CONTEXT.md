# Sift Context

Sift is a static, privacy-focused browser application for formatting, minifying,
obfuscating, validating, and analyzing SQL, JSON, and JavaScript. It has no
server or API: user input and processing remain in the browser.

## Stack

- React 18 and TypeScript, bundled with Vite 6.
- Tailwind CSS 4 plus custom CSS in `src/styles.css`.
- A module Web Worker performs parsing and transformations off the main thread.
- `sql.js` validates standard/SQLite SQL, `sql-formatter` formats SQL, Acorn
  validates JavaScript, and Prettier's browser bundle formats JavaScript.
- Vitest provides unit tests; ESLint and strict TypeScript enforce code quality.
- `vite-plugin-pwa` generates an auto-updating offline PWA.

## Architecture

```text
index.html -> src/main.tsx -> src/App.tsx
                              |
                              +-> src/components/     editor and UI views
                              +-> src/lib/toolsClient.ts
                                      |
                                      v
                              src/worker/tools.worker.ts
                                      |
                                      +-> src/lib/transform.ts
                                      +-> src/lib/analyze.ts
                                      +-> lazy parser/formatter imports
```

`App.tsx` owns application state and orchestration: editor content, automatic
language/dialect detection, validation and analysis scheduling, transform
history, dialogs, and local preferences. The buffer, theme, and accent are
persisted in `localStorage`; large buffers are intentionally not persisted.

`toolsClient.ts` is the only main-thread interface to the Worker. It assigns
request IDs and exposes typed methods for each action. `types.ts` is the shared
contract for the domain model and Worker request/response messages. Keep both
sides of this protocol in sync when adding or changing a Worker action.

## Source Map

| Path | Responsibility |
| --- | --- |
| `src/main.tsx` | React mount and production PWA registration. |
| `src/App.tsx` | Application state, action orchestration, persistence, and keyboard shortcuts. |
| `src/types.ts` | Shared language, result, structure-analysis, and Worker protocol types. |
| `src/components/Editor.tsx` | Dependency-free textarea editor, syntax highlighting, gutter, and editor shortcuts. |
| `src/components/StructurePanel.tsx` | SQL outline and dependency graph UI. |
| `src/components/ui.tsx` | Reusable icons, menus, dialogs, and spinner. |
| `src/lib/detect.ts` | Language and SQL-dialect heuristics; SQL formatter dialect mapping. |
| `src/lib/capabilities.ts` | Per-language feature availability. |
| `src/lib/transform.ts` | Quote-aware SQL tokenization, minification, and obfuscation. |
| `src/lib/analyze.ts` | SQL statement/CTE/subquery outline and dependency-graph extraction. |
| `src/lib/sqlTokens.ts` | Shared SQL and JavaScript keyword vocabulary. |
| `src/lib/toolsClient.ts` | Promise-based Worker RPC client. |
| `src/worker/tools.worker.ts` | Lazy-loaded validation, formatting, and transform execution. |
| `src/lib/__tests__/` | Unit tests for detection, capabilities, transforms, and analysis. |

## Important Behavior

- Standard and SQLite SQL use SQLite's compile-only parser. Other SQL dialects
  receive only lexical validation because SQLite would reject valid dialect
  syntax.
- SQL transformations must be quote- and comment-aware. Do not replace this
  logic with regular-expression-only transformations.
- Worker dependencies are dynamically imported to keep the initial bundle
  small and to avoid blocking the UI during expensive work.
- Structure analysis is SQL-only and deliberately caps output size. Preserve
  those limits when changing analysis behavior.
- The editor remains usable for very large inputs; highlighting is disabled for
  inputs above its configured threshold.

## Development

```bash
npm install
npm run dev        # http://localhost:5180
npm test
npm run typecheck
npm run lint
npm run build
```

The Vite server uses port 5180 with `strictPort`. `npm run build` already runs
the TypeScript check before producing `dist/`.

## Deployment

GitHub Actions deploys pushes to `main` to GitHub Pages. The workflow runs
`npm ci`, tests, and the production build. It sets `BASE_PATH` to the repository
subpath; use `BASE_PATH` for any static host that serves the app below `/`.
