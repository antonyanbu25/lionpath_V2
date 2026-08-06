# Lionpath â€” SE Singha Paathai

**One portal for Freshworks Solution Engineers:** research a prospect **before** the call, debrief **after** the call, and track **accounts, contacts, and deal progress** in one place.

| | |
|---|---|
| **Current branch** | **`2.1`** — account/deal deduplication, RAG omni-search, session restore, Know tab UI, **LinkedIn PDF required**, **Recent news**, **parallel fish sizing**, **Dew splash + favicon bounce**, **UI micro-animations (2.1.22)**, **SSO/login UX (2.1.17)**, **four-layer cost control**, **LLM usage admin**, **post-call demo UX (2.1.20)** — compact call timeline, single-pass call record paint, seamless hydration ([tree/2.1](https://github.com/skut264/lionpath/tree/2.1)) |
| **Previous release** | **`2.0.8.2`** â€” Know tab pre-call UI ([tree/2.0.8.2](https://github.com/skut264/lionpath/tree/2.0.8.2)) |
| **Earlier release** | **`2.0.5`** â€” Kaia share-content hardening ([tree/2.0.5](https://github.com/skut264/lionpath/tree/2.0.5)) |
| **Live app** | **[https://lionpath.benjaminsquare.com](https://lionpath.benjaminsquare.com)** |
| **API** | **[https://lionpathapi.benjaminsquare.com](https://lionpathapi.benjaminsquare.com)** |
| **Repo (upstream)** | [github.com/skut264/lionpath](https://github.com/skut264/lionpath) |
| **Fork (contributors)** | [github.com/sowravsunil/singapaathai](https://github.com/sowravsunil/singapaathai) â€” push here first, then open PR to `lionpath` |
| **Architecture docs** | [docs/HLD.md](./docs/HLD.md) Â· [docs/LLD.md](./docs/LLD.md) Â· [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| **Demo login** | `se@freshworks.com` / `se123` |

---

## What it does

Lionpath (SE Singha Paathai) is an internal SE coaching portal with two core workflows:

| Workflow | When to use | What you get |
|----------|-------------|--------------|
| **Pre-call prep** | Before discovery or demo â€” you have a company name, prospect email, and optional context | A printable one-pager brief: company vs industry comparison, business context, and an SE playbook |
| **Post-call analysis** | After a recorded customer call â€” you have a Zoom cloud recording link | Call summary, prioritized next steps (including follow-up email + CRM notes), and a Quality Coach scorecard |

Both flows share the same polished one-pager layout, personal dashboard, and sidebar history â€” so SEs stay in one place from prep through debrief.

---

## Pre-call improvements (branch `2.1`)

### Login page (2.1.11)

Centered sign-in restored from **`2.0.8.1-merge`** â€” full-screen ambient video background with a white card in the middle:

| Item | Detail |
|------|--------|
| **Layout** | Full-viewport video background; centered card with Freshworks logomark, heading, and **Sign in with Google** |
| **Branding** | Freshworks logomark in card + **browser favicon** (`assets/freshworks-logomark.webp`) |
| **Dark mode** | Top-right crescent moon toggle with slow glow pulse (4s loop); sun icon when dark mode is active |
| **Animations** | Gentle card entrance, staggered field fade-in, subtle video drift, button hover lift â€” all respect `prefers-reduced-motion` |
| **SSO** | Google sign-in pill on production; demo email/password on localhost |

Key paths: `web/index.html`, `web/styles.css`, `web/theme.js`.

After deploy, hard-refresh the portal (Ctrl+Shift+R) to pick up the new favicon and CSS cache bust.

### Splash screen & favicon (2.1.13)

First-visit intro on `index.html` — once per browser (`lionpath_splash_seen` cookie):

| Item | Detail |
|------|--------|
| **Theme** | Warm cream background (`--dew-bg`) with soft teal radial glow; card-style loader matches login card |
| **Logo** | Freshworks logomark centered in the white loader card; spinner pinned to card bottom (does not shift logo) |
| **Animation** | Gentle glow breathe (4s), logo float (2.8s), content rise/fade; respects `prefers-reduced-motion` |
| **Favicon bounce** | When the tab is **inactive** (Page Visibility API), canvas redraw with ±2.5px sine bounce and a subtle multi-hue brand glow; static icon while the tab is focused. Respects `prefers-reduced-motion` |
| **Replay** | `index.html?splash=1` or clear `lionpath_splash_seen` cookie |

Key paths: `web/styles.css`, `web/dew-theme.css`, `web/splash.js`, `web/favicon-bounce.js`, `web/index.html`, `web/about.html`.

### UI micro-animations (2.1.22)

Subtle, professional motion across the portal — all respect `prefers-reduced-motion`:

| Area | Behavior |
|------|----------|
| **Favicon (inactive tab)** | Page Visibility API: logo bounces ±2.5px and cycles a soft teal/blue/green/amber glow while the user is in another tab; static favicon when the tab is active |
| **Call record KPIs** | QIP score and MEDDPICC numbers count up with a brief typewriter scramble; meter bar fills from zero |
| **Evaluation signal** | Pentagon radar entrance animation (same family as post-call QIP) |
| **Cam on/off pills** | Gentle opacity/translate pulse on stakeholder camera badges |
| **QIP scorecard pentagons** | Staggered reveal on category rows |
| **Sidebar idle** | After **1 minute** without mouse/keyboard/scroll, nav icons nudge one-by-one (~520ms apart); any activity resets the timer |
| **Call navigation fix** | `shouldApply` guards after every async step; `data-call-id` on the panel; loading shell when switching calls — prevents a stale previous call from flashing |

Key paths: `web/favicon-bounce.js`, `web/call-view-animate.js`, `web/call-view.js`, `web/call-view.css`, `web/sidebar-idle.js`, `web/styles.css`, `web/app.js`.

Web-only deploy: `bash refresh-web.sh` on VPS.

### Login & SSO UX (2.1.17–2.1.18)

Fixes first-impression login loop, unreliable SSO clicks, and infinite dashboard loading:

| Issue | Fix |
|-------|-----|
| **Login → splash → login loop** | Pre-login SE Labs splash **skipped on production SSO hosts** (`portal.*`, `yonus.*`, `lionpath.*`, Cloud Run). Sign-in card shows immediately. |
| **Stale session flash** | Inline `index.html` session-restore script **disabled on production SSO hosts** — no app-loading flash before Firebase validates auth. |
| **SSO button needs 2–3 clicks** | Google button wired on **`DOMContentLoaded`** (before boot finishes) via `bindActionOnce` + `customElements.whenDefined("fw-button")`. |
| **SSO completes but no session** | After popup, **`completeFirebaseLogin` is called explicitly** (not only via `onAuthStateChanged` race). |
| **No feedback during SSO popup** | Full-screen Dew loader with staged messages: *Preparing…* → *Opening Google sign-in…* → *Completing sign-in…* → dashboard. |
| **Premature logout during SSO** | `ssoInFlight` guard blocks `onAuthStateChanged(null)` and boot `showLogin()` while the popup is open. |
| **Loading dashboard… forever** | Dashboard paints from **local data first**; Firestore queries time out at 8–12s; **12s watchdog** + fallback launchpad; `showApp` always clears `#app-loading` even if routing throws. |

| **Stale local session without Firebase user** | **2.1.19:** removed eager `cachedEarly` restore; bootstrap **clears stale storage** and shows login when `currentUser` is null. |
| **SSO blocked by in-flight showApp** | **2.1.19:** `showApp` waits for prior flight to finish on `freshLogin`. |

Key paths: `web/app.js`, `web/dashboard.js`, `web/splash.js`, `web/index.html`, `web/firebase-config.js` (`AUTH_BUILD_ID` **2.1.19**).

After deploy: hard-refresh (Ctrl+Shift+R). Bump `AUTH_BUILD_ID` whenever auth/boot JS changes.

**Deploy note:** production hostnames load `web/dist/boot.js`. After auth/dashboard changes run `cd web && npm run build` (or VPS `build-web-bundle.sh`) before `refresh-web.sh` / `update.sh` — otherwise the portal serves stale bundled JS.

**Verify live:** `curl -s https://portal.benjaminsquare.com/ | grep portal-build` must show **2.1.19** (not 2.1.14). Bundled `dist/boot.js` must include SSO fixes — VPS: `cd /opt/se-singha-paathai/deploy/vps && bash refresh-web.sh`.

### Post-call demo UX (2.1.20)

SVP-demo polish on **`2.1`** — deploy from **`antony/2.1`** (`lionpath_V2`):

| Area | Fix |
|------|-----|
| **Call timeline** | Fixed-height spine; colored dots on bar (hover for full moment); humanized labels; no expanding event list |
| **Evaluation signal** | Radar renders once; no triple re-animation during hydration |
| **Call notes** | Bullets as soon as summarise data exists |
| **Hydration** | One final panel paint when background passes complete |
| **Start analysis** | Instant loading overlay; CRM account flush on submit |
| **Accounts / Deals / Dashboard** | Loading shell on first paint (no white flash) |

Key paths: `web/call-view.js`, `web/app.js`, `web/postcall.js`, `web/dashboard.js`. VPS: `bash upgrade-now.sh`.

### Post-call demo UX (2.1.21)

Follow-up on **`2.1`** for VPS demo blockers:

| Area | Fix |
|------|-----|
| **Timeline dots** | Spine scale includes marker timestamps (not just video segments); normalize `atS`/`atSec`; larger on-bar dots |
| **Call record paint** | Effective hydration pending skips skeletons when generate-pass data exists; no mid-hydration panel re-renders |
| **Start analysis** | Resolve context pre-warmed in parallel with intake; email-domain company name before CRM flush; shorter debounce/timeouts |

Regression: `node web/scripts/test-call-timeline-render.mjs`

### Account / deal deduplication & linking (2.1)

| Issue | Fix |
|-------|-----|
| **Duplicate accounts** on repeat search | `upsertAccountFromPrep` now honours explicit `accountId`, domain lookup, and slug resolution â€” CRM-selected accounts are reused instead of re-derived from typed shorthand |
| **Duplicate deals** when not intended | `getOrCreateLifecycle` handles `createNewDeal` by archiving the old spine and calling `createDealWithExplicitTitle`; repeat briefs reuse the active deal |
| **Post-call account ignored** | `linkPostCallToLifecycle` respects `accountId` and `createNewAccount` flags from intake |
| **Misleading UI labels** | Pre-call and post-call badges now show **Existing account** / **New account Â· on generate** (or **on confirm**) instead of always implying creation |
| **Repeat pre-call search** | CRM resolve panel reuses existing account/deal on repeat email search instead of showing "new account" (`ed48285`) |

Key modules: `web/domain/account-service.js`, `web/domain/lifecycle-service.js`, `web/domain/dual-write.js`, `web/prep-crm-resolve.js`, `web/postcall.js`.

Regression: `node web/scripts/test-contact-deal-mapping.mjs`

### RAG-powered omni search (2.1)

Freshdesk-inspired global search (âŒ˜K / topbar):

| Feature | Detail |
|---------|--------|
| **Scope** | Accounts, deals, contacts, discovery briefs, call reviews, open tasks |
| **Filter chips** | All Â· Accounts Â· Deals Â· Contacts Â· Briefs Â· Calls Â· Tasks |
| **Recently searched / viewed** | Per-user localStorage with Clear actions |
| **RAG rerank** | Token match locally â†’ `POST /api/search/rag` embedding rerank (Gemini `gemini-embedding-001`) when worker key is configured |
| **Speed / index** | Sync localStorage history/briefs/calls before Firestore; instant token hits + async RAG rerank (`3aeab26`) |
| **Panel alignment** | Omni-search dropdown anchored to topbar input width/position (`1258713`) |
| **Open from search** | Account/contact/deal result clicks clear stale deal context and open the correct object (`2.1.12`) |
| **Dark theme** | Uses `--dew-*` tokens; filter chips and result rows adapt to `[data-theme="dark"]` |

Key modules: `web/search-service.js`, `web/global-search.js`, `worker/src/search/rag-search.ts`.

### Brief list, Research Extras, and context routing (2.1)

| Feature | Detail |
|---------|--------|
| **Brief Generated → All briefs** | Dashboard **Brief Generated** KPI opens a searchable all-briefs list under Pre-call; back navigation to the list; hash routes `#precall/briefs` and `#precall/briefs/:id` |
| **Research Extras confidence** | SE/context-sourced Additional Context rows show **High** confidence in Research Extras |
| **Additional Context mapping** | `context-field-router` disambiguates support team vs employee headcount vs end-user volume (worker + web canon) |
| **Pre-call brief UI** | Unknown alignment section removed from the generated brief |

Key modules: `web/briefs-list-view.js`, `web/app.js`, `web/precall.js`, `worker/src/prep/context-field-router.ts`, `web/prep-se-context.js`, `web/prep-source-canon.js`, `web/precall-brief-v9.js`.

Regression: `node web/scripts/test-briefs-list-view.mjs`, `node web/scripts/test-prep-se-context.mjs`, `worker` tests for `context-field-router`.
---

Three Know-tab fixes ship on the pre-call form and worker pipeline. API routes are unchanged: the UI still calls `POST /api/prep/research` then `POST /api/prep/synthesize` (or the all-in-one `POST /api/generate-prep`).

### 1. LinkedIn PDF â€” required before Generate brief

| Item | Detail |
|------|--------|
| **Rule** | One LinkedIn â€œSave to PDFâ€ per prospect email in the form |
| **Validation** | Client-side in `buildPayload()` (`web/precall.js`) via `emailsMissingLinkedInPdf()` (`web/prep-linkedin-pdf.js`) |
| **On failure** | Submit blocked; `#prep-linkedin-error` shows missing emails; rows highlighted with `.nb-linkedin-row-missing` |
| **Why** | Prospect DISC / Do-Donâ€™t profiles and `/api/contact/enrich` need PDF text; briefs without PDFs were too thin on â€œWho is in the roomâ€ |

LinkedIn PDFs are extracted in-browser (pdf.js, max 5 files Ã— 2 MB, 20k chars text) and sent to the worker as `linkedinProfileExports: [{ fileName, text }]`.

### 2. Recent news â€” real web articles only

The **Recent news** card (Know tab, row 1) no longer back-fills from research facts or SE typed context.

| Stage | Module | Behaviour |
|-------|--------|-----------|
| **1 â€” Parallel fetch** | `worker/src/prep/company-news.ts` | **Gemini** `google_search` grounding and **web crawl** run **at the same time** (`Promise.all`), then merged and deduped (up to **5** items) |
| **1a â€” Redirect resolve** | `worker/src/prep/citations.ts` | Grounding redirect URLs resolved to publisher URLs **before** domain verification |
| **1b â€” Web crawl** | `worker/src/research/providers/company-news-search.ts` | **Google News RSS** (primary when DDG rate-limits) + **DuckDuckGo** HTML (parallel queries + retries); news-like URLs only (excludes LinkedIn, careers, login) |
| **1c â€” Newsroom fallback** | same | If RSS + DDG both return 0 (common on VPS), scrape company `/company/newsroom/`, `/press/`, etc. |
| **2 â€” Detail hygiene** | same + `web/precall-brief-v9.js` | RSS descriptions embed HTML entities â€” stripped at ingest; UI shows **headline + Read article** only (no raw `&lt;a href=` lines) |
| **3 â€” Empty state** | `web/precall-brief-v9.js` | â€œNo public company news found yetâ€¦â€ when all stages fail |

| UI | Detail |
|----|--------|
| **Article link** | Each item shows **Read article â†’** (`prep-v9-news-link`) opening the publisher URL in a new tab |
| **Layout** | Headline, source badge (N1..Nn), and link â€” no duplicate HTML snippet under the title |
| **Sources** | `prep.newsSources` (N1..Nn labels) separate from main prep `sources` |
| **Debug** | `researchMeta.recentNewsDebug.pipeline` reports `{ gemini, web }` counts after synthesize |
| **No backfill** | `buildRecentNews()` fallback removed from `worker/src/prep/index.ts`; `hydrateRecentNews()` in `web/recent-news.js` no longer rehydrates from cached research bundles |

**Deploy note:** Recent news is generated in the **worker** during `POST /api/prep/synthesize`. Web-only cache bust is not enough â€” run `bash upgrade-now.sh` on the VPS and generate a **fresh** brief (not an old history entry).

### 3. How big is this fish? â€” web + AE context in parallel

| Stage | Module | Behaviour |
|-------|--------|-----------|
| **1 â€” Parallel fetch** | `worker/src/prep/index.ts` | **Grounded rivals** (`rivals.ts`) and **AE context extraction** (`rivals-context.ts`) run **together** when additional context is present |
| **1a â€” Grounded rivals** | `worker/src/prep/rivals.ts` | Web search for 2â€“4 market rivals; benchmark bars from sourced headcount / funding / industry axis; redirect URLs resolved before verification |
| **1b â€” Context supplement** | `worker/src/prep/rivals-context.ts` | LLM extracts **company sizing only** from merged AE context (typed notes + attachments + Kaia); metrics that overlap web axes are deduped |
| **Context filter** | `filterFishContextMetrics()` | Keeps headcount, agents, funding, revenue, volume; **drops** deal requirements (incumbent, integrations, timeline, budget, pain, etc.) even if mis-tagged |
| **2 â€” Empty state** | `web/precall-brief-v9.js` | â€œWe could not size this accountâ€¦â€ when neither stage finds data |

| UI | Detail |
|----|--------|
| **Web sizing** | Horizontal benchmark bars from `prep.rivals.axes` (wireframe-style rail + rival band + prospect dot) |
| **Context supplement** | Non-overlapping AE metrics append below web bars with **INPUT** badge (`prep.fishContext`) |
| **Context-only** | When web finds nothing, full INPUT bar card from AE notes only |

### LLM usage tracking (2.1)

Every worker LLM call records token counts, latency, and grounding usage to Firestore for org-level cost visibility (directors only).

| Item | Detail |
|------|--------|
| **Storage** | Firestore collection `llmUsage` (one doc per call; fields include `passName`, `model`, `promptTokens`, `outputTokens`, `cachedTokens`, `groundingQueries`, `latencyMs`, `userId`, optional `callId`, `createdAt`) |
| **Pricing** | Estimated USD via `worker/src/cost-rates.ts` (per-model input/output/cached rates) |
| **Admin API** | `GET /api/admin/llm-usage?start=&end=` (ISO date or epoch ms; default last 7 days) — **director-only**; rollups by `passName` and `model` |
| **Instrumentation** | Providers in `worker/src/providers/`; persistence in `worker/src/data/llm-usage.ts`; route `worker/src/routes/admin-llm-usage.ts` |

**Firestore index:** queries filter `createdAt` range and order by `createdAt` desc. If the admin endpoint returns an index error, create a composite index on `llmUsage` for range + `orderBy createdAt` (use the link in the Firebase console error).

**Deploy:** worker rebuild required (`bash upgrade-now.sh` or `bash update.sh` on the VPS). No web bundle change unless you only hit the JSON admin route.

### Cost control — four layers (2.1)

Production spend protection stacks **billing alerts**, **Gemini API quotas**, a **worker per-user daily token budget**, and **Pass 7 (summarise) anomaly detection**. Full runbooks: **[docs/COST_CONTROL.md](./docs/COST_CONTROL.md)**. VPS env defaults: `deploy/vps/.env.example`; deploy doc: **[docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md)** (cost control pointer).

| Layer | Mechanism | Caps spend? | Where |
|-------|-----------|-------------|-------|
| **1. Cloud Billing budget** | GCP budget alerts at **50 / 80 / 100 / 150%** of monthly budget | No — alerts only | `deploy/gcp/setup-billing-budget.sh`, Console |
| **2. Gemini API quotas** | **12,000** requests/day, **120**/min on production API key | Yes — hard API ceiling | Console (see COST_CONTROL.md) |
| **3. Worker token budget** | Per-user daily token budget in Firestore; **HTTP 429** when exceeded | Yes — circuit breaker before LLM | `worker/src/data/token-budget.ts`, `worker/src/cost-control-config.ts`, `worker/src/providers/index.ts` |
| **4. Pass 7 anomaly alert** | Summarise tokens/call > rolling **p95 × 2** (14-day baseline) | No — detects prompt regressions | `worker/src/data/usage-anomaly.ts`, optional `COST_ALERT_WEBHOOK_URL` |

| Env (layer 3–4) | Default | Notes |
|-----------------|---------|-------|
| `DAILY_TOKEN_BUDGET_ENABLED` | `1` | Requires Firestore admin credentials |
| `DAILY_TOKEN_BUDGET_PER_USER` | 8M tokens/day | Override per org |
| `DAILY_TOKEN_BUDGET_RESERVE` | 120k | Reserved headroom per request |
| `SUMMARISE_ANOMALY_ENABLED` | `1` | Runs after each `llmUsage` write for `passName: summarise` |
| `SUMMARISE_ANOMALY_MULTIPLIER` | `2` | vs rolling p95 |
| `SUMMARISE_ANOMALY_BASELINE_DAYS` | `14` | Baseline window |
| `COST_ALERT_WEBHOOK_URL` | (optional) | Slack/webhook for anomaly alerts |

**Tests:** `cd worker && npx tsx scripts/test-cost-control.ts` (also in `npm test`).

**Deploy:** worker rebuild + `.env` on VPS; layer 1 is GCP-only (no worker deploy).


### Files touched (this release)

| Area | Paths |
|------|-------|
| Login refresh | `web/index.html`, `web/styles.css`, `web/theme.js`, `web/about.html` |
| Account/deal dedup | `web/domain/account-service.js`, `web/domain/lifecycle-service.js`, `web/domain/dual-write.js`, `web/prep-crm-resolve.js`, `web/postcall.js`, `web/postcall-contact-resolve.js` |
| Omni search | `web/search-service.js`, `web/global-search.js`, `web/app.js`, `web/index.html`, `web/styles.css`, `worker/src/search/rag-search.ts`, `worker/src/routes.ts` |
| Form validation | `web/prep-linkedin-pdf.js`, `web/precall.js`, `web/precall.css` |
| Recent news | `worker/src/prep/company-news.ts`, `worker/src/research/providers/company-news-search.ts`, `worker/src/prep/index.ts`, `web/precall-brief-v9.js`, `web/recent-news.js` |
| Fish sizing | `worker/src/prep/rivals.ts`, `worker/src/prep/rivals-context.ts`, `worker/src/schema.ts`, `web/precall-brief-v9.js` |
| Brief list & context | web/briefs-list-view.js, web/app.js, web/precall.js, web/precall-brief-v9.js, worker/src/prep/context-field-router.ts, web/prep-se-context.js |
| Tests | `web/scripts/test-contact-deal-mapping.mjs`, `web/scripts/test-search-service.mjs`, `worker/scripts/test-company-news.ts`, `worker/scripts/test-rivals-context.ts`, `web/scripts/test-precall-render.mjs` |
| Cost control | `docs/COST_CONTROL.md`, `deploy/gcp/setup-billing-budget.sh`, `deploy/vps/.env.example`, `worker/src/cost-control-config.ts`, `worker/src/data/token-budget.ts`, `worker/src/data/usage-anomaly.ts`, `worker/scripts/test-cost-control.ts` |
| VPS deploy doc | `docs/VPS_DEPLOY.md`, `deploy/vps/cron-batch.sh` |
| Release notes | `docs/RELEASE_2.1.md`, `worker/src/build-id.ts` |

### Verify locally

```bash
# Account/deal dedup regression
node web/scripts/test-contact-deal-mapping.mjs

# Search service smoke tests
node web/scripts/test-search-service.mjs

# Account view smoke tests
node web/scripts/test-account-view.mjs

# Worker unit tests
cd worker && npx tsx scripts/test-company-news.ts && npx tsx scripts/test-rivals-context.ts

# UI render tests
cd web && node scripts/test-precall-render.mjs

# Manual: open pre-call form â€” repeat search for same company should show "Existing account";
# âŒ˜K search should show filter chips, recently searched/viewed, and RAG-ranked results when worker is up;
# clicking an account from search should open account overview (not "Could not load this account").
```

### Push workflow (branch 2.1)

Production VPS deploys from **Tony's repo** (`https://github.com/antonyanbu25/lionpath_V2.git`). On your **dev machine**, add remote **`antony`** and push branch `2.1` there — not to `origin` (`skut264/lionpath`, which can lag Tony's `2.1`):

```bash
git checkout 2.1
git push antony 2.1
```

On the **VPS**, the git remote is named **`origin`** (same Tony repo). Pull with `bash deploy/vps/update.sh` or `git pull origin 2.1` — there is no `antony` remote on the server.

**Branch `2.0.2`** introduced the account-centric layer (lifecycle, contacts, MEDDPICC, artifacts). **`2.0.3`** adds per-contact enrichment, improved discovery prep layout, and account/sidebar UX polish. **`2.0.4`** adds Kaia-backed DISC inference, industry customer-reference links, Gemini/SSO reliability fixes, and faster login/boot through targeted refactors. **`2.0.5`** merges **`2.0.4`** with deeper Kaia integration (`POST /api/kaia/share-content`, research hash v2). **`2.0.6`** ships **CRM-style navigation**: separate **Accounts** and **Deals** objects, account overview vs opportunity workspace, and **MEDDPICC stored on deals** â€” see **[docs/adr/004-account-record-crm-ia.md](./docs/adr/004-account-record-crm-ia.md)** and **[docs/adr/005-meddpicc-on-deal.md](./docs/adr/005-meddpicc-on-deal.md)**. **`2.0.7`** (WIP) refactors post-call into a **multi-pass pipeline** under `worker/src/postcall/` â€” resolve â†’ classify â†’ generate â†’ qualify â†’ ARR â†’ gaps â†’ summarise â€” with `POST /api/analyze-call` kept as a legacy facade.

---

## Key features (branch `2.0.7` â€” WIP)

### Multi-pass post-call pipeline

Post-call analysis is being split into explicit passes (UI and worker still evolving):

| Pass | Route | Purpose |
|------|-------|---------|
| 0 | `POST /api/postcall/resolve` | Match recording to account/deal (no LLM) |
| 1 | `POST /api/postcall/classify` | Call type classification (cheap LLM) |
| â€” | `POST /api/postcall/generate` | Core analysis generation |
| 4 | `POST /api/postcall/qualify` | MEDDPICC qualification |
| ARR | `POST /api/postcall/arr-inputs`, `/arr-compute` | Extract pricing inputs; compute ARR |
| 6 | `POST /api/postcall/gaps` | Product gaps + what landed |
| 7 | `POST /api/postcall/summarise` | Commitments, call notes, MoM (never auto-send) |
| 2 | `POST /api/video-pass` | **Pass 2** â€” slide/PPT + screen-share inference via **Gemini** (transcript); optional ffmpeg on VPS |
| Legacy | `POST /api/analyze-call` | Facade â€” auto-pick + generate (existing UI) |

Implementation lives in `worker/src/postcall/` (17 modules) plus `worker/src/video/` for Pass 2.

### Bugfixes in `2.0.7` (this release)

| Issue | Fix |
|-------|-----|
| Post-call not in sidebar history | Refresh sidebar immediately after save; await history sync (no fire-and-forget race) |
| Call page â€œcould not load your profileâ€ | Re-sync session before `renderCallView`; stable `userId` fallback when Firestore upsert fails |
| Pass 2 / Sample video fails without ffmpeg | Gemini transcript inference (`gemini-3.1-flash-lite`) â€” detects slides/PPT/product share segments; ffmpeg optional on VPS |
| Post-call empty page after re-run / nav back | `resetPostCallView()` restores intake form when returning to Post-call (unless generation is in progress) |
| Slow first post-call Pass 2 | Strategic ffmpeg windows (10%/30%/60%/90%/closing 1min) instead of full-call 10s scan; transcript path when no face consent |
| Duplicate names in â€œWho was in the roomâ€ | Normalized person-key dedupe in call record + post-call identity pickers |
| Camera on/off per SE/AE/Customer | Gemini vision on strategic windows; average on vs off seconds per participant |
| Accounts / Deals â€œcould not loadâ€ on SSO | `effectiveSessionUserId` + owner-scoped Firestore queries; `safeStoreOp` swallows permission errors; history fallback rows from localStorage |
| Call timeline misaligned vs wireframe | Horizontal spine + legend + inline markers + 5-metric row (SE talk ratio, customer questions, longest monologue, SE camera, customer cameras); removed phase list |
| Call record tabs / QIP grid misaligned | Wireframe v4 native tabs + 5-column scorecard grid (Theme / Score / Weighted / Conf) |
| Calls list slow first paint | Render from local history immediately; enrich deal/account labels in parallel |

**Pass 2 vision models** (see `worker/src/video/`):

| Path | Model | Used for |
|------|--------|----------|
| Transcript inference (`transcript-infer.ts`) | `gemini-3.1-flash-lite` (default via `POSTCALL_MODEL`) | Slides/PPT segments, share %, per-participant talk/cam when no ffmpeg |
| Keyframe vision (`vision.ts`) | Same Gemini model on strategic-window JPEG keyframes (VPS + ffmpeg) | SE/AE/customer camera on/off (averaged windows), PPT/deck detection, CDE customization |

Participant **cam On/Off** defaults to **Off** when Pass 2 has no camera signal. PPT/slide detection runs on both paths via segment types `slides`, `product`, `cde`.

**Call record UI** (`#calls/:id`): QIP / MEDDPICC / traction / confidence verdict strip, deal context header, call notes + participants, timeline (â€œHow the N minutes wentâ€), scorecard tabs â€” see [wireframe v4](./docs/wireframes/se-singha-paathai-v4.html).

**Local testing:** requires `GEMINI_API_KEY` in `worker/.dev.vars` for prep, post-call passes, and Pass 2. Dummy login: `se@freshworks.com` / `se123`.

```bash
# From repo root â€” web UI + worker API
cd web && npm run dev:all
# Worker only (if not using dev:all)
cd worker && npm run dev:node
```

Pass 2 no longer requires ffmpeg locally when a transcript is present (Zoom resolve or pasted VTT). VPS deploy still benefits from ffmpeg for keyframe vision when available.

**Branch `2.0.2`** introduced the account-centric layer (lifecycle, contacts, MEDDPICC, artifacts). **`2.0.3`** adds per-contact enrichment, improved discovery prep layout, and account/sidebar UX polish. **`2.0.4`** adds Kaia-backed DISC inference, industry customer-reference links, Gemini/SSO reliability fixes, and faster login/boot through targeted refactors. **`2.0.5`** merges **`2.0.4`** with deeper Kaia integration (`POST /api/kaia/share-content`, research hash v2). **`2.0.6`** ships **CRM-style navigation** (Accounts / Deals, MEDDPICC on deals) plus a **call-ready Discovery tab** â€” account + people above the fold, collapsed signals grid, discovery kit closer to the top, and **Research extras** (Support JD + sources). See **[docs/adr/004-account-record-crm-ia.md](./docs/adr/004-account-record-crm-ia.md)** and **[docs/adr/005-meddpicc-on-deal.md](./docs/adr/005-meddpicc-on-deal.md)**.

---

## Key features (branch `2.0.6`)

### CRM navigation â€” Accounts, Deals, and opportunities

Freshsales-style object nav in the sidebar:

| Nav | List | Detail |
|-----|------|--------|
| **Accounts** | Companies you work | **Account overview** â€” contacts, deal team, opportunities table (`#accounts/{id}`) |
| **Deals** | All opportunities across those accounts | **Opportunity workspace** â€” same command deck as account drill-down (`#deals/{dealId}` or `#accounts/{id}/deals/{dealId}`) |

**Opportunity workspace (compact command deck):**

- Summary row â€” primary contact, primary SE, last activity, **Type** (New business / Expansion)
- **Sales stage** stepper only (no separate â€œDealâ€ sub-header; handoff-to-expansion removed from UI for now)
- Three columns â€” contacts, activity/preps/post-calls/tasks, deal team + **MEDDPICC on the selected deal**
- Changing **Type** updates which deal/lifecycle is in context for the next prep or post-call

**Domain & docs:**

- First-class **Deal** records (`web/domain/deal-service.js`); prep/post-call merge MEDDPICC onto **`Deal.metadata.meddpicc`** ([ADR 005](./docs/adr/005-meddpicc-on-deal.md))
- Hash routes documented in **[docs/ENTITY_CATALOG.md](./docs/ENTITY_CATALOG.md)** (`#deals`, `#deals/{dealId}`, account variants)
- Wireframes: [account-record-v4-1b-compact-command.md](./docs/wireframes/account-record-v4-1b-compact-command.md)

**Tests:** `cd web && npm test` â€” includes `test-account-view`, `test-deal-view`, `test-deal-meddpicc`, `check-meddpicc-writes`, `test-precall-render`, `test-prep-se-context`.

### Discovery tab â€” call-ready layout (Option A)

Pre-call **Discovery** brief layout optimized for â€œwho is this company and who am I talking to?â€ before the call:

| Zone | Contents | Default |
|------|----------|---------|
| **Above the fold** | Account facts (2-line about, ICP in `<details>`) \| People hero (DISC, 1-line experience, top 4 skills) | Visible |
| **Mid page** | **Tech stack & signals** â€” 2Ã—3 grid, â€œN foundâ€ summary | Collapsed `<details>` |
| **Actions** | Fit comparison strip \| Discovery kit + Likely pain points | Visible |
| **Deep reference** | **Research extras** â€” Support agent JD + Sources & confidence | Collapsed `<details>` |

**Trust tiers on facts and signals:**

- **Verified** â€” cited web/LinkedIn source with confidence â‰¥ 55%
- **Your notes** â€” values from SE **additional context** (`sourceLabel: SE`), not labeled Unverified
- **Unverified** â€” research-only gaps that still need validation on the call

**SE additional context â†’ signals:**

- Notes in the prep form (e.g. â€œthey use Zendeskâ€, â€œ50 agentsâ€) map into the six canonical signal slots on **first generate** â€” client (`web/prep-se-context.js`) and worker (`worker/src/prep/se-context-facts.ts`)
- Reliable `fw-textarea` read on submit (`web/crayons-ui.js`, `web/precall.js`)

Empty signal slots stay visible as muted **Not found** (all six labels preserved for scan consistency).

---

## Key features (branch `2.0.5`)

### Kaia share-content hardening

- **Primary API:** `POST /api/kaia/share-content` with `{ url }` returns summary plus participants/metadata for prep and enrich
- **Legacy alias:** `POST /api/fetch-kaia-summary` with `{ kaiaUrl }` (2.0.4 precall compat)
- **Per-prospect excerpts** from Kaia `summaryJson` speaker tags; research input hash includes Kaia ref + additional context fingerprint
- **Worker-side cache/retry** on public Engage share links (~15 min TTL per isolate)

### Carried from `2.0.4`

See **Key features (branch `2.0.4`)** below for Kaia DISC badges, customer reference links, SSO/Accounts fixes, and boot performance refactors.

---

## Key features (branch `2.0.4`)

### Kaia DISC enrichment & source badges

- **Optional Kaia share URL** on the prep form â€” worker fetches meeting summary text via `POST /api/fetch-kaia-summary` and merges it into contact enrichment
- **DISC source labels** â€” chips show **Kaia**, **LinkedIn + Kaia**, or other merged sources so SEs know where inference came from
- Enrichment still supports LinkedIn PDF, Zoom excerpts, and notes â€” see **[docs/CONTACT_ENRICHMENT.md](./docs/CONTACT_ENRICHMENT.md)**

### Industry customer reference links

- Pre-call briefs link to the right **Seismic customer reference deck** based on detected industry (BFSI, education, logistics, manufacturing, e-commerce, high-tech, and more)
- Fallback to General B2B when industry is ambiguous â€” `web/customer-reference-links.js`

### Merged from `2.0.3`

Branch **`2.0.4`** ships on top of the full **`2.0.3`** release (merged onto main):

| Area | What changed | Why |
|------|--------------|-----|
| **Contact enrichment** | Worker enrich API, prep merge, DISC/influence on account contacts | Richer prospect context before discovery calls |
| **Accounts UX** | Accordion contacts, MEDDPICC readability, deal team grid, sidebar brief dedupe | Cleaner CRM-style account detail at a glance |
| **Activity feed** | Day-grouped timeline; **10 most recent** + **Show all activities** (no event merging) | Easier scan of team activity on an account |

See **[docs/CONTACT_ENRICHMENT.md](./docs/CONTACT_ENRICHMENT.md)** and the **`2.0.3`** key-features section below for full detail.

### Reliability & performance (`2.0.4`)

| Area | What changed | Why |
|------|--------------|-----|
| **Gemini prep** | Slim `PREP_SCHEMA`, tuned `thinkingLevel` for `google_search`, default `gemini-3.1-flash-lite` | Fixes intermittent prep 400 errors on AI Studio keys |
| **SSO / VPS boot** | Restore `isFirebaseAuthEnabled`, bust stale auth JS cache, localhost-only boot diagnostics | Prevents login flash and SSO failures after deploy |
| **Login sync** | Parallel history + task fetch on sign-in | Faster dashboard populate after auth |
| **Local store** | In-memory read cache (cleared on logout) | Snappier accounts/sidebar navigation |
| **Dashboard** | Cached `normalizeQualityCoach` in aggregation; bulk-resolve SE emails for team metrics | Less repeated work when rendering coaching charts |
| **Firestore / store** | 30s TTL read cache on `getById`; cap list queries at 200 | Safer performance as artifact volume grows |

### Boot & maintainability refactors (`2.0.4`)

Ten focused refactors â€” no user-facing behavior change, easier to extend and debug:

1. **`web/shared.js`** â€” shared `esc`, `$`, `show`, `normalizeUserEmail` utilities
2. **`web/chart-shared.js`** â€” extracted radar/gauge chart helpers
3. **`agentBootLog`** â€” debug logging gated to localhost only
4. **Prep disputes** â€” simplified inline boot; removed `MutationObserver`
5. **Parallel login** â€” history and task sync run concurrently in `loadPersistedHistory`
6. **Sidebar** â€” recent-work click handling delegated in app boot
7. **`local-store.js`** â€” in-memory cache with logout clear
8. **Dashboard QC** â€” cache normalized Quality Coach scores during aggregation
9. **Post-call boot** â€” listener wiring deferred until app boot completes
10. **Worker routes** â€” route map with named handlers in `worker/src/routes.ts`

---

## Key features (branch `2.0.3`, still included)

### Accounts â€” CRM-style detail (Crayons UI)

- **Accounts list** â€” filter by company, domain, contact, or stage; open any account for full context
- **Account overview** â€” opportunities list, contacts, deal team (no full pursuit deck on the account shell)
- **Opportunity** â€” open from account row or **Deals** nav; pursuit pipeline + MEDDPICC + artifacts
- **Deals list** â€” sidebar **Deals**; filter cross-account opportunities; same opportunity UI on drill-down
- **Account detail wireframe (v2)** â€” [docs/wireframes/account-record-v2.md](./docs/wireframes/account-record-v2.md)
- **Account detail usability (v2.1 left column)** â€” [docs/wireframes/account-record-v2.1-left-column.md](./docs/wireframes/account-record-v2.1-left-column.md)
- **Compact command deck (v4 1b)** â€” [docs/wireframes/account-record-v4-1b-compact-command.md](./docs/wireframes/account-record-v4-1b-compact-command.md)
- **Lifecycle pipeline** â€” open stages (Research â†’ Business case) as a stepper; terminal outcomes (Closed won / lost / Nurture) as separate actions (replaces stage dropdown)
- **Contacts** â€” `fw-card` + accordion per person; primary contact expanded by default; DISC and influence tags when assessed (no noisy â€œnot assessedâ€ chips in headers)
- **MEDDPICC scorecard** â€” on the **active deal** (with account fallback during migration); completion %, field status tags
- **Activity** â€” merged team timeline grouped **by calendar day**; each event shown individually (no merging); **10 most recent** activities plus **Show all activities**; compact rows with actor-only meta under day headers
- **Artifacts** â€” preps deduped by day + company in the list; post-calls and tasks in tabs
- **Sidebar** â€” Discovery briefs deduped by company domain/slug (one row per account)

Domain data lives under `web/domain/` (`account-service`, `contact-service`, `lifecycle-service`, `deal-service`). See **[docs/ENTITY_CATALOG.md](./docs/ENTITY_CATALOG.md)** and **[docs/RELATIONSHIPS.md](./docs/RELATIONSHIPS.md)**.

### Contact enrichment (prep + worker)

- **`POST /api/contact/enrich`** â€” per-contact research profile, inferred DISC, merge into prep and account contacts
- Prep UI injects enrichment progress; see **[docs/CONTACT_ENRICHMENT.md](./docs/CONTACT_ENRICHMENT.md)**

### Discovery prep layout

- **`2.0.6` â€” Option A (call-ready scroll):** Account \| People grid first; collapsed signals accordion; fit; discovery kit \| pains; collapsed Research extras (JD + sources). See **Key features (branch `2.0.6`)** above.
- **`2.0.3` â€” prior layout:** Two-row Account facts + Signals; full-width People with hero DISC and prospect tabs when multiple emails

### Org hierarchy & access (Freshworks seed)

- Director â†’ senior leaders â†’ squad managers â†’ ICs; scoped visibility for artifacts and coaching views
- Profile settings (display name, avatar), user menu, theme â€” see **[docs/RBAC.md](./docs/RBAC.md)** and **[docs/adr/002-org-hierarchy.md](./docs/adr/002-org-hierarchy.md)**

### Pre-call â€” v3 one-pager

- **Comparison hero table** â€” This company vs industry norm across industry, size/agents, support channels, incumbent stack, integrations, and more
- **Bullet sections** â€” About the business, support process, workflows
- **SE playbook grid** â€” Top use case, pain points, discovery-gap questions, demo flow steps
- **Collapsible sources** â€” Cited URLs for prospect facts; gaps say "unknown" rather than being invented
- **Smarter domain handling** â€” Company name is the primary research target; the UI warns on likely email-domain typos (e.g. `khanacademey.org` â†’ `khanacademy.org`)

**Typical wait:** 15â€“45 seconds (Gemini + web research).

### Post-call â€” redesigned one-pager

Mirrors the pre-call layout for a consistent SE experience:

- **Comparison hero** â€” This call vs follow-up across key call dimensions
- **Bullet sections** â€” Discussion highlights, pains & objections, competitive mentions & decisions, open questions
- **SE playbook grid** â€” Top priority action, SE/AE tasks, customer commitments
- **Quality Coach** â€” Six-dimension rubric (Discovery, Demo alignment, Objections, Value articulation, Next-step clarity, Talk balance) with scores, evidence, strengths, and improvements
- **Collapsible sources** â€” Suggested follow-up email, CRM notes, transcript details

**Typical wait:** 10â€“25 seconds (Zoom transcript fetch + Gemini analysis).

### UI/UX overhaul

- Fluid, professional dashboard layout with a soothing teal/blue palette
- **Dark mode toggle** â€” persisted in browser localStorage
- Responsive sidebar with call history and quality-score badges
- Print / PDF and copy-to-clipboard on every result

### Lion splash (first visit)

A 5-second branded animation with a lion roar plays on the **first visit to the portal** (cookie-based, `index.html` only). Returning users go straight to the app.

### Post-call intelligence

- **Gemini** structured JSON extraction from Zoom audio transcripts
- **Quality scorecard** calibrated for honest, evidence-based coaching (not cheerleading)
- **Zoom integration** â€” paste share link + passcode; no Zoom OAuth required for MVP
- **Server-side history** on VPS production â€” analyses sync across sessions via the worker API; local dev falls back to browser storage

### Authentication (demo)

| Role | Email | Password |
|------|-------|----------|
| **SE** | `se@freshworks.com` | `se123` |
| **SE (alt)** | `se1@freshworks.com` / `se2@freshworks.com` | `se123` |
| **Manager** | `manager@freshworks.com` | `mgr123` |

Production uses **Firebase Google SSO** with `@freshworks.com` domain restriction. See **[docs/FIREBASE_SETUP.md](./docs/FIREBASE_SETUP.md)** to enable real login (dummy mode remains when `projectId` is empty).

---

## Screenshots & views (no images attached)

| View | What an SE sees |
|------|-----------------|
| **Login** | Branded sign-in with demo credential hints |
| **My dashboard** | Rolling quality averages, radar chart, score trend, recent calls table |
| **Pre-call prep** | Company + email form â†’ v3 one-pager with comparison table and SE playbook |
| **New analysis** | Zoom link form â†’ redesigned post-call one-pager with Quality Coach |
| **History (sidebar)** | Past analyses with quality scores; click to reload any call |
| **Accounts** | Company list â†’ overview (contacts, opportunities) or open an opportunity |
| **Deals** | All opportunities â†’ pipeline, MEDDPICC, activity (same workspace as account drill-down) |
| **Manager view** | Placeholder team dashboard (rollup planned â€” see Roadmap) |

For a leadership-friendly walkthrough of post-call flow and FAQ, see **[docs/POST_CALL_OVERVIEW.md](./docs/POST_CALL_OVERVIEW.md)**.  
For a browser-friendly product summary, see **[web/about.html](./web/about.html)**.

---

## Architecture (brief)

```
Browser (web/)  â”€â”€HTTPSâ”€â”€â–º  Worker API (worker/)  â”€â”€â–º  Gemini (default) or Claude
       â”‚                           â”‚
  Firebase Auth (optional)     API keys (server secrets only)
  localStorage / Firestore     Zoom share API â†’ VTT transcript
                               File/KV history (VPS / Cloudflare)
```

| Layer | Role |
|-------|------|
| **`web/`** | Static portal â€” pre-call, post-call, dashboard, **accounts**, **deals**, history, profile, Crayons (Freshworks Dew) |
| **`worker/`** | API server â€” `/api/generate-prep`, `/api/analyze-call`, `/api/contact/enrich`, `/api/fetch-kaia-summary`, `/api/history`, Zoom transcript fetch |
| **VPS (production)** | Docker Compose + Caddy HTTPS â€” see **[docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md)** |
| **LLM** | Gemini 3.1 Flash Lite (default) â€” web search for pre-call; structured JSON for post-call |

**Why a worker instead of browser-side AI?** API keys stay server-side; one pipeline keeps schema, scoring, and prompts consistent for every SE.

---

## Recent updates

| Area | What changed |
|------|--------------|
| **`2.1` â€” Pre-call validation** | LinkedIn PDF required per prospect email before Generate brief |
| **`2.1` â€” Recent news** | Parallel Gemini + Google News RSS + DDG + newsroom fallback; article links; RSS HTML stripped from detail; no SE-context / research-fact backfill |
| **`2.1` â€” Fish sizing** | Parallel grounded rivals + AE context; web benchmark bars + supplemental INPUT rows; requirement lines filtered out |
| **2.1 — All briefs list** | Brief Generated KPI → searchable briefs under Pre-call; #precall/briefs routes |
| **2.1 — Research Extras** | High confidence for SE/context Additional Context; smarter field routing; unknown alignment removed from brief |
| **`2.0.6` â€” Discovery UX** | Call-ready Discovery tab (Option A): account/people hero, collapsed 2Ã—3 signals grid, kit/pains up, Research extras; SE context â†’ signals on first generate; **Your notes** trust badge |
| **`2.0.6` â€” CRM IA** | Accounts overview vs opportunity routes; **Deals** sidebar + `#deals/{id}`; Type in summary row; MEDDPICC on deal ([ADR 004](./docs/adr/004-account-record-crm-ia.md), [ADR 005](./docs/adr/005-meddpicc-on-deal.md)) |
| **`2.0.5` â€” Kaia** | `POST /api/kaia/share-content`, research hash v2, per-prospect excerpts â€” [CONTACT_ENRICHMENT.md](./docs/CONTACT_ENRICHMENT.md) |
| **`2.0.4` â€” Kaia DISC** | Optional Kaia share URL fetch; source badges on DISC chips and prospect tabs |
| **`2.0.4` â€” Customer refs** | Industry-mapped Seismic customer reference links on pre-call briefs |
| **`2.0.4` â€” Gemini / SSO** | Prep schema + thinkingLevel fixes; SSO export restore; VPS auth cache bust |
| **`2.0.4` â€” Performance** | Parallel login sync, local-store cache, dashboard QC cache, Firestore TTL + query caps |
| **`2.0.4` â€” Refactors** | shared.js, chart-shared.js, disputes, sidebar boot, deferred post-call, worker route map |
| **`2.0.4` â€” Main sync** | Merged `2.0.3` contact enrichment, accounts UX, and activity feed onto main |
| **`2.0.3` â€” Contact enrichment** | Worker enrich API, prep merge, DISC/influence on contacts; docs in `CONTACT_ENRICHMENT.md` |
| **`2.0.3` â€” Discovery UX** | Account facts + signals grid, people hero/tabs, nested tab fix for multi-prospect preps |
| **`2.0.3` â€” Accounts & sidebar** | Accordion layout, MEDDPICC readability, deal team grid, sidebar brief dedupe by domain |
| **`2.0.3` â€” Activity feed** | Day sections, show 10 then **Show all** (no event merging) |
| **`2.0.2` â€” Accounts CRM** | Lifecycle pipeline stepper, Crayons cards/accordions/tags, MEDDPICC scorecard, two-column detail layout |
| **`2.0.2` â€” Contact intelligence** | DISC + influence on contacts; MEDDPICC on accounts; merge from prep/post-call; contact events |
| **`2.0.2` â€” Org** | Freshworks org seed, hierarchy scopes, profile UX, expanded `npm test` in `web/` |
| **Pre-call v3** | Comparison table, bullet sections, SE playbook grid, collapsible sources |
| **Post-call redesign** | Mirror pre-call layout â€” Quality Coach, playbook grid |
| **UI/UX** | Dew/Crayons theme, dark mode, responsive dashboard |
| **Production deploy** | VPS at `lionpath.benjaminsquare.com` + `lionpathapi.benjaminsquare.com` |

---

## Roadmap

| Item | Status |
|------|--------|
| **Firebase Google SSO** | Config ready; enable when project ID is set |
| **Firestore history** (cross-device, durable) | Rules exist; wired when Firebase is on |
| **Manager team dashboard** | Rollup across SEs â€” placeholder view exists today |
| **Formal manager-approved rubric** | Replace MVP AI calibration with signed-off criteria |
| **Zoom OAuth** | Optional â€” for accounts where share links are restricted |
| **Manual VTT upload in UI** | API supports it; UI is link-first today |

---

## Team quick start

### For SEs (daily use) â€” no install

1. Open **https://lionpath.benjaminsquare.com**
2. Log in (`se@freshworks.com` / `se123`)
3. **Before a call:** Pre-call prep â†’ company + email + context â†’ brief
4. **After a call:** New analysis â†’ Zoom link â†’ summary, next steps, Quality Coach
5. **Accounts / Deals:** Sidebar â†’ review companies or opportunities, run prep/post-call from the opportunity workspace

### For developers (local laptop â€” Windows PowerShell)

**Auth on localhost:** Production uses Firebase Google SSO, but **`localhost` is not in Firebase authorized domains** for most setups. For local dev, use **dummy login** â€” do **not** create `web/firebase-config.local.js` unless you have added `localhost` in Firebase Console (see **[docs/FIREBASE_SETUP.md](./docs/FIREBASE_SETUP.md)**).

| Mode | Setup | Login |
|------|-------|-------|
| **Dummy auth (recommended locally)** | Leave `firebaseConfig.projectId` empty (default) | `se@freshworks.com` / `se123` |
| **Firebase SSO locally** | Copy `web/firebase-config.local.example.js` â†’ `web/firebase-config.local.js`, add `localhost` to Firebase **Authorized domains** | Google `@freshworks.com` |

**One-time setup:**

```powershell
git clone https://github.com/skut264/lionpath.git
cd lionpath
git checkout 2.0.7
cd worker
Copy-Item .dev.vars.example .dev.vars
# Edit .dev.vars â€” set GEMINI_API_KEY from https://aistudio.google.com/apikey
npm.cmd install
cd ..\web
npm.cmd install
```

**Run (pick one):**

```powershell
# Option A â€” one terminal (recommended)
cd web
npm.cmd run dev:all
# â†’ worker http://localhost:8787  +  web http://localhost:8788

# Option B â€” two terminals
cd worker; npm.cmd run dev:node    # terminal 1 â†’ :8787
cd web;    npm.cmd run dev         # terminal 2 â†’ :8788
```

Open **http://localhost:8788** â†’ sign in with **`se@freshworks.com` / `se123`**.

**Notes:**

- `worker/.dev.vars` must include **`GEMINI_API_KEY`** â€” required for pre-call prep and post-call API passes.
- SSO / Google sign-in **will not work** on localhost until `localhost` is added in Firebase Console â†’ Authentication â†’ Settings â†’ Authorized domains.
- `web/firebase-config.js` already points local hosts at `http://localhost:8787` for the worker API.

**Tests (web):** `cd web; npm.cmd test`

Full onboarding (tunnel sharing, team handoff): **[TEAM_SETUP.md](./TEAM_SETUP.md)**

### Team development workflow

1. Branch from **`2.0.7`** (or `2.0.6` for stable CRM) â€” e.g. `feature/my-change`
2. Develop and test locally (`npm.cmd run dev:all` or two terminals); run `cd web; npm.cmd test`
3. Push to **`origin`** and open a **pull request** into `2.0.7` / `2.0.6`
4. Deploy production from the branch your team tags for release â€” see Deploy section below

---

## Documentation

| Doc | Audience |
|-----|----------|
| [web/about.html](./web/about.html) | Boss / SEs â€” what the portal does (browser-friendly) |
| [docs/POST_CALL_OVERVIEW.md](./docs/POST_CALL_OVERVIEW.md) | Leadership demo â€” post-call flow, Quality Coach, FAQ |
| [docs/SHARE_WITH_TEAM.md](./docs/SHARE_WITH_TEAM.md) | SEs & managers â€” team share pack |
| [docs/CONTACT_ENRICHMENT.md](./docs/CONTACT_ENRICHMENT.md) | Developers â€” enrich API, prep merge, DISC inference |
| [docs/adr/003-account-deal-engagement.md](./docs/adr/003-account-deal-engagement.md) | Developers â€” Account, Deal, lifecycle engagement |
| [docs/adr/004-account-record-crm-ia.md](./docs/adr/004-account-record-crm-ia.md) | Developers â€” Accounts vs opportunity UI |
| [docs/adr/005-meddpicc-on-deal.md](./docs/adr/005-meddpicc-on-deal.md) | Developers â€” MEDDPICC on deal records |
| [docs/HLD.md](./docs/HLD.md) Â· [docs/LLD.md](./docs/LLD.md) | Developers â€” high/low level design |
| [docs/ENTITY_CATALOG.md](./docs/ENTITY_CATALOG.md) | Developers â€” domain entities (Account, Deal, Contact, â€¦) |
| [docs/RELATIONSHIPS.md](./docs/RELATIONSHIPS.md) | Developers â€” how entities link |
| [docs/RBAC.md](./docs/RBAC.md) | Developers â€” roles and visibility |
| [TEAM_SETUP.md](./TEAM_SETUP.md) | Developers â€” local setup, tunnel sharing, onboarding |
| [docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md) | IT / admin — VPS deploy (`lionpath` + `lionpathapi` URLs) |
| [docs/COST_CONTROL.md](./docs/COST_CONTROL.md) | IT / admin — billing budgets, Gemini quotas, daily token ceiling, Pass 7 anomaly alerts |
| [docs/CALL_SUMMARIES.md](./docs/CALL_SUMMARIES.md) | IT / admin — `callSummaries` indexes, backfill, GCS offload |
| [deploy/vps/SECURITY.md](./deploy/vps/SECURITY.md) | IT / admin â€” secrets, SSH, file permissions |

---

## Deploy

### Option A â€” VPS (production â€” `lionpath.benjaminsquare.com`)

See **[docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md)**. Stack: Caddy HTTPS, nginx web, Node worker, file-based history at `/var/lib/se-paathai/history`.

**Deploy branch `2.1` on the VPS** (remote **`origin`** → `antonyanbu25/lionpath_V2`):

```bash
cd /opt/se-singha-paathai/deploy/vps && bash update.sh
```

Manual equivalent:

```bash
cd /opt/se-singha-paathai
git fetch origin
git checkout 2.1
git pull origin 2.1
cd web && npm ci && npm run build   # production portal hosts need web/dist/
cd ../deploy/vps
docker compose build --no-cache worker web
docker compose up -d
# If Caddyfile changed:
docker compose restart caddy
```

**Quick upgrade** (same as `update.sh`):

```bash
cd /opt/se-singha-paathai/deploy/vps && bash upgrade-now.sh
```

**Stable production today:** branch **`2.1`**.

First-time setup:

```bash
cd /opt/se-singha-paathai/deploy/vps
./setup.sh    # once
nano .env     # GEMINI_API_KEY, ALLOWED_ORIGINS=https://lionpath.benjaminsquare.com
./start.sh
```

**Background jobs (Gemini Batch, branch `2.1`):** Non-interactive workloads (gap cluster labels, Pass 9 summary rollups, embedding backfill) use the [Gemini Batch API](https://ai.google.dev/gemini-api/docs/batch-api) at ~50% cost. Interactive prep/post-call paths are unchanged.

| Workload | Trigger | Notes |
|----------|---------|--------|
| Gap cluster labels | After Pass 6 clustering | Heuristic labels first; batch updates labels async |
| Deal/account summaries (Pass 9) | After post-call dual-write | Fire-and-forget; inline fallback if enqueue fails |
| Embedding backfill | Nightly cron | `callSummaries`, `accounts`, `deals` |
| Read-model rebuild | Nightly cron | No LLM — Firestore aggregation only |

**Required on worker:** `GEMINI_API_KEY` (Batch uses AI Studio REST even when interactive calls use Vertex) and `INTERNAL_CRON_SECRET`. Wire crons per **[docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md)** § Background jobs, or **[deploy/cloudrun/README.md](./deploy/cloudrun/README.md)** for Cloud Scheduler.

### Option B — Cloudflare Worker + Pages

```bash
cd worker && npx wrangler deploy
cd web && npx wrangler pages deploy .
```

Set `WORKER_BASE_URL` in `web/firebase-config.js` to the production Worker URL; add the Pages origin to `ALLOWED_ORIGINS`.

---

## Developer reference

### Prerequisites

- Node 18+ and `npx`
- Gemini API key (default) or Anthropic key
- Firebase project (optional) â€” portal runs in no-auth preview without it

### Worker â€” smoke tests

```bash
cd worker
npm install
echo 'GEMINI_API_KEY = "your-key"' > .dev.vars
npm run dev   # http://localhost:8787

# Pre-call
curl -s http://localhost:8787/api/generate-prep \
  -H 'content-type: application/json' \
  -d '{"companyName":"Cute cards","prospectEmail":"jenifer@photocards.pt"}' | jq .prep.companySnapshot

# Post-call
curl -s http://localhost:8787/api/analyze-call \
  -H 'content-type: application/json' \
  -d '{"transcript":"SE: Thanks for joining.\nCustomer: We use Zendesk.","companyName":"GetGo"}' | jq .analysis.callSummary.headline
```

Config in `worker/wrangler.toml` (`[vars]`):

- `LLM_PROVIDER` â€” `gemini` (default on VPS) or `anthropic`
- `MODEL` / `EFFORT` â€” pre-call model and reasoning effort
- `POSTCALL_EFFORT` â€” post-call effort (default `low`; no web research)
- `ALLOWED_ORIGINS` â€” CORS (include `https://lionpath.benjaminsquare.com` in prod)
- `ALLOWED_EMAIL_DOMAIN` â€” sign-in restriction (default `freshworks.com`)
- `FIREBASE_PROJECT_ID` â€” empty disables auth; set to enforce ID-token verification

### Model strategy

| Use case | Default model | Latency target |
|----------|---------------|----------------|
| Pre-call (research) | `gemini-3.1-flash-lite` + `google_search` | **15â€“45s** |
| Pre-call (max quality) | `gemini-3.5-flash` or Claude + web search | 30â€“90s |
| Post-call (transcript) | `gemini-3.1-flash-lite` | **8â€“20s** |

- **Grounding:** Freshworks facts from `worker/src/kb.ts`; prospect facts from web research with citations
- **Post-call transcript:** Last ~6k words (~30â€“40 min of speech) for speed
- **Zoom link flow:** `worker/src/zoomShare.ts` â€” share/play URL + passcode â†’ public Zoom APIs â†’ VTT â†’ analysis
