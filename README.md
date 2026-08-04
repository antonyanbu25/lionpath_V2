# Lionpath — SE Singha Paathai

**One portal for Freshworks Solution Engineers:** research a prospect **before** the call, debrief **after** the call, and track **accounts, contacts, and deal progress** in one place.

| | |
|---|---|
| **Current branch** | **`2.1`** — account/deal deduplication, RAG omni-search, session restore, Know tab UI, **LinkedIn PDF required**, **Recent news**, **parallel fish sizing** ([tree/2.1](https://github.com/skut264/lionpath/tree/2.1)) |
| **Previous release** | **`2.0.8.2`** — Know tab pre-call UI ([tree/2.0.8.2](https://github.com/skut264/lionpath/tree/2.0.8.2)) |
| **Earlier release** | **`2.0.5`** — Kaia share-content hardening ([tree/2.0.5](https://github.com/skut264/lionpath/tree/2.0.5)) |
| **Live app** | **[https://lionpath.benjaminsquare.com](https://lionpath.benjaminsquare.com)** |
| **API** | **[https://lionpathapi.benjaminsquare.com](https://lionpathapi.benjaminsquare.com)** |
| **Repo (upstream)** | [github.com/skut264/lionpath](https://github.com/skut264/lionpath) |
| **Fork (contributors)** | [github.com/sowravsunil/singapaathai](https://github.com/sowravsunil/singapaathai) — push here first, then open PR to `lionpath` |
| **Architecture docs** | [docs/HLD.md](./docs/HLD.md) · [docs/LLD.md](./docs/LLD.md) · [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| **Demo login** | `se@freshworks.com` / `se123` |

---

## What it does

Lionpath (SE Singha Paathai) is an internal SE coaching portal with two core workflows:

| Workflow | When to use | What you get |
|----------|-------------|--------------|
| **Pre-call prep** | Before discovery or demo — you have a company name, prospect email, and optional context | A printable one-pager brief: company vs industry comparison, business context, and an SE playbook |
| **Post-call analysis** | After a recorded customer call — you have a Zoom cloud recording link | Call summary, prioritized next steps (including follow-up email + CRM notes), and a Quality Coach scorecard |

Both flows share the same polished one-pager layout, personal dashboard, and sidebar history — so SEs stay in one place from prep through debrief.

---

## Pre-call improvements (branch `2.1`)

### Login page (2.1.11)

Centered sign-in restored from **`2.0.8.1-merge`** — full-screen ambient video background with a white card in the middle:

| Item | Detail |
|------|--------|
| **Layout** | Full-viewport video background; centered card with Freshworks logomark, heading, and **Sign in with Google** |
| **Branding** | Freshworks logomark in card + **browser favicon** (`assets/freshworks-logomark.webp`) |
| **Dark mode** | Top-right crescent moon toggle with slow glow pulse (4s loop); sun icon when dark mode is active |
| **Animations** | Gentle card entrance, staggered field fade-in, subtle video drift, button hover lift — all respect `prefers-reduced-motion` |
| **SSO** | Google sign-in pill on production; demo email/password on localhost |

Key paths: `web/index.html`, `web/styles.css`, `web/theme.js`.

After deploy, hard-refresh the portal (Ctrl+Shift+R) to pick up the new favicon and CSS cache bust.

### Account / deal deduplication & linking (2.1)

| Issue | Fix |
|-------|-----|
| **Duplicate accounts** on repeat search | `upsertAccountFromPrep` now honours explicit `accountId`, domain lookup, and slug resolution — CRM-selected accounts are reused instead of re-derived from typed shorthand |
| **Duplicate deals** when not intended | `getOrCreateLifecycle` handles `createNewDeal` by archiving the old spine and calling `createDealWithExplicitTitle`; repeat briefs reuse the active deal |
| **Post-call account ignored** | `linkPostCallToLifecycle` respects `accountId` and `createNewAccount` flags from intake |
| **Misleading UI labels** | Pre-call and post-call badges now show **Existing account** / **New account · on generate** (or **on confirm**) instead of always implying creation |
| **Repeat pre-call search** | CRM resolve panel reuses existing account/deal on repeat email search instead of showing "new account" (`ed48285`) |

Key modules: `web/domain/account-service.js`, `web/domain/lifecycle-service.js`, `web/domain/dual-write.js`, `web/prep-crm-resolve.js`, `web/postcall.js`.

Regression: `node web/scripts/test-contact-deal-mapping.mjs`

### RAG-powered omni search (2.1)

Freshdesk-inspired global search (⌘K / topbar):

| Feature | Detail |
|---------|--------|
| **Scope** | Accounts, deals, contacts, discovery briefs, call reviews, open tasks |
| **Filter chips** | All · Accounts · Deals · Contacts · Briefs · Calls · Tasks |
| **Recently searched / viewed** | Per-user localStorage with Clear actions |
| **RAG rerank** | Token match locally → `POST /api/search/rag` embedding rerank (Gemini `text-embedding-004`) when worker key is configured |
| **Speed / index** | Sync localStorage history/briefs/calls before Firestore; instant token hits + async RAG rerank (`3aeab26`) |
| **Panel alignment** | Omni-search dropdown anchored to topbar input width/position (`1258713`) |
| **Open from search** | Account/contact/deal result clicks clear stale deal context and open the correct object (`2.1.12`) |
| **Dark theme** | Uses `--dew-*` tokens; filter chips and result rows adapt to `[data-theme="dark"]` |

Key modules: `web/search-service.js`, `web/global-search.js`, `worker/src/search/rag-search.ts`.

---

Three Know-tab fixes ship on the pre-call form and worker pipeline. API routes are unchanged: the UI still calls `POST /api/prep/research` then `POST /api/prep/synthesize` (or the all-in-one `POST /api/generate-prep`).

### 1. LinkedIn PDF — required before Generate brief

| Item | Detail |
|------|--------|
| **Rule** | One LinkedIn “Save to PDF” per prospect email in the form |
| **Validation** | Client-side in `buildPayload()` (`web/precall.js`) via `emailsMissingLinkedInPdf()` (`web/prep-linkedin-pdf.js`) |
| **On failure** | Submit blocked; `#prep-linkedin-error` shows missing emails; rows highlighted with `.nb-linkedin-row-missing` |
| **Why** | Prospect DISC / Do-Don’t profiles and `/api/contact/enrich` need PDF text; briefs without PDFs were too thin on “Who is in the room” |

LinkedIn PDFs are extracted in-browser (pdf.js, max 5 files × 2 MB, 20k chars text) and sent to the worker as `linkedinProfileExports: [{ fileName, text }]`.

### 2. Recent news — real web articles only

The **Recent news** card (Know tab, row 1) no longer back-fills from research facts or SE typed context.

| Stage | Module | Behaviour |
|-------|--------|-----------|
| **1 — Parallel fetch** | `worker/src/prep/company-news.ts` | **Gemini** `google_search` grounding and **web crawl** run **at the same time** (`Promise.all`), then merged and deduped (up to **5** items) |
| **1a — Redirect resolve** | `worker/src/prep/citations.ts` | Grounding redirect URLs resolved to publisher URLs **before** domain verification |
| **1b — Web crawl** | `worker/src/research/providers/company-news-search.ts` | **Google News RSS** (primary when DDG rate-limits) + **DuckDuckGo** HTML (parallel queries + retries); news-like URLs only (excludes LinkedIn, careers, login) |
| **1c — Newsroom fallback** | same | If RSS + DDG both return 0 (common on VPS), scrape company `/company/newsroom/`, `/press/`, etc. |
| **2 — Detail hygiene** | same + `web/precall-brief-v9.js` | RSS descriptions embed HTML entities — stripped at ingest; UI shows **headline + Read article** only (no raw `&lt;a href=` lines) |
| **3 — Empty state** | `web/precall-brief-v9.js` | “No public company news found yet…” when all stages fail |

| UI | Detail |
|----|--------|
| **Article link** | Each item shows **Read article →** (`prep-v9-news-link`) opening the publisher URL in a new tab |
| **Layout** | Headline, source badge (N1..Nn), and link — no duplicate HTML snippet under the title |
| **Sources** | `prep.newsSources` (N1..Nn labels) separate from main prep `sources` |
| **Debug** | `researchMeta.recentNewsDebug.pipeline` reports `{ gemini, web }` counts after synthesize |
| **No backfill** | `buildRecentNews()` fallback removed from `worker/src/prep/index.ts`; `hydrateRecentNews()` in `web/recent-news.js` no longer rehydrates from cached research bundles |

**Deploy note:** Recent news is generated in the **worker** during `POST /api/prep/synthesize`. Web-only cache bust is not enough — run `bash upgrade-now.sh` on the VPS and generate a **fresh** brief (not an old history entry).

### 3. How big is this fish? — web + AE context in parallel

| Stage | Module | Behaviour |
|-------|--------|-----------|
| **1 — Parallel fetch** | `worker/src/prep/index.ts` | **Grounded rivals** (`rivals.ts`) and **AE context extraction** (`rivals-context.ts`) run **together** when additional context is present |
| **1a — Grounded rivals** | `worker/src/prep/rivals.ts` | Web search for 2–4 market rivals; benchmark bars from sourced headcount / funding / industry axis; redirect URLs resolved before verification |
| **1b — Context supplement** | `worker/src/prep/rivals-context.ts` | LLM extracts **company sizing only** from merged AE context (typed notes + attachments + Kaia); metrics that overlap web axes are deduped |
| **Context filter** | `filterFishContextMetrics()` | Keeps headcount, agents, funding, revenue, volume; **drops** deal requirements (incumbent, integrations, timeline, budget, pain, etc.) even if mis-tagged |
| **2 — Empty state** | `web/precall-brief-v9.js` | “We could not size this account…” when neither stage finds data |

| UI | Detail |
|----|--------|
| **Web sizing** | Horizontal benchmark bars from `prep.rivals.axes` (wireframe-style rail + rival band + prospect dot) |
| **Context supplement** | Non-overlapping AE metrics append below web bars with **INPUT** badge (`prep.fishContext`) |
| **Context-only** | When web finds nothing, full INPUT bar card from AE notes only |

### Files touched (this release)

| Area | Paths |
|------|-------|
| Login refresh | `web/index.html`, `web/styles.css`, `web/theme.js`, `web/about.html` |
| Account/deal dedup | `web/domain/account-service.js`, `web/domain/lifecycle-service.js`, `web/domain/dual-write.js`, `web/prep-crm-resolve.js`, `web/postcall.js`, `web/postcall-contact-resolve.js` |
| Omni search | `web/search-service.js`, `web/global-search.js`, `web/app.js`, `web/index.html`, `web/styles.css`, `worker/src/search/rag-search.ts`, `worker/src/routes.ts` |
| Form validation | `web/prep-linkedin-pdf.js`, `web/precall.js`, `web/precall.css` |
| Recent news | `worker/src/prep/company-news.ts`, `worker/src/research/providers/company-news-search.ts`, `worker/src/prep/index.ts`, `web/precall-brief-v9.js`, `web/recent-news.js` |
| Fish sizing | `worker/src/prep/rivals.ts`, `worker/src/prep/rivals-context.ts`, `worker/src/schema.ts`, `web/precall-brief-v9.js` |
| Tests | `web/scripts/test-contact-deal-mapping.mjs`, `web/scripts/test-search-service.mjs`, `worker/scripts/test-company-news.ts`, `worker/scripts/test-rivals-context.ts`, `web/scripts/test-precall-render.mjs` |
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

# Manual: open pre-call form — repeat search for same company should show "Existing account";
# ⌘K search should show filter chips, recently searched/viewed, and RAG-ranked results when worker is up;
# clicking an account from search should open account overview (not "Could not load this account").
```

### Push workflow (branch 2.1)

Production VPS deploys from **Tony's repo** (`https://github.com/antonyanbu25/lionpath_V2.git`, remote **`antony`**). On branch `2.1`, push only to `antony`, not `origin`:

```bash
git checkout 2.1
git push antony 2.1
```

**Branch `2.0.2`** introduced the account-centric layer (lifecycle, contacts, MEDDPICC, artifacts). **`2.0.3`** adds per-contact enrichment, improved discovery prep layout, and account/sidebar UX polish. **`2.0.4`** adds Kaia-backed DISC inference, industry customer-reference links, Gemini/SSO reliability fixes, and faster login/boot through targeted refactors. **`2.0.5`** merges **`2.0.4`** with deeper Kaia integration (`POST /api/kaia/share-content`, research hash v2). **`2.0.6`** ships **CRM-style navigation**: separate **Accounts** and **Deals** objects, account overview vs opportunity workspace, and **MEDDPICC stored on deals** — see **[docs/adr/004-account-record-crm-ia.md](./docs/adr/004-account-record-crm-ia.md)** and **[docs/adr/005-meddpicc-on-deal.md](./docs/adr/005-meddpicc-on-deal.md)**. **`2.0.7`** (WIP) refactors post-call into a **multi-pass pipeline** under `worker/src/postcall/` — resolve → classify → generate → qualify → ARR → gaps → summarise — with `POST /api/analyze-call` kept as a legacy facade.

---

## Key features (branch `2.0.7` — WIP)

### Multi-pass post-call pipeline

Post-call analysis is being split into explicit passes (UI and worker still evolving):

| Pass | Route | Purpose |
|------|-------|---------|
| 0 | `POST /api/postcall/resolve` | Match recording to account/deal (no LLM) |
| 1 | `POST /api/postcall/classify` | Call type classification (cheap LLM) |
| — | `POST /api/postcall/generate` | Core analysis generation |
| 4 | `POST /api/postcall/qualify` | MEDDPICC qualification |
| ARR | `POST /api/postcall/arr-inputs`, `/arr-compute` | Extract pricing inputs; compute ARR |
| 6 | `POST /api/postcall/gaps` | Product gaps + what landed |
| 7 | `POST /api/postcall/summarise` | Commitments, call notes, MoM (never auto-send) |
| 2 | `POST /api/video-pass` | **Pass 2** — slide/PPT + screen-share inference via **Gemini** (transcript); optional ffmpeg on VPS |
| Legacy | `POST /api/analyze-call` | Facade — auto-pick + generate (existing UI) |

Implementation lives in `worker/src/postcall/` (17 modules) plus `worker/src/video/` for Pass 2.

### Bugfixes in `2.0.7` (this release)

| Issue | Fix |
|-------|-----|
| Post-call not in sidebar history | Refresh sidebar immediately after save; await history sync (no fire-and-forget race) |
| Call page “could not load your profile” | Re-sync session before `renderCallView`; stable `userId` fallback when Firestore upsert fails |
| Pass 2 / Sample video fails without ffmpeg | Gemini transcript inference (`gemini-3.1-flash-lite`) — detects slides/PPT/product share segments; ffmpeg optional on VPS |
| Post-call empty page after re-run / nav back | `resetPostCallView()` restores intake form when returning to Post-call (unless generation is in progress) |
| Slow first post-call Pass 2 | Strategic ffmpeg windows (10%/30%/60%/90%/closing 1min) instead of full-call 10s scan; transcript path when no face consent |
| Duplicate names in “Who was in the room” | Normalized person-key dedupe in call record + post-call identity pickers |
| Camera on/off per SE/AE/Customer | Gemini vision on strategic windows; average on vs off seconds per participant |
| Accounts / Deals “could not load” on SSO | `effectiveSessionUserId` + owner-scoped Firestore queries; `safeStoreOp` swallows permission errors; history fallback rows from localStorage |
| Call timeline misaligned vs wireframe | Horizontal spine + legend + inline markers + 5-metric row (SE talk ratio, customer questions, longest monologue, SE camera, customer cameras); removed phase list |
| Call record tabs / QIP grid misaligned | Wireframe v4 native tabs + 5-column scorecard grid (Theme / Score / Weighted / Conf) |
| Calls list slow first paint | Render from local history immediately; enrich deal/account labels in parallel |

**Pass 2 vision models** (see `worker/src/video/`):

| Path | Model | Used for |
|------|--------|----------|
| Transcript inference (`transcript-infer.ts`) | `gemini-3.1-flash-lite` (default via `POSTCALL_MODEL`) | Slides/PPT segments, share %, per-participant talk/cam when no ffmpeg |
| Keyframe vision (`vision.ts`) | Same Gemini model on strategic-window JPEG keyframes (VPS + ffmpeg) | SE/AE/customer camera on/off (averaged windows), PPT/deck detection, CDE customization |

Participant **cam On/Off** defaults to **Off** when Pass 2 has no camera signal. PPT/slide detection runs on both paths via segment types `slides`, `product`, `cde`.

**Call record UI** (`#calls/:id`): QIP / MEDDPICC / traction / confidence verdict strip, deal context header, call notes + participants, timeline (“How the N minutes went”), scorecard tabs — see [wireframe v4](./docs/wireframes/se-singha-paathai-v4.html).

**Local testing:** requires `GEMINI_API_KEY` in `worker/.dev.vars` for prep, post-call passes, and Pass 2. Dummy login: `se@freshworks.com` / `se123`.

```bash
# From repo root — web UI + worker API
cd web && npm run dev:all
# Worker only (if not using dev:all)
cd worker && npm run dev:node
```

Pass 2 no longer requires ffmpeg locally when a transcript is present (Zoom resolve or pasted VTT). VPS deploy still benefits from ffmpeg for keyframe vision when available.

**Branch `2.0.2`** introduced the account-centric layer (lifecycle, contacts, MEDDPICC, artifacts). **`2.0.3`** adds per-contact enrichment, improved discovery prep layout, and account/sidebar UX polish. **`2.0.4`** adds Kaia-backed DISC inference, industry customer-reference links, Gemini/SSO reliability fixes, and faster login/boot through targeted refactors. **`2.0.5`** merges **`2.0.4`** with deeper Kaia integration (`POST /api/kaia/share-content`, research hash v2). **`2.0.6`** ships **CRM-style navigation** (Accounts / Deals, MEDDPICC on deals) plus a **call-ready Discovery tab** — account + people above the fold, collapsed signals grid, discovery kit closer to the top, and **Research extras** (Support JD + sources). See **[docs/adr/004-account-record-crm-ia.md](./docs/adr/004-account-record-crm-ia.md)** and **[docs/adr/005-meddpicc-on-deal.md](./docs/adr/005-meddpicc-on-deal.md)**.

---

## Key features (branch `2.0.6`)

### CRM navigation — Accounts, Deals, and opportunities

Freshsales-style object nav in the sidebar:

| Nav | List | Detail |
|-----|------|--------|
| **Accounts** | Companies you work | **Account overview** — contacts, deal team, opportunities table (`#accounts/{id}`) |
| **Deals** | All opportunities across those accounts | **Opportunity workspace** — same command deck as account drill-down (`#deals/{dealId}` or `#accounts/{id}/deals/{dealId}`) |

**Opportunity workspace (compact command deck):**

- Summary row — primary contact, primary SE, last activity, **Type** (New business / Expansion)
- **Sales stage** stepper only (no separate “Deal” sub-header; handoff-to-expansion removed from UI for now)
- Three columns — contacts, activity/preps/post-calls/tasks, deal team + **MEDDPICC on the selected deal**
- Changing **Type** updates which deal/lifecycle is in context for the next prep or post-call

**Domain & docs:**

- First-class **Deal** records (`web/domain/deal-service.js`); prep/post-call merge MEDDPICC onto **`Deal.metadata.meddpicc`** ([ADR 005](./docs/adr/005-meddpicc-on-deal.md))
- Hash routes documented in **[docs/ENTITY_CATALOG.md](./docs/ENTITY_CATALOG.md)** (`#deals`, `#deals/{dealId}`, account variants)
- Wireframes: [account-record-v4-1b-compact-command.md](./docs/wireframes/account-record-v4-1b-compact-command.md)

**Tests:** `cd web && npm test` — includes `test-account-view`, `test-deal-view`, `test-deal-meddpicc`, `check-meddpicc-writes`, `test-precall-render`, `test-prep-se-context`.

### Discovery tab — call-ready layout (Option A)

Pre-call **Discovery** brief layout optimized for “who is this company and who am I talking to?” before the call:

| Zone | Contents | Default |
|------|----------|---------|
| **Above the fold** | Account facts (2-line about, ICP in `<details>`) \| People hero (DISC, 1-line experience, top 4 skills) | Visible |
| **Mid page** | **Tech stack & signals** — 2×3 grid, “N found” summary | Collapsed `<details>` |
| **Actions** | Fit comparison strip \| Discovery kit + Likely pain points | Visible |
| **Deep reference** | **Research extras** — Support agent JD + Sources & confidence | Collapsed `<details>` |

**Trust tiers on facts and signals:**

- **Verified** — cited web/LinkedIn source with confidence ≥ 55%
- **Your notes** — values from SE **additional context** (`sourceLabel: SE`), not labeled Unverified
- **Unverified** — research-only gaps that still need validation on the call

**SE additional context → signals:**

- Notes in the prep form (e.g. “they use Zendesk”, “50 agents”) map into the six canonical signal slots on **first generate** — client (`web/prep-se-context.js`) and worker (`worker/src/prep/se-context-facts.ts`)
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

- **Optional Kaia share URL** on the prep form — worker fetches meeting summary text via `POST /api/fetch-kaia-summary` and merges it into contact enrichment
- **DISC source labels** — chips show **Kaia**, **LinkedIn + Kaia**, or other merged sources so SEs know where inference came from
- Enrichment still supports LinkedIn PDF, Zoom excerpts, and notes — see **[docs/CONTACT_ENRICHMENT.md](./docs/CONTACT_ENRICHMENT.md)**

### Industry customer reference links

- Pre-call briefs link to the right **Seismic customer reference deck** based on detected industry (BFSI, education, logistics, manufacturing, e-commerce, high-tech, and more)
- Fallback to General B2B when industry is ambiguous — `web/customer-reference-links.js`

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

Ten focused refactors — no user-facing behavior change, easier to extend and debug:

1. **`web/shared.js`** — shared `esc`, `$`, `show`, `normalizeUserEmail` utilities
2. **`web/chart-shared.js`** — extracted radar/gauge chart helpers
3. **`agentBootLog`** — debug logging gated to localhost only
4. **Prep disputes** — simplified inline boot; removed `MutationObserver`
5. **Parallel login** — history and task sync run concurrently in `loadPersistedHistory`
6. **Sidebar** — recent-work click handling delegated in app boot
7. **`local-store.js`** — in-memory cache with logout clear
8. **Dashboard QC** — cache normalized Quality Coach scores during aggregation
9. **Post-call boot** — listener wiring deferred until app boot completes
10. **Worker routes** — route map with named handlers in `worker/src/routes.ts`

---

## Key features (branch `2.0.3`, still included)

### Accounts — CRM-style detail (Crayons UI)

- **Accounts list** — filter by company, domain, contact, or stage; open any account for full context
- **Account overview** — opportunities list, contacts, deal team (no full pursuit deck on the account shell)
- **Opportunity** — open from account row or **Deals** nav; pursuit pipeline + MEDDPICC + artifacts
- **Deals list** — sidebar **Deals**; filter cross-account opportunities; same opportunity UI on drill-down
- **Account detail wireframe (v2)** — [docs/wireframes/account-record-v2.md](./docs/wireframes/account-record-v2.md)
- **Account detail usability (v2.1 left column)** — [docs/wireframes/account-record-v2.1-left-column.md](./docs/wireframes/account-record-v2.1-left-column.md)
- **Compact command deck (v4 1b)** — [docs/wireframes/account-record-v4-1b-compact-command.md](./docs/wireframes/account-record-v4-1b-compact-command.md)
- **Lifecycle pipeline** — open stages (Research → Business case) as a stepper; terminal outcomes (Closed won / lost / Nurture) as separate actions (replaces stage dropdown)
- **Contacts** — `fw-card` + accordion per person; primary contact expanded by default; DISC and influence tags when assessed (no noisy “not assessed” chips in headers)
- **MEDDPICC scorecard** — on the **active deal** (with account fallback during migration); completion %, field status tags
- **Activity** — merged team timeline grouped **by calendar day**; each event shown individually (no merging); **10 most recent** activities plus **Show all activities**; compact rows with actor-only meta under day headers
- **Artifacts** — preps deduped by day + company in the list; post-calls and tasks in tabs
- **Sidebar** — Discovery briefs deduped by company domain/slug (one row per account)

Domain data lives under `web/domain/` (`account-service`, `contact-service`, `lifecycle-service`, `deal-service`). See **[docs/ENTITY_CATALOG.md](./docs/ENTITY_CATALOG.md)** and **[docs/RELATIONSHIPS.md](./docs/RELATIONSHIPS.md)**.

### Contact enrichment (prep + worker)

- **`POST /api/contact/enrich`** — per-contact research profile, inferred DISC, merge into prep and account contacts
- Prep UI injects enrichment progress; see **[docs/CONTACT_ENRICHMENT.md](./docs/CONTACT_ENRICHMENT.md)**

### Discovery prep layout

- **`2.0.6` — Option A (call-ready scroll):** Account \| People grid first; collapsed signals accordion; fit; discovery kit \| pains; collapsed Research extras (JD + sources). See **Key features (branch `2.0.6`)** above.
- **`2.0.3` — prior layout:** Two-row Account facts + Signals; full-width People with hero DISC and prospect tabs when multiple emails

### Org hierarchy & access (Freshworks seed)

- Director → senior leaders → squad managers → ICs; scoped visibility for artifacts and coaching views
- Profile settings (display name, avatar), user menu, theme — see **[docs/RBAC.md](./docs/RBAC.md)** and **[docs/adr/002-org-hierarchy.md](./docs/adr/002-org-hierarchy.md)**

### Pre-call — v3 one-pager

- **Comparison hero table** — This company vs industry norm across industry, size/agents, support channels, incumbent stack, integrations, and more
- **Bullet sections** — About the business, support process, workflows
- **SE playbook grid** — Top use case, pain points, discovery-gap questions, demo flow steps
- **Collapsible sources** — Cited URLs for prospect facts; gaps say "unknown" rather than being invented
- **Smarter domain handling** — Company name is the primary research target; the UI warns on likely email-domain typos (e.g. `khanacademey.org` → `khanacademy.org`)

**Typical wait:** 15–45 seconds (Gemini + web research).

### Post-call — redesigned one-pager

Mirrors the pre-call layout for a consistent SE experience:

- **Comparison hero** — This call vs follow-up across key call dimensions
- **Bullet sections** — Discussion highlights, pains & objections, competitive mentions & decisions, open questions
- **SE playbook grid** — Top priority action, SE/AE tasks, customer commitments
- **Quality Coach** — Six-dimension rubric (Discovery, Demo alignment, Objections, Value articulation, Next-step clarity, Talk balance) with scores, evidence, strengths, and improvements
- **Collapsible sources** — Suggested follow-up email, CRM notes, transcript details

**Typical wait:** 10–25 seconds (Zoom transcript fetch + Gemini analysis).

### UI/UX overhaul

- Fluid, professional dashboard layout with a soothing teal/blue palette
- **Dark mode toggle** — persisted in browser localStorage
- Responsive sidebar with call history and quality-score badges
- Print / PDF and copy-to-clipboard on every result

### Lion splash (first visit)

A 5-second branded animation with a lion roar plays on the **first visit to the portal** (cookie-based, `index.html` only). Returning users go straight to the app.

### Post-call intelligence

- **Gemini** structured JSON extraction from Zoom audio transcripts
- **Quality scorecard** calibrated for honest, evidence-based coaching (not cheerleading)
- **Zoom integration** — paste share link + passcode; no Zoom OAuth required for MVP
- **Server-side history** on VPS production — analyses sync across sessions via the worker API; local dev falls back to browser storage

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
| **Pre-call prep** | Company + email form → v3 one-pager with comparison table and SE playbook |
| **New analysis** | Zoom link form → redesigned post-call one-pager with Quality Coach |
| **History (sidebar)** | Past analyses with quality scores; click to reload any call |
| **Accounts** | Company list → overview (contacts, opportunities) or open an opportunity |
| **Deals** | All opportunities → pipeline, MEDDPICC, activity (same workspace as account drill-down) |
| **Manager view** | Placeholder team dashboard (rollup planned — see Roadmap) |

For a leadership-friendly walkthrough of post-call flow and FAQ, see **[docs/POST_CALL_OVERVIEW.md](./docs/POST_CALL_OVERVIEW.md)**.  
For a browser-friendly product summary, see **[web/about.html](./web/about.html)**.

---

## Architecture (brief)

```
Browser (web/)  ──HTTPS──►  Worker API (worker/)  ──►  Gemini (default) or Claude
       │                           │
  Firebase Auth (optional)     API keys (server secrets only)
  localStorage / Firestore     Zoom share API → VTT transcript
                               File/KV history (VPS / Cloudflare)
```

| Layer | Role |
|-------|------|
| **`web/`** | Static portal — pre-call, post-call, dashboard, **accounts**, **deals**, history, profile, Crayons (Freshworks Dew) |
| **`worker/`** | API server — `/api/generate-prep`, `/api/analyze-call`, `/api/contact/enrich`, `/api/fetch-kaia-summary`, `/api/history`, Zoom transcript fetch |
| **VPS (production)** | Docker Compose + Caddy HTTPS — see **[docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md)** |
| **LLM** | Gemini 3.1 Flash Lite (default) — web search for pre-call; structured JSON for post-call |

**Why a worker instead of browser-side AI?** API keys stay server-side; one pipeline keeps schema, scoring, and prompts consistent for every SE.

---

## Recent updates

| Area | What changed |
|------|--------------|
| **`2.1` — Pre-call validation** | LinkedIn PDF required per prospect email before Generate brief |
| **`2.1` — Recent news** | Parallel Gemini + Google News RSS + DDG + newsroom fallback; article links; RSS HTML stripped from detail; no SE-context / research-fact backfill |
| **`2.1` — Fish sizing** | Parallel grounded rivals + AE context; web benchmark bars + supplemental INPUT rows; requirement lines filtered out |
| **`2.0.6` — Discovery UX** | Call-ready Discovery tab (Option A): account/people hero, collapsed 2×3 signals grid, kit/pains up, Research extras; SE context → signals on first generate; **Your notes** trust badge |
| **`2.0.6` — CRM IA** | Accounts overview vs opportunity routes; **Deals** sidebar + `#deals/{id}`; Type in summary row; MEDDPICC on deal ([ADR 004](./docs/adr/004-account-record-crm-ia.md), [ADR 005](./docs/adr/005-meddpicc-on-deal.md)) |
| **`2.0.5` — Kaia** | `POST /api/kaia/share-content`, research hash v2, per-prospect excerpts — [CONTACT_ENRICHMENT.md](./docs/CONTACT_ENRICHMENT.md) |
| **`2.0.4` — Kaia DISC** | Optional Kaia share URL fetch; source badges on DISC chips and prospect tabs |
| **`2.0.4` — Customer refs** | Industry-mapped Seismic customer reference links on pre-call briefs |
| **`2.0.4` — Gemini / SSO** | Prep schema + thinkingLevel fixes; SSO export restore; VPS auth cache bust |
| **`2.0.4` — Performance** | Parallel login sync, local-store cache, dashboard QC cache, Firestore TTL + query caps |
| **`2.0.4` — Refactors** | shared.js, chart-shared.js, disputes, sidebar boot, deferred post-call, worker route map |
| **`2.0.4` — Main sync** | Merged `2.0.3` contact enrichment, accounts UX, and activity feed onto main |
| **`2.0.3` — Contact enrichment** | Worker enrich API, prep merge, DISC/influence on contacts; docs in `CONTACT_ENRICHMENT.md` |
| **`2.0.3` — Discovery UX** | Account facts + signals grid, people hero/tabs, nested tab fix for multi-prospect preps |
| **`2.0.3` — Accounts & sidebar** | Accordion layout, MEDDPICC readability, deal team grid, sidebar brief dedupe by domain |
| **`2.0.3` — Activity feed** | Day sections, show 10 then **Show all** (no event merging) |
| **`2.0.2` — Accounts CRM** | Lifecycle pipeline stepper, Crayons cards/accordions/tags, MEDDPICC scorecard, two-column detail layout |
| **`2.0.2` — Contact intelligence** | DISC + influence on contacts; MEDDPICC on accounts; merge from prep/post-call; contact events |
| **`2.0.2` — Org** | Freshworks org seed, hierarchy scopes, profile UX, expanded `npm test` in `web/` |
| **Pre-call v3** | Comparison table, bullet sections, SE playbook grid, collapsible sources |
| **Post-call redesign** | Mirror pre-call layout — Quality Coach, playbook grid |
| **UI/UX** | Dew/Crayons theme, dark mode, responsive dashboard |
| **Production deploy** | VPS at `lionpath.benjaminsquare.com` + `lionpathapi.benjaminsquare.com` |

---

## Roadmap

| Item | Status |
|------|--------|
| **Firebase Google SSO** | Config ready; enable when project ID is set |
| **Firestore history** (cross-device, durable) | Rules exist; wired when Firebase is on |
| **Manager team dashboard** | Rollup across SEs — placeholder view exists today |
| **Formal manager-approved rubric** | Replace MVP AI calibration with signed-off criteria |
| **Zoom OAuth** | Optional — for accounts where share links are restricted |
| **Manual VTT upload in UI** | API supports it; UI is link-first today |

---

## Team quick start

### For SEs (daily use) — no install

1. Open **https://lionpath.benjaminsquare.com**
2. Log in (`se@freshworks.com` / `se123`)
3. **Before a call:** Pre-call prep → company + email + context → brief
4. **After a call:** New analysis → Zoom link → summary, next steps, Quality Coach
5. **Accounts / Deals:** Sidebar → review companies or opportunities, run prep/post-call from the opportunity workspace

### For developers (local laptop — Windows PowerShell)

**Auth on localhost:** Production uses Firebase Google SSO, but **`localhost` is not in Firebase authorized domains** for most setups. For local dev, use **dummy login** — do **not** create `web/firebase-config.local.js` unless you have added `localhost` in Firebase Console (see **[docs/FIREBASE_SETUP.md](./docs/FIREBASE_SETUP.md)**).

| Mode | Setup | Login |
|------|-------|-------|
| **Dummy auth (recommended locally)** | Leave `firebaseConfig.projectId` empty (default) | `se@freshworks.com` / `se123` |
| **Firebase SSO locally** | Copy `web/firebase-config.local.example.js` → `web/firebase-config.local.js`, add `localhost` to Firebase **Authorized domains** | Google `@freshworks.com` |

**One-time setup:**

```powershell
git clone https://github.com/skut264/lionpath.git
cd lionpath
git checkout 2.0.7
cd worker
Copy-Item .dev.vars.example .dev.vars
# Edit .dev.vars — set GEMINI_API_KEY from https://aistudio.google.com/apikey
npm.cmd install
cd ..\web
npm.cmd install
```

**Run (pick one):**

```powershell
# Option A — one terminal (recommended)
cd web
npm.cmd run dev:all
# → worker http://localhost:8787  +  web http://localhost:8788

# Option B — two terminals
cd worker; npm.cmd run dev:node    # terminal 1 → :8787
cd web;    npm.cmd run dev         # terminal 2 → :8788
```

Open **http://localhost:8788** → sign in with **`se@freshworks.com` / `se123`**.

**Notes:**

- `worker/.dev.vars` must include **`GEMINI_API_KEY`** — required for pre-call prep and post-call API passes.
- SSO / Google sign-in **will not work** on localhost until `localhost` is added in Firebase Console → Authentication → Settings → Authorized domains.
- `web/firebase-config.js` already points local hosts at `http://localhost:8787` for the worker API.

**Tests (web):** `cd web; npm.cmd test`

Full onboarding (tunnel sharing, team handoff): **[TEAM_SETUP.md](./TEAM_SETUP.md)**

### Team development workflow

1. Branch from **`2.0.7`** (or `2.0.6` for stable CRM) — e.g. `feature/my-change`
2. Develop and test locally (`npm.cmd run dev:all` or two terminals); run `cd web; npm.cmd test`
3. Push to **`origin`** and open a **pull request** into `2.0.7` / `2.0.6`
4. Deploy production from the branch your team tags for release — see Deploy section below

---

## Documentation

| Doc | Audience |
|-----|----------|
| [web/about.html](./web/about.html) | Boss / SEs — what the portal does (browser-friendly) |
| [docs/POST_CALL_OVERVIEW.md](./docs/POST_CALL_OVERVIEW.md) | Leadership demo — post-call flow, Quality Coach, FAQ |
| [docs/SHARE_WITH_TEAM.md](./docs/SHARE_WITH_TEAM.md) | SEs & managers — team share pack |
| [docs/CONTACT_ENRICHMENT.md](./docs/CONTACT_ENRICHMENT.md) | Developers — enrich API, prep merge, DISC inference |
| [docs/adr/003-account-deal-engagement.md](./docs/adr/003-account-deal-engagement.md) | Developers — Account, Deal, lifecycle engagement |
| [docs/adr/004-account-record-crm-ia.md](./docs/adr/004-account-record-crm-ia.md) | Developers — Accounts vs opportunity UI |
| [docs/adr/005-meddpicc-on-deal.md](./docs/adr/005-meddpicc-on-deal.md) | Developers — MEDDPICC on deal records |
| [docs/HLD.md](./docs/HLD.md) · [docs/LLD.md](./docs/LLD.md) | Developers — high/low level design |
| [docs/ENTITY_CATALOG.md](./docs/ENTITY_CATALOG.md) | Developers — domain entities (Account, Deal, Contact, …) |
| [docs/RELATIONSHIPS.md](./docs/RELATIONSHIPS.md) | Developers — how entities link |
| [docs/RBAC.md](./docs/RBAC.md) | Developers — roles and visibility |
| [TEAM_SETUP.md](./TEAM_SETUP.md) | Developers — local setup, tunnel sharing, onboarding |
| [docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md) | IT / admin — VPS deploy (`lionpath` + `lionpathapi` URLs) |
| [deploy/vps/SECURITY.md](./deploy/vps/SECURITY.md) | IT / admin — secrets, SSH, file permissions |

---

## Deploy

### Option A — VPS (production — `lionpath.benjaminsquare.com`)

See **[docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md)**. Stack: Caddy HTTPS, nginx web, Node worker, file-based history at `/var/lib/se-paathai/history`.

**Deploy branch `2.1`:**

```bash
cd /opt/se-singha-paathai
git fetch antony   # VPS: antonyanbu25/lionpath_V2
git checkout 2.1
git pull antony 2.1
cd deploy/vps
docker compose build --no-cache worker web
docker compose up -d
# If Caddyfile changed:
docker compose restart caddy
```

**Or one command:**

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
- Firebase project (optional) — portal runs in no-auth preview without it

### Worker — smoke tests

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

- `LLM_PROVIDER` — `gemini` (default on VPS) or `anthropic`
- `MODEL` / `EFFORT` — pre-call model and reasoning effort
- `POSTCALL_EFFORT` — post-call effort (default `low`; no web research)
- `ALLOWED_ORIGINS` — CORS (include `https://lionpath.benjaminsquare.com` in prod)
- `ALLOWED_EMAIL_DOMAIN` — sign-in restriction (default `freshworks.com`)
- `FIREBASE_PROJECT_ID` — empty disables auth; set to enforce ID-token verification

### Model strategy

| Use case | Default model | Latency target |
|----------|---------------|----------------|
| Pre-call (research) | `gemini-3.1-flash-lite` + `google_search` | **15–45s** |
| Pre-call (max quality) | `gemini-3.5-flash` or Claude + web search | 30–90s |
| Post-call (transcript) | `gemini-3.1-flash-lite` | **8–20s** |

- **Grounding:** Freshworks facts from `worker/src/kb.ts`; prospect facts from web research with citations
- **Post-call transcript:** Last ~6k words (~30–40 min of speech) for speed
- **Zoom link flow:** `worker/src/zoomShare.ts` — share/play URL + passcode → public Zoom APIs → VTT → analysis
