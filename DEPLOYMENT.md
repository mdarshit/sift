# Deploying Sift

Sift compiles to a **fully static site** — no server code, no database, no environment
secrets. Deployment means: build once, upload the `dist/` folder to any static host.
Every option below has a free tier that comfortably fits this app.

```bash
npm ci             # clean install
npm test           # unit tests
npm run build      # type-checks, then emits dist/ (~2 s)
npm run preview    # optional: serve the production build locally to sanity-check
```

What `dist/` contains: the app shell, the SQL.js SQLite engine as a lazy-loaded WASM
asset, and a service worker (`sw.js`) that makes the site work offline after the first
visit.

**No special server configuration is required.** There are no client-side routes (so no
SPA rewrite rules), no COOP/COEP headers, and no APIs. Compression and WASM MIME types
are handled correctly by all four hosts below out of the box.

---

## Option 1 — Cloudflare Pages *(recommended)*

Fast global CDN, unlimited bandwidth on the free tier, automatic HTTPS.

1. Push the project to a GitHub (or GitLab) repository.
2. Open [pages.cloudflare.com](https://pages.cloudflare.com) → **Create a project** →
   **Connect to Git** → select the repository.
3. Configure the build:
   - **Framework preset**: Vite (or None)
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Click **Save and Deploy**. First build takes ~1 minute.
5. Your site is live at `https://<project>.pages.dev`. Every push to the production
   branch redeploys automatically; other branches get preview URLs.

*Custom domain:* project → **Custom domains** → add your domain (free, includes TLS).

*CLI alternative (no Git integration):*

```bash
npm run build
npx wrangler pages deploy dist --project-name sift
```

## Option 2 — GitHub Pages

The repository already contains a ready-to-use workflow at
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). It installs, builds,
and publishes on every push to `main`. Pull requests run tests, type checking, linting,
and a production build through [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

1. Push the project to GitHub.
2. In the repository: **Settings → Pages → Build and deployment → Source** →
   select **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab).
4. The site appears at `https://<username>.github.io/<repo>/`.

The workflow sets `BASE_PATH=/<repo>/` automatically so assets resolve under the
project sub-path — no code changes needed. If you deploy to a **user site**
(`<username>.github.io` repository) or attach a **custom domain**, delete the
`BASE_PATH` line from the workflow so the site builds for the domain root.

## Option 3 — Netlify

**Fastest possible deploy (no account setup beyond login, no Git):**

1. `npm run build`
2. Drag the `dist/` folder onto [app.netlify.com/drop](https://app.netlify.com/drop).
3. Live immediately at a `*.netlify.app` URL.

**Continuous deployment:** **Add new site → Import an existing project** → pick the
repo → build command `npm run build`, publish directory `dist` → **Deploy**.

## Option 4 — Vercel

```bash
npm i -g vercel
vercel --prod
```

Accept the defaults — the **Vite** preset is auto-detected (build `npm run build`,
output `dist`). Or import the repository at [vercel.com/new](https://vercel.com/new)
for deploy-on-push.

---

## After deploying: verify

1. Open the URL — the demo tables should appear within a second.
2. Run a query (`Ctrl+Enter`).
3. Validate a SQLite query once to load and cache the SQL.js WASM engine.
4. Offline check: DevTools → **Network → Offline** → reload. The app must load and
   run queries with no network. (The service worker only registers on HTTPS or
   localhost — all four hosts serve HTTPS by default.)
5. Optional: install it — Chrome/Edge show an **Install** icon in the address bar.

## Updates and the service worker

- Deploying a new build is just re-running the same pipeline; hashed asset names make
  caching safe.
- The service worker checks for updates in the background. A new worker waits while an
  existing app tab is open rather than forcing that tab onto a mixed-version asset set;
  it activates after all tabs using the old version close.
- Hosts serve `sw.js` with revalidation by default; don't add a long-lived
  `Cache-Control: immutable` header to `sw.js` or `index.html` if you customize headers.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Blank page, 404s for `/assets/...` | Site is served from a sub-path but was built for the root. Build with `BASE_PATH=/<sub-path>/` (see the GitHub Pages notes). |
| SQLite validation never finishes | The host is blocking or mis-serving the `sql-wasm*.wasm` asset. Check its status and MIME type in the Network tab. |
| Old version keeps appearing | The service worker activates the new build on the *next* load. Hard-reload once, or unregister the worker in DevTools → Application. |
| Offline mode doesn't work | Service workers require HTTPS (or localhost). Check DevTools → Application → Service Workers shows *activated*. |

## Cost

Zero. Buffers under 2 MB and interface preferences live in each visitor's
`localStorage`, so traffic is the only resource you consume: static file serving within
every provider's free tier.
