# How Lionpath Code Works

**Paste this file to your AI coding assistant before starting a task on this repo.**

---

## What Lionpath is

**SE Singha Paathai** (Lionpath) is an internal Freshworks Solution Engineering portal. Two workflows share one app:

| Flow | When | Output |
|------|------|--------|
| **Pre-call prep** | Before a discovery/demo — company name + prospect email | Research brief one-pager |
| **Post-call analysis** | After a Zoom recording — paste the share link | Summary, next steps, Quality Coach scorecard |

---

## The pieces, in plain English

| Plain name | Actual file | What it does |
|------------|-------------|--------------|
| The page shell | `web/index.html` | HTML layout: login, sidebar, forms, and result areas. |
| The page logic | `web/app.js` | Login gate, navigation, prep form, and renders the prep one-pager. |
| The post-call UI | `web/postcall.js` | Post-call form, result display, copy/print actions. |
| The dashboards | `web/dashboard.js` | SE stats and manager team rollup from saved history. |
| The look | `web/styles.css` | Colors, one-pager layout, and print styles. |
| The doorman | `web/auth.js` | Checks who you are — demo logins or Firebase SSO. |
| The memory (browser) | `web/history.js` | Saves calls in the browser and syncs with the server on login. |
| The API address book | `web/firebase-config.js` | Tells the browser where the worker API lives. |
| The messenger / routes | `worker/src/index.ts` | API routes, CORS, auth checks, and history endpoints. |
| The researcher | `worker/src/prep.ts` | Builds the prep prompt, calls Gemini, returns research JSON. |
| The debriefer | `worker/src/postcall.ts` | Sends the transcript to Gemini and returns analysis JSON. |
| The Zoom fetcher | `worker/src/zoomShare.ts` | Downloads the transcript from a Zoom share link inside the worker. |
| The rulebook (prep) | `worker/src/schema.ts` | Defines every field the prep JSON must have. |
| The rulebook (post-call) | `worker/src/postcall-schema.ts` | Defines every field the post-call JSON must have. |
| The trimmer | `worker/src/word-limits.ts` | Cuts text to word caps and normalizes shape after generation. |
| The scorer | `worker/src/quality-score.ts` | Computes the overall Quality Coach score from six dimensions. |
| The memory (server) | `worker/src/history.ts`, `worker/src/history-file.ts` | Stores history per email — Cloudflare KV in dev, file volume on VPS. |

---

## How it works, start to finish

### Architecture

```
Browser (web/)  →  Worker API (worker/)  →  Gemini (structured JSON)
                      ↓
              History storage (KV or file)
```

- **`web/`** — Static HTML/JS/CSS. No build step. nginx serves files in production.
- **`worker/`** — TypeScript API on Cloudflare Workers (dev) or Node on the VPS. Handles LLM calls, Zoom transcript fetch, and history sync.
- **Gemini** — Returns JSON matching strict schemas. Prompts enforce word caps; **the trimmer** trims after parse.

Live: UI `portal.benjaminsquare.com` · API `portalapi.benjaminsquare.com`.  
Server setup: see `docs/VPS_DEPLOY.md`.

### 1. Discovery prep generation

1. SE fills the prep form in **the page logic** (`web/app.js`) — company, email, optional context.
2. **The doorman** (`web/auth.js`) confirms the session; browser calls `POST /api/generate-prep`.
3. **The messenger** (`worker/src/index.ts`) routes the request to **the researcher** (`worker/src/prep.ts`).
4. **The researcher** builds a prompt using **the rulebook** (`worker/src/schema.ts`), calls Gemini with web-search grounding, parses JSON.
5. **The trimmer** (`worker/src/word-limits.ts`) cuts fields to caps and enforces shape.
6. **The page logic** `renderPrep` builds the HTML one-pager (must-see strip, good-to-see sections, sources).

**Typical wait:** 15–45 seconds.

### 2. Post-call analysis

