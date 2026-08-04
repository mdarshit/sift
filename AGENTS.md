# Contributor Guidance

## Scope

Sift is a client-only React/TypeScript application. Preserve its privacy model:
do not add network requests, telemetry, server dependencies, or remote code
execution for user content.

## Implementation Rules

- Keep expensive parsing, formatting, validation, and transformations in
  `src/worker/tools.worker.ts`; do not move them into React render paths or
  input handlers.
- Use `src/lib/toolsClient.ts` for main-thread-to-Worker communication. When
  adding an action, update the request/response unions in `src/types.ts`, the
  client method, the Worker switch, and relevant tests together.
- Maintain the distinction between full validation for JSON, JavaScript, and
  standard/SQLite SQL, and lexical validation for the other SQL dialects.
- Keep SQL token handling quote-, comment-, and dollar-quote-aware. Add focused
  regression tests for edge cases before changing `transform.ts`, `analyze.ts`,
  or validation scanning.
- Use `capabilities.ts` as the source of truth for which actions each language
  supports. Do not duplicate feature-policy checks in UI code.
- Retain the lazy imports in the Worker for parser and formatter dependencies.
- Treat `src/types.ts` as the public contract between the UI and Worker. Keep
  line/column conventions intact: user-visible positions are 1-based and
  character offsets are 0-based.

## Code Style

- TypeScript is strict and rejects unused locals and parameters. Prefix an
  intentionally unused callback argument with `_`.
- Follow the existing style: single quotes, no semicolons, path-relative
  imports, and concise comments only where behavior is non-obvious.
- Prefer small, dependency-free components and utilities. The editor and graph
  intentionally avoid dedicated UI/editor/graph libraries.
- Preserve responsiveness for large buffers. Avoid work during render and
  debounce or offload work that scales with input size.

## Tests And Checks

Run the narrowest relevant test while iterating, then run all checks for a
completed change:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Tests live in `src/lib/__tests__/` and use Vitest. Add or update a unit test
when changing language detection, capabilities, SQL transformations, or SQL
structure analysis. For editor, Worker, or PWA behavior, manually exercise the
affected browser flow when practical.

## Deployment

The GitHub Pages workflow in `.github/workflows/deploy.yml` runs on `main` and
builds with `BASE_PATH=/<repository>/`. Keep asset paths and PWA behavior
compatible with deployment below a subpath.
