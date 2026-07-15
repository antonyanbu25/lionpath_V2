# How Lionpath Code Works

**Paste this file to your AI coding assistant before starting a task on this repo.**

**SE Singha Paathai** (Lionpath) is an internal Freshworks Solution Engineering portal. Two workflows share one app: **pre-call prep** (research brief before discovery) and **post-call analysis** (summary, next steps, Quality Coach after a Zoom recording).

| Flow | When | Output |
|------|------|--------|
| **Pre-call prep** | Before a discovery/demo — company name + prospect email | Research brief one-pager |
| **Post-call analysis** | After a Zoom recording — paste the share link | Summary, next steps, Quality Coach scorecard |

---

## Rule #1 — SCHEMA ↔ RENDER contract

The worker returns JSON shaped by `schema.ts` (prep) or `postcall-schema.ts` (post-call). The browser renders that JSON in `app.js` / `postcall.js`. **Every field the UI reads must exist in the schema, be normalized in `word-limits.ts`, and be referenced in the render function.** Renaming, adding, or removing a field without updating all four places breaks generation, display, or saved history.

---

## BLAST RADIUS — what breaks when you change something

| You change… | Also update… | Safety |
|-------------|--------------|--------|
| `worker/src/schema.ts` (prep JSON shape) | `prep.ts` (prompt + `jsonSchema`), `word-limits.ts` (`normalizePrepOutput`), `web/app.js` (`renderPrep`, `isV5Prep`) | **CHANGE TOGETHER** — old preps in localStorage/KV show “regenerate” errors |
| `worker/src/postcall-schema.ts` (post-call JSON shape) | `postcall.ts` (prompt + `jsonSchema`), `word-limits.ts` (`normalizePostCallOutput`), `quality-score.ts` (overall score), `web/postcall.js` (`renderPostCall`, `normalizeAnalysisForRender`) | **CHANGE TOGETHER** — old history entries fall back to `renderLegacyPostCall` or break |
| `worker/src/word-limits.ts` (`LIMITS` caps) | Nothing required — trims server response only; UI `truncateWords` is a second pass | **SAFE alone** (tightening caps affects displayed length only) |
| `web/styles.css` | Nothing | **SAFE alone** (visual / print layout only) |
| `web/auth.js` (credentials, roles, session) | `app.js` (login gate, `isManagerRole` nav), `dashboard.js` (SE vs manager views), `history.js` (email-scoped keys) | **TEST BOTH LOGINS** (`se@` and `manager@`) |
| `worker/src/prep.ts` or `postcall.ts` (prompt wording) | Nothing if JSON shape unchanged; if shape changes → matching schema file | **SAFE alone** for wording; **CHANGE TOGETHER** if fields/enums change |
| `worker/src/index.ts` (route paths, auth, CORS) | `web/app.js` (`PREP_URL`, `/api/config`), `web/postcall.js` (`ANALYZE_URL`), `web/history.js` (`/api/history`), `web/firebase-config.js` (`WORKER_BASE_URL`) | **CHANGE TOGETHER** when paths change |
| `web/firebase-config.js` (`WORKER_BASE_URL`) | All fetch URLs above derive from it | **TEST AFTER** deploy (prep + post-call + history sync) |

---

## Architecture

```
Browser (web/)  →  Worker API (worker/)  →  Gemini (structured JSON)
                      ↓
              History storage (KV or file)
```

- **`web/`** — Static HTML/JS/CSS. No build step. nginx serves files in production.
- **`worker/`** — TypeScript API on Cloudflare Workers locally, or Node in Docker on the VPS. Handles LLM calls, Zoom transcript fetch, and history sync.
- **Gemini** — Returns JSON matching strict schemas. Prompts enforce word caps; `word-limits.ts` trims after parse.

Live: UI `lionpath.benjaminsquare.com` · API `lionpathapi.benjaminsquare.com`.  
Ops setup: see `docs/VPS_DEPLOY.md`.

---

## Request flows

### 1. Discovery prep generation

1. SE fills the prep form in `app.js` (company, email, optional context).
2. Browser `POST /api/generate-prep` with session auth.
3. `prep.ts` builds a system prompt (embeds `PREP_SCHEMA`), calls Gemini with web-search grounding, parses JSON.
4. `word-limits.ts` trims fields; `normalizePrepOutput` enforces shape.
5. `app.js` `renderPrep` builds HTML one-pager (must-see strip, good-to-see sections, sources).

**Typical wait:** 15–45 seconds.

### 2. Post-call analysis

1. SE pastes a Zoom recording URL in `postcall.js`.
2. Browser `POST /api/analyze-call` (transcript fetched inside worker via `zoomShare.ts`).
3. `postcall.ts` sends transcript to Gemini with `POSTCALL_SCHEMA`.
4. `quality-score.ts` computes overall score from six dimension scores (AI does not set overall directly).
5. `normalizePostCallOutput` trims; `postcall.js` `renderPostCall` renders summary, momentum hero, follow-up table, coaching card.

**Typical wait:** 10–25 seconds.

### 3. History storage

1. After analysis, `history.js` saves entry to `localStorage` (fast, per-email key).
2. On login, `syncHistoryOnLogin` merges with server via `GET/POST /api/history`.
3. Worker stores per-email arrays in Cloudflare KV (dev) or a file volume on VPS.
4. Dashboard (`dashboard.js`) and sidebar read history for metrics and recent calls.

---

## Key modules

| Path | Role |
|------|------|
| `web/index.html` | App shell: login, sidebar, prep/postcall forms, dashboard views |
| `web/app.js` | Auth gate, routing, prep form submit + `renderPrep`, manager/SE view switching |
| `web/postcall.js` | Post-call form, `renderPostCall`, copy/print actions |
| `web/auth.js` | Demo login (`se@` / `manager@`) or Firebase SSO when configured |
| `web/history.js` | localStorage cache + Worker history sync |
| `web/dashboard.js` | SE stats, charts, recent calls; manager team rollup |
| `web/styles.css` | Theme, one-pager layout, print styles |
| `worker/src/index.ts` | API routes, CORS, Firebase token verify, history endpoints |
| `worker/src/prep.ts` | Pre-call prompt + Gemini call + JSON parse |
| `worker/src/postcall.ts` | Post-call prompt + transcript + Gemini call |
| `worker/src/schema.ts` | Prep JSON schema + `Prep` type |
| `worker/src/postcall-schema.ts` | Post-call JSON schema + `PostCallAnalysis` type |
| `worker/src/word-limits.ts` | Per-field word caps + `normalizePrepOutput` / `normalizePostCallOutput` |
| `worker/src/quality-score.ts` | Overall Quality Coach score from dimension scores |

---

## Authentication and roles

**Demo mode** (default local): `auth.js` checks hardcoded credentials. Session in `sessionStorage` + `localStorage` backup.

| Role | Email | Password | Access |
|------|-------|----------|--------|
| SE | `se@freshworks.com` | `se123` | Dashboard, prep, post-call, own history |
| Manager | `manager@freshworks.com` | `mgr123` | Manager dashboard — team metrics across SEs |

**Firebase mode:** set `projectId` in `firebase-config.js`. Worker verifies Bearer tokens in `index.ts`. History email comes from the verified token, not the request body.

`app.js` uses `isManagerRole()` to show/hide nav and render `renderManagerDashboard()` vs `renderDashboard()`.

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