1. SE pastes a Zoom recording URL in **the post-call UI** (`web/postcall.js`).
2. Browser `POST /api/analyze-call` — **the Zoom fetcher** (`worker/src/zoomShare.ts`) gets the transcript inside the worker.
3. **The debriefer** (`worker/src/postcall.ts`) sends transcript to Gemini with **the post-call rulebook** (`worker/src/postcall-schema.ts`).
4. **The scorer** (`worker/src/quality-score.ts`) computes overall score from six dimension scores (the AI does not set overall directly).
5. **The trimmer** normalizes output; **the post-call UI** `renderPostCall` renders summary, momentum hero, follow-up table, coaching card.

**Typical wait:** 10–25 seconds.

### 3. History storage

1. After analysis, **the memory (browser)** (`web/history.js`) saves the entry to `localStorage` (fast, per-email key).
2. On login, `syncHistoryOnLogin` merges with server via `GET/POST /api/history`.
3. **The memory (server)** (`worker/src/history.ts` or `history-file.ts`) stores per-email arrays in KV (dev) or a file volume (VPS).
4. **The dashboards** (`web/dashboard.js`) and sidebar read history for metrics and recent calls.

### Data pipeline (shared pattern)

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

## The one rule that matters

**The schema ↔ render contract.** The worker returns JSON shaped by **the rulebook** (`schema.ts` for prep, `postcall-schema.ts` for post-call). The browser renders that JSON in `app.js` / `postcall.js`. Every field the UI reads must exist in the schema, be normalized in **the trimmer** (`word-limits.ts`), and be referenced in the render function. Renaming, adding, or removing a field without updating all four places breaks generation, display, or saved history.

---

## What breaks when you change something

| Plain name | You change… | Also update… | Safety |
|------------|-------------|--------------|--------|
| The rulebook (prep) | `worker/src/schema.ts` | `prep.ts` (prompt + `jsonSchema`), `word-limits.ts` (`normalizePrepOutput`), `web/app.js` (`renderPrep`, `isV5Prep`) | **CHANGE TOGETHER** — old preps in localStorage/KV show "regenerate" errors |
| The rulebook (post-call) | `worker/src/postcall-schema.ts` | `postcall.ts` (prompt + `jsonSchema`), `word-limits.ts` (`normalizePostCallOutput`), `quality-score.ts` (overall score), `web/postcall.js` (`renderPostCall`, `normalizeAnalysisForRender`) | **CHANGE TOGETHER** — old history entries fall back to `renderLegacyPostCall` or break |
| The trimmer | `worker/src/word-limits.ts` (`LIMITS` caps) | Nothing required — trims server response only; UI `truncateWords` is a second pass | **SAFE alone** (tightening caps affects displayed length only) |
| The look | `web/styles.css` | Nothing | **SAFE alone** (visual / print layout only) |
| The doorman | `web/auth.js` (credentials, roles, session) | `app.js` (login gate, `isManagerRole` nav), `dashboard.js` (SE vs manager views), `history.js` (email-scoped keys) | **TEST BOTH LOGINS** (`se@` and `manager@`) |
| The researcher / debriefer | `worker/src/prep.ts` or `postcall.ts` (prompt wording) | Nothing if JSON shape unchanged; if shape changes → matching schema file | **SAFE alone** for wording; **CHANGE TOGETHER** if fields/enums change |
| The messenger | `worker/src/index.ts` (route paths, auth, CORS) | `web/app.js` (`PREP_URL`, `/api/config`), `web/postcall.js` (`ANALYZE_URL`), `web/history.js` (`/api/history`), `web/firebase-config.js` (`WORKER_BASE_URL`) | **CHANGE TOGETHER** when paths change |
| The API address book | `web/firebase-config.js` (`WORKER_BASE_URL`) | All fetch URLs above derive from it | **TEST AFTER** deploy (prep + post-call + history sync) |

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
