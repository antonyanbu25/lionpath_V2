# How Lionpath Code Works

**SE Singha Paathai** (Lionpath) is an internal Freshworks Solution Engineering portal. It gives SEs one place to prepare for discovery calls and debrief after recorded demos. Two workflows share the same one-pager layout, dashboard, and history.

| Flow | When | Output |
|------|------|--------|
| **Pre-call prep** | Before a discovery/demo — company name + prospect email | Research brief one-pager |
| **Post-call analysis** | After a Zoom recording — paste the share link | Summary, next steps, Quality Coach scorecard |

---

## Architecture

```
Browser (web/)  →  Worker API (worker/)  →  Gemini (structured JSON)
                      ↓
              History storage (KV or file)
```

- **`web/`** — Static HTML/JS/CSS. No build step. nginx serves files in production.
- **`worker/`** — TypeScript API on Cloudflare Workers locally, or Node in Docker on the VPS. Handles LLM calls, Zoom transcript fetch, and history sync.
- **Gemini** — Returns JSON matching strict schemas (`schema.ts`, `postcall-schema.ts`). Prompts enforce word caps and table-only output.

Live deployment: UI at `lionpath.benjaminsquare.com`, API at `lionpathapi.benjaminsquare.com`.

---

## Request flows

### 1. Discovery prep generation

1. SE fills the prep form in `app.js` (company, email, optional context).
2. Browser `POST /api/generate-prep` with session auth.
3. `prep.ts` builds a system prompt, calls Gemini with web-search grounding, and parses JSON.
4. `word-limits.ts` trims fields to caps; `normalizePrepOutput` enforces schema shape.
5. `app.js` renders HTML one-pager (must-see strip, good-to-see sections, sources).

**Typical wait:** 15–45 seconds (research + generation).

### 2. Post-call analysis

1. SE pastes a Zoom recording URL in `postcall.js`.
2. Browser `POST /api/analyze-call` (or fetches transcript first via `/api/fetch-transcript`).
3. `postcall.ts` pulls transcript from Zoom share link (`zoomShare.ts`), trims it, sends to Gemini.
4. `quality-score.ts` computes overall score from six dimension scores (AI does not set overall directly).
5. `normalizePostCallOutput` trims; `postcall.js` renders summary, momentum hero, follow-up table, coaching card.

**Typical wait:** 10–25 seconds.

### 3. History storage

1. After analysis, `history.js` saves entry to `localStorage` (fast, per-email key).
2. On login, `syncHistoryOnLogin` merges with server via `GET/POST /api/history`.
3. Worker stores per-email arrays in Cloudflare KV (dev) or a file volume on VPS (`HISTORY_FILE_DIR`).
4. Dashboard (`dashboard.js`) and sidebar read history for metrics and recent calls.

---

## Key modules

| Path | Role |
|------|------|
| `web/index.html` | App shell: login, sidebar, prep/postcall forms, dashboard views |
| `web/app.js` | Auth gate, routing, prep form submit + render, manager/SE view switching |
| `web/postcall.js` | Post-call form, analysis display, copy/print actions |
| `web/auth.js` | Demo login (`se@` / `manager@`) or Firebase SSO when configured |
| `web/history.js` | localStorage cache + Worker KV sync |
| `web/dashboard.js` | SE stats, charts, recent calls; manager team rollup |
| `web/styles.css` | Theme, one-pager layout, print styles |
| `worker/src/index.ts` | API routes, CORS, Firebase token verify, history endpoints |
| `worker/src/prep.ts` | Pre-call prompt + Gemini call + JSON parse |
| `worker/src/postcall.ts` | Post-call prompt + transcript + Gemini call |
| `worker/src/schema.ts` | Prep JSON schema |
| `worker/src/postcall-schema.ts` | Post-call JSON schema |
| `worker/src/word-limits.ts` | Enforces per-field word caps after LLM response |
| `deploy/vps/` | Docker Compose: nginx (web), worker container, Caddy TLS |

---

## Authentication and roles

**Demo mode** (default local): `auth.js` checks hardcoded credentials. Session stored in `sessionStorage` + `localStorage` backup.

| Role | Email | Password | Access |
|------|-------|----------|--------|
| SE | `se@freshworks.com` | `se123` | Dashboard, prep, post-call, own history |
| Manager | `manager@freshworks.com` | `mgr123` | Manager dashboard — team metrics across SEs |

**Firebase mode** (production-ready): set `projectId` in `firebase-config.js`. Worker verifies Bearer tokens in `index.ts`. History email comes from the verified token, not the request body.

`app.js` uses `isManagerRole()` to show/hide nav items and render `renderManagerDashboard()` vs `renderDashboard()`.

---

## Data pipeline (shared pattern)

```
Form input  →  POST /api/...  →  Gemini (structured JSON)
                                        ↓
                              extractJson + schema validate
                                        ↓
                              normalize / trim (word-limits)
                                        ↓
                              JSON response  →  render one-pager HTML
```

Both flows use **tables and bullets only** — no paragraphs. Prompts define strict word caps so output fits a scannable one-pager. The UI truncates further if needed.

---

## VPS deployment

`deploy/vps/docker-compose.yml` runs three services:

- **web** — nginx serves `web/` on port 8788
- **worker** — Node server (`node-server.ts`) on 8787, `.env` for API keys
- **caddy** — TLS termination, routes domains to web and worker

History persists in `/var/lib/se-paathai/history` mounted into the worker container. See `docs/VPS_DEPLOY.md` for setup.

---

## Where to change things

| What | File(s) |
|------|---------|
| Pre-call AI prompt / research rules | `worker/src/prep.ts` |
| Post-call AI prompt / scoring rubric | `worker/src/postcall.ts` |
| JSON field shapes | `worker/src/schema.ts`, `postcall-schema.ts` |
| Word caps after generation | `worker/src/word-limits.ts` |
| Prep form + one-pager HTML | `web/app.js` |
| Post-call form + result HTML | `web/postcall.js` |
| Colors, layout, print | `web/styles.css` |
| API routes / auth / CORS | `worker/src/index.ts` |
| Demo credentials | `web/auth.js` |
| Worker URL | `web/firebase-config.js` (`WORKER_BASE_URL`) |

---

## Local development

```bash
# Terminal 1 — API
cd worker && npm run dev    # port 8787

# Terminal 2 — UI
cd web && npm run dev       # port 5500 (proxies /api to worker)
```

Open `http://localhost:5500`, sign in with demo credentials, and run a prep or post-call flow.
