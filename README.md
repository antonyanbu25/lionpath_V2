# Lionpath — SE Singha Paathai

**One portal for Freshworks Solution Engineers:** research prospects **before** the call, debrief **after** the call, and manage **accounts, contacts, deals, and team coaching** in one place.

| | |
|---|---|
| **This branch** | **`2.1.2`** — cut from **`2.1.1`**; **Dispute a score** → **janus.freshdesk.com**, Activities feed, account/deal/call fixes |
| **Portal build** | `2.1.43` (`web/index.html` `portal-build`, cache-busted CSS/JS) |
| **Worker build** | `2.1.30` (`worker/src/build-id.ts`, `GET /api/config`) |
| **Version file** | [`VERSION`](./VERSION) — build stamp **2.1.30** |
| **Live app** | [https://lionpath.benjaminsquare.com](https://lionpath.benjaminsquare.com) |
| **Live API** | [https://lionpathapi.benjaminsquare.com](https://lionpathapi.benjaminsquare.com) |
| **Upstream repo** | [github.com/skut264/lionpath](https://github.com/skut264/lionpath) |
| **Production deploy fork** | [github.com/antonyanbu25/lionpath_V2](https://github.com/antonyanbu25/lionpath_V2) (VPS pulls from here) |
| **Branch on GitHub** | [antonyanbu25/lionpath_V2/tree/2.1.2](https://github.com/antonyanbu25/lionpath_V2/tree/2.1.2) |

---

## Table of contents

1. [What it does](#what-it-does)
2. [Release highlights (2.1.2)](#release-highlights-212)
3. [Inherited from 2.1.1 / 2.1](#inherited-from-211--21)
4. [Architecture](#architecture)
5. [Repository layout](#repository-layout)
6. [Quick start (developers)](#quick-start-developers)
7. [Demo logins](#demo-logins)
8. [Testing](#testing)
9. [Deploy](#deploy)
10. [Documentation index](#documentation-index)
11. [Contributing & remotes](#contributing--remotes)

---

## What it does

Lionpath is an internal SE coaching portal with two core workflows plus CRM-style account management and a unified activity history:

| Workflow | When | Output |
|----------|------|--------|
| **Pre-call prep** | Before discovery/demo — company, emails, LinkedIn PDFs, AE context | Printable one-pager: company vs industry, discovery kit, fish sizing, DISC dos/donts |
| **Post-call analysis** | After a recorded call — Zoom link + confirm identities | Summary, next steps, Quality Coach scorecard, MEDDPICC, timeline |
| **Activities** | Ongoing review | Unified feed of analyzed calls + pre-call briefs (`#calls` / `#activities`) with type/window filters and KPIs |
| **Accounts & deals** | Ongoing pursuit | Global account/contact/deal records, lifecycle pipeline, product-signal rollups, team visibility |
| **Support & disputes** | When scores or product feedback need follow-up | Freshdesk tickets + optional manager email on score disputes |

Both prep and post-call write to the **same domain model** — accounts, contacts, and deals are global entities; prep briefs and post-call artifacts attach to shared lifecycles.

---

## Release highlights (2.1.2)

Branch **`2.1.2`** is cut from **`2.1.1`** on [antonyanbu25/lionpath_V2](https://github.com/antonyanbu25/lionpath_V2/tree/2.1.2). Build stamps: portal **`2.1.43`**, worker / `VERSION` **`2.1.30`**.

### What’s new at a glance

| Area | What shipped in 2.1.2 |
|------|------------------------|
| **Dispute a score** | New end-to-end flow: SE disputes a Quality Coach score → Freshdesk ticket on **janus.freshdesk.com** (type **Dispute of score** + **Issue Type**) → manager email notify (soft-fail) |
| **Accounts** | Contact/email account resolve, history enrichment, contact dedupe, list/view fixes |
| **Deals** | Deal record polish, product-signal rollup from scored calls, deal/account linking fixes |
| **Calls / Activities** | “All calls” → **Activities**; unified briefs+calls feed; call view, timeline, TC merge, QIP radar fixes |
| **Everything else** | Post-call contact resolve, lifecycle UI, feedback screenshots → Freshdesk, Firebase local docs, deploy secrets |

### Dispute a score (new)

- **In-product dispute** from the scorecard / prep-dispute modal (**Issue type** dropdown + note + optional screenshot)
- **Freshdesk (janus.freshdesk.com)** via `POST /api/tickets` (`kind: dispute_score`) — `web/support-tickets.js` + `worker/src/freshdesk.ts`
  - Ticket **Type:** `Dispute of score`
  - Custom field **Issue Type** (`cf_issue_type`): Score too low / Score too high / Wrong evidence cited / Missing Context / Others (mapped from the form)
  - Also sets `cf_call_id`, `cf_page_context_hash`, `cf_area_of_the_product` = Coaching / scorecards; full context in the HTML description
- **Manager notify** after a dispute is logged — `POST /api/disputes/notify` + `worker/src/notify-email.ts` (never blocks the dispute itself)
- **Org routing** resolves the SE’s manager as recipient (`configureScoreDisputeNotify` in `web/score-disputes.js`)
- **Modal reliability** — dispute overlay CSS fixed (pointer-events / class-based backdrop)

### Account, deal, call & Activities fixes

- **Accounts fixed/improved:** `findAccountByContactEmails`, history rows per account, lifecycle ensure-on-account, contact dedupe, account list/view enrichment
- **Deals fixed/improved:** canonical deal record UX, soft **product-signal rollup** on the deal (`product-signal-service.js`), deal↔call linking/display
- **Calls / Activities fixed/improved:** rename + unified feed (calls + pre-call briefs), type/window filters, KPIs, call-view layout/timeline/QIP, progressive animate, TC merge, hydration refresh
- **CRM resolve:** post-call contact resolve and prep CRM preview hardening so account/deal matching is more reliable end-to-end

### Activities feed (nav rename + unified list)

- **Nav:** “All calls” → **Activities** (`ACTIVITIES_NAV_LABEL`; `#calls` and `#activities` both route to the feed)
- **Unified feed:** Time-sorted **analyzed calls + pre-call briefs** (`mergeActivityFeed` in `web/calls-list-view.js`)
- **Filters:** Type (all types / pre-call briefs / call types) and When window; empty-state copy for no matches
- **KPIs:** Rollup metrics aligned with SE Labs (`aggregateActivityFeedMetrics`)
- **Row enrichment:** Account/deal resolve, TC tags, QIP numeric score, activity icons/title cells
- **Dedupe:** Activities feed identity dedupe (covered by `test-activities-feed-dedupe.mjs`)
- **SE Labs prototypes:** `se-labs-activities.html`, `se-labs-deals.html`, `se-labs-evaluation-radar.html`, `qip-star (1).html`

### Freshdesk support tickets (product feedback + disputes)

- **Instance:** [janus.freshdesk.com](https://janus.freshdesk.com) (default `FRESHDESK_DOMAIN=janus.freshdesk.com`)
- **`POST /api/tickets`** — create Freshdesk ticket (`dispute_score` or `feedback`) with optional screenshot (max 8MB)
- **`worker/src/freshdesk.ts`** — type **Dispute of score** (+ `cf_issue_type` / call / page custom fields) or **Feature Request** for feedback; HTML description builder; domain + API key config
- **`web/support-tickets.js`** — client helper `createSupportTicket` (Bearer / demo email auth parity)
- **Feedback UI** — optional screenshot attachment; creates Freshdesk ticket and mirrors to local queue; soft fallback if Freshdesk is down
- **Config surface:** `GET /api/config` exposes `freshdesk.configured` and `disputeNotify.available`
- **Secrets / deploy:**
  - Env: `FRESHDESK_API_KEY`, `FRESHDESK_DOMAIN=janus.freshdesk.com` (also in `deploy/vps/.env.example`, `worker/.dev.vars.example`, Wrangler)
  - Cloud Run: `deploy/cloudrun/setup-freshdesk-secret.sh` + docs in `deploy/cloudrun/README.md`
  - Local secrets hygiene: `worker/secrets/` (`.gitignore` + README; do not commit keys)

### Call view, timeline, and QIP radar

- **Call view CSS/JS overhaul** — denser record layout, progressive animate, spine timeline with overflow markers
- **Timeline polish** — hide marker kinds shown elsewhere (e.g. TC tab); merge supplemental markers from pass 6 / objections; empty-state for unavailable QIP
- **Call record refresh** — scheduled refresh while hydration pending (`test-call-record-refresh-schedule.mjs`)
- **TC merge** — call TC merge helpers + tests (`test-call-tc-merge.mjs`)
- **QIP radar** — redraw / axis color handling in `web/qip-radar.js` + `test-qip-radar.mjs`

### Deals, accounts, product signals (detail)

- **Deal record product-signal rollup** — soft rollup from scored calls via `rollupProductSignalRows` / `resolveDealProductSignals` (`web/domain/product-signal-service.js`); deal tab render path
- **Account service** — history rows for account, `listDealsForSession`, `findAccountByContactEmails`, lifecycle ensure-on-account helpers; contact dedupe tests
- **Account / deal / briefs list views** — enrichment and list UX updates tied to Activities and CRM resolve
- **SE access** — `loadCallAnalysesForSession` / `listAnalysesForSession`; manager recipient helper for dispute notify

### Post-call pipeline (worker)

- **Scorecard** — memoized results (Gemini non-determinism even at temperature 0); taxonomy / product-area label formatters
- **Timeline** — server-side timeline improvements alongside web spine
- **Providers** — Gemini / provider typing tweaks for post-call passes
- **Live temperature check script:** `worker/scripts/test-postcall-temperature-live.mjs`

### Post-call / pre-call web UX

- Contact resolve improvements (`postcall-contact-resolve.js`) + CRM preview tests
- Intake / postcall CSS and form copy cleanup (intake heading support text trimmed)
- Lifecycle UI stylesheet expansion (`web/lifecycle.css`)
- Theme score suppression + user-facing copy updates (`ACTIVITIES_NAV_LABEL`, etc.)

### Docs, local Firebase, and ops

- **`docs/FIREBASE_SETUP.md`** — production-like local (Firebase + Firestore + service account) checklist
- **`worker/scripts/check-local-firebase.mjs`** — local Firebase readiness helper
- **Cloud Run / VPS** — Freshdesk env docs; `deploy/vps/doctor.sh` / `SECURITY.md` touch-ups for new secrets
- **`package-lock.json`** at repo root (workspace tooling)

### Tests added or updated (2.1.2)

| Area | Scripts |
|------|---------|
| Activities / calls | `test-activities-feed-dedupe.mjs`, `test-calls-list-view.mjs`, `test-load-call-analyses.mjs` |
| Call view | `test-call-view.mjs`, `test-call-view-animate-progressive.mjs`, `test-call-record-refresh-schedule.mjs`, `test-call-tc-merge.mjs`, `test-call-timeline-render.mjs` |
| QIP / product signal | `test-qip-radar.mjs`, `test-deal-product-signal-rollup.mjs` |
| Accounts / org | `test-account-contact-dedupe.mjs`, `test-account-view.mjs`, `test-org-service.mjs` |
| Post-call / prep | `test-postcall-contact-resolve.mjs`, `test-postcall-intake-preview.mjs`, `test-prep-crm-preview.mjs` |
| Worker | `test-dispute-notify.ts`, `test-postcall-temperature-live.mjs`, `check-local-firebase.mjs` |

Removed obsolete: `web/scripts/test-verdict-tension.mjs` (dropped from `web/package.json` test script).

---

## Bug fixes (this branch)

Branch **`fix/profile-and-feedback-bugs-2.1`** — cut from **`2.1`** (`62132a6`).

### 1. Profile photo upload crashed with `store.getUser is not a function`

- **What was wrong:** In Profile settings, clicking **Upload photo** / **Remove photo** threw
  `TypeError: store.getUser is not a function`. The profile write path
  (`updateProfilePicture`/`updateDisplayName` in `web/domain/profile-service.js`) calls
  `store.getUser()` / `store.upsertUser()`, but the domain store in **api** mode
  (the default for SEs) does not expose those methods — only the Firestore store does.
  The team is mid-migration away from Firebase, and the avatar write path was never
  wired for the api store.
- **What changed (temporary disable, per product decision):** `web/profile-settings.js`
  now disables the **Upload photo** and **Remove photo** buttons and short-circuits their
  click / file-input handlers so the broken write can never fire. A muted helper note is
  shown under the avatar row: *“Photo upload is temporarily disabled while we migrate
  profile data. It will be enabled in the next launch.”* The existing avatar still renders,
  and **display-name editing keeps working** (`updateDisplayName` path untouched). New
  disabled styling in `web/styles.css`. Re-enabled in a future launch once the migration
  lands.
- **Outcome:** No more `store.getUser is not a function` crash on the Profile settings page.

### 2. Feedback form created TWO Freshdesk tickets + showed duplicate Cancel/OK buttons

- **What was wrong (double ticket):** Submitting the Send-feedback form fired **two**
  ticket-creation requests — the client called `createSupportTicket()` → `POST /api/tickets`
  **and** `postEntry()` → `POST /api/feedback` (the worker also created a Freshdesk ticket
  via `createJanusTicket`). Result: two tickets in janus.freshdesk.com per submission.
- **What was wrong (duplicate buttons):** The Crayons `fw-modal` auto-rendered its own
  **Cancel / OK** footer on top of the form's own **Cancel / Submit** buttons, so users saw
  two button pairs.
- **What changed:**
  - `web/index.html` — added `hide-footer` to `#feedback-modal` so Crayons no longer renders
    the built-in Cancel/OK pair; only the form's own Cancel/Submit remain.
  - `web/feedback.js` — removed the client-side `createSupportTicket` call (which hit the
    separate `/api/tickets` endpoint). The single `POST /api/feedback` path is now the only
    ticket creator. Added an `inFlight` guard so double-clicks can't fire a second request.
    Optimistic localStorage queue + sync-once behavior preserved.
  - `worker/src/feedback.ts` — re-enabled the server-side ticket creation inside
    `appendFeedback` (via `createJanusTicket`), so `/api/feedback` is now the single path that
    both stores feedback **and** creates the Freshdesk ticket. The returned `ticketId` drives
    the success message (“Ticket #NNN was created.”).
- **Screenshot restored (single path):** Screenshots on the feedback form are supported again.
  The client base64-encodes the optional screenshot and sends it in the same `/api/feedback`
  payload (`web/feedback.js` → `postEntry`); the worker decodes it (`attachmentFromBase64` in
  `worker/src/routes.ts`) and attaches it to the same single ticket via
  `createFreshdeskTicket` (multipart) when present (`worker/src/feedback.ts`). Still exactly
  ONE `/api/feedback` request and ONE ticket. 8MB max enforced on both ends.
- **Outcome:** Exactly **one** ticket is created per submission (with the screenshot attached
  when provided); one button pair in the modal.

### 3. Web build was broken by a duplicate export (pre-existing, unblocked to ship)

- **What was wrong:** `web/domain/store.js` declared `isFirestoreStoreReady` **twice**, which
  failed the esbuild web build (`Multiple exports with the same name`). This pre-existed on
  the `2.1` base branch (unrelated to the two fixes above).
- **What changed:** Removed the duplicate declaration; `node web/scripts/build.mjs` now exits
  green (110 files / 1.8 MB JS).

---

## Inherited from 2.1.1 / 2.1

Still true on this branch (shipped in **`2.1.1`** off production **`2.1`**):

### Account / deal UI unification (2.1.1)

- **One deal record everywhere:** Account overview deal rows open **My deals** → wireframe v4 deal record (`deal-view.js`)
- **Contextual back** from account drill-in; hash redirect `#accounts/{id}/deals/{dealId}` → `#deals/{dealId}`
- Legacy opportunity workspace removed from `account-view.js`

### Pre-call CRM & dual-write (2.1.1)

- `syncSessionWithDomainStore` before `linkPrepToLifecycle`; brief `accountId` / `dealId` write-back
- `teamId` fallback when user doc is null; account list dedupe; Know tab / fish sizing parity

### Org hierarchy & RBAC (from 2.1)

- Director → segment leaders → team managers → ICs; scoped visibility; org structure editor; manager proxy SE
- See [docs/RBAC.md](./docs/RBAC.md), [docs/ORG_HIERARCHY_VISUAL.md](./docs/ORG_HIERARCHY_VISUAL.md)

### Shared CRM path & search (from 2.1 / 2.1.1)

- `engagement-entities.js` shared prep/post-call resolve; contact name/email merge
- RAG omni-search (⌘K); all-briefs list; portal `portal-build` cache-bust

See also: [docs/PRECALL_POSTCALL_CRM_PARITY.md](./docs/PRECALL_POSTCALL_CRM_PARITY.md), [docs/ACCOUNT_DEAL_CONTACT_FIX_REPORT.md](./docs/ACCOUNT_DEAL_CONTACT_FIX_REPORT.md), [docs/REVIEW_ROUND2_FIX_REPORT.md](./docs/REVIEW_ROUND2_FIX_REPORT.md).

---

## Architecture

```
Browser (web/)  ──HTTPS──►  Worker API (worker/)  ──►  Gemini (+ google_search)
       │                           │
  Firebase Auth (optional)     Secrets in worker/.dev.vars
  localStorage / Firestore     Zoom share → VTT transcript
                               File/KV history (VPS)
```

| Layer | Role |
|-------|------|
| **`web/`** | Static portal — prep, post-call, Activities feed, dashboard, accounts, deals, org settings, Crayons (Dew) UI |
| **`web/domain/`** | Client-side domain store — accounts, contacts, deals, lifecycles, dual-write, product signals, RBAC |
| **`worker/`** | API — prep synthesize, post-call passes, contact enrich, search RAG, org structure, Freshdesk tickets, dispute notify |
| **Production** | Docker Compose + Caddy on VPS — see [docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md) |

**Domain model (Salesforce-shaped):**

- **Account** — company hub; slug + domain dedupe
- **Contact** — `(accountId, email)` with name-based merge for same person, alternate emails
- **Deal** — opportunity on account; MEDDPICC on deal metadata
- **Lifecycle** — engagement spine linking prep briefs, post-calls, tasks
- **dealContacts** — join table; primary contact on deal

See [docs/ENTITY_CATALOG.md](./docs/ENTITY_CATALOG.md), [docs/adr/003-account-deal-engagement.md](./docs/adr/003-account-deal-engagement.md).

---

## Repository layout

```
├── web/                 # Portal UI + client domain layer
│   ├── domain/          # account-service, deal-service, dual-write, engagement-entities,
│   │                    # org-service, product-signal-service, se-access-service
│   ├── calls-list-view.js / qip-radar.js / score-disputes.js / support-tickets.js
│   ├── scripts/         # Regression tests (npm test)
│   └── dev-server.mjs   # Local static server :8788
├── worker/              # Node API :8787
│   ├── src/prep/        # Research, synthesize, fish sizing, recent news
│   ├── src/postcall/    # Multi-pass post-call pipeline
│   ├── src/freshdesk.ts # Freshdesk ticket create (disputes + feedback)
│   ├── src/notify-email.ts  # Manager dispute email notify
│   ├── secrets/         # Local secret files (gitignored except README)
│   └── scripts/         # Seed Firestore users, worker tests
├── docs/                # ADRs, RBAC, fix reports, architecture, Firebase setup
├── firestore.rules      # Security rules (org structure, account team, artifacts)
├── deploy/vps/          # Production Docker + Caddy
├── deploy/cloudrun/     # Cloud Run deploy + Freshdesk secret setup
├── se-labs-*.html       # SE Labs UI prototypes (Activities / deals / radar)
└── README.md            # This file
```

---

## Quick start (developers)

### Prerequisites

- **Node.js 18+** (24.x recommended)
- **Gemini API key** — [Google AI Studio](https://aistudio.google.com/apikey)
- **Firebase** (optional) — portal runs in dummy-auth mode without `firebase-config.local.js`
- **JDK 21+** (optional, for local testing only) — required to run `rules-tests/` and `worker`'s `emulator`-tagged tests against a real Firestore emulator. Without it, `worker/npm test` still runs everything except the emulator tag; CI installs Temurin 21 itself via `actions/setup-java@v4` (confirmed 2026-08-10 — `firebase-tools@15.x` requires JDK 21+, the plain `java` on `ubuntu-latest` doesn't meet that on its own)
- **Docker** (optional, for local testing only) — required to dry-run the VPS deploy test gate (`deploy/vps/Dockerfile.worker-test`)

### One-time setup

```bash
git clone https://github.com/antonyanbu25/lionpath_V2.git
cd lionpath_V2
git checkout 2.1.2

cd worker
cp .dev.vars.example .dev.vars
# Edit .dev.vars — set GEMINI_API_KEY=...
# Optional: FRESHDESK_* and DISPUTE_NOTIFY_* / EMAIL_PROVIDER_API_KEY for tickets + dispute email
npm install

cd ../web
npm install
```

### Run locally

```bash
# From repo root — starts worker :8787 + web :8788
npm run dev:all

# Or separately:
cd worker && npm run dev:node   # API
cd web && npm run dev           # UI
```

Open **http://localhost:8788** and sign in with demo credentials (see below).

**Notes:**

- Leave `web/firebase-config.local.js` unset for **dummy login** on localhost
- Worker requires `GEMINI_API_KEY` in `worker/.dev.vars` for prep/post-call
- For production-like local (Google SSO + Firestore CRM), see [docs/FIREBASE_SETUP.md](./docs/FIREBASE_SETUP.md)
- Hard-refresh (Cmd+Shift+R) after pulling to pick up new `portal-build`

### Stop dev servers

```bash
npm run stop:dev   # kills processes on 8787 and 8788
```

---

## Demo logins

Dummy auth when Firebase `projectId` is empty (default on localhost):

| Role | Email | Password |
|------|-------|----------|
| **Director** | `vipin.thomas@freshworks.com` | `vipin123` |
| **Segment leader (Antony branch)** | `antony.sagayaraj@freshworks.com` | `leader123` |
| **Segment leader (Digital)** | `preethi.sri@freshworks.com` | `leader123` |
| **Team manager** | `ajay.raghavan@freshworks.com` | `mgr123` |
| **SE (generic)** | `se@freshworks.com` | `se123` |

Production uses **Google SSO** with `@freshworks.com` restriction. See [docs/FIREBASE_SETUP.md](./docs/FIREBASE_SETUP.md).

Seed roster: `worker/scripts/seed-users.example.csv`, `web/dummy-users.js`, `web/domain/seed-dev.js`.

---

## Testing

`web` and `worker` each run through an aggregating runner
(`scripts/run-tests.mjs`, reading `scripts/test-manifest.mjs`) instead of
individually-invoked files — every test in the manifest runs as its own
subprocess, one crash can't take down the run, and the summary at the end
shows exactly what passed/failed. `rules-tests/` still runs as a single
`firebase emulators:exec`-wrapped script (needs a real JDK — see
Prerequisites).

```bash
# web — full suite (unit + e2e, ~3–6 min; needs Playwright's Chromium —
# npx playwright install chromium once if you haven't, or e2e tests
# self-report "SKIP: playwright not installed" and pass trivially)
cd web && npm test

# web — fast/free tests only (no browser, no network) — what the VPS
# deploy gate runs
npm run test:fast

# web — e2e only
npm run test:e2e

# worker — full suite (unit + emulator-tagged; needs a real JDK — the
# emulator tag is skipped otherwise, everything else still runs)
cd worker && npm test

# worker — fast/free tests only
npm run test:fast

# worker — live-api tests (real GEMINI_API_KEY, costs money — run
# deliberately, never part of any automated gate)
npm run test:live-api

# Firestore rules coverage (needs a real JDK)
npm run test:rules   # from repo root — npm ci in rules-tests/ + node run-all.mjs
```

CI (`.github/workflows/ci.yml`) runs all three legs (`worker`, `web`,
`rules`) on every push and PR — see [docs/HARNESS_FINDINGS.md](./docs/HARNESS_FINDINGS.md)
for the working log of what the harness has caught, including real bugs
(not just orphaned/stale tests) it found along the way.

**Writing a new e2e test that logs in:** `fw-input`'s real `<input>` lives
in its shadow DOM — `page.fill("#login-email", ...)` or setting `.value`
directly on the custom-element host both silently no-op. Use
`page.locator("#login-email input:not([type=hidden])").fill(...)` instead
(the `:not([type=hidden])` excludes a light-DOM helper input Crayons adds
for native form association), and click `#login-submit` specifically —
`button[type="submit"]` matches multiple unrelated buttons app-wide.

Key modules under test: `calls-list-view.js`, `score-disputes.js`, `support-tickets.js`, `product-signal-service.js`, `engagement-entities.js`, `dual-write.js`, `account-service.js`, `org-service.js`, `freshdesk.ts`, `notify-email.ts`.

---

## Deploy

### VPS production (Tony's fork → live site)

Production VPS deploys from **`antonyanbu25/lionpath_V2`**.

**Release branch `2.1.2`** (sourced from **`2.1.1`** ← **`2.1`**):

```bash
# Developer machine — push release branch
git checkout 2.1.2
git push origin 2.1.2

# On VPS (after review)
cd /opt/se-singha-paathai
git fetch origin
git checkout 2.1.2
git pull origin 2.1.2
cd deploy/vps && bash upgrade-now.sh
```

Stable production line remains **`2.1`** / **`2.1.1`** until **`2.1.2`** is promoted. See [docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md).

#### Promotion checklist (before pushing a release branch to production)

1. **CI green** on the source branch — `web`, `worker`, and `rules` legs in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).
2. **Manually trigger [`Promotion Gate`](./.github/workflows/promotion-gate.yml)** (Actions tab → Promotion Gate → Run workflow) and confirm it's green — this runs the full fast test suite plus both live-Gemini evals (prep golden-set, post-call score self-consistency) in one pass.
3. **Note the Promotion Gate run URL** in the release commit or PR description, so there's a record of what was checked before this went live.
4. Only then run the VPS deploy steps below. `deploy/vps/update.sh` also runs its own fast/free test gate automatically before rebuilding the worker container (opt out with `SKIP_TEST_GATE=1` only for an urgent hotfix — see [docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md)).

For Freshdesk on Cloud Run: `FRESHDESK_API_KEY='…' bash deploy/cloudrun/setup-freshdesk-secret.sh` then confirm `GET /api/config` → `"freshdesk": { "configured": true }`.

### Push workflow summary

| Remote | Repo | Branch | Purpose |
|--------|------|--------|---------|
| **`origin`** | antonyanbu25/lionpath_V2 | **`2.1.2`** | Current release branch (from **`2.1.1`**) — Tony's fork / VPS |
| **`skut264`** | skut264/lionpath | `2.1` / features | Upstream / team development |

```bash
git checkout 2.1.2
git push -u origin 2.1.2
```

---

## Documentation index

| Doc | Audience |
|-----|----------|
| [web/about.html](./web/about.html) | Product overview (browser-friendly) |
| [docs/HLD.md](./docs/HLD.md) · [docs/LLD.md](./docs/LLD.md) | Architecture |
| [docs/ENTITY_CATALOG.md](./docs/ENTITY_CATALOG.md) | Domain entities |
| [docs/RBAC.md](./docs/RBAC.md) | Roles and visibility |
| [docs/PRECALL_POSTCALL_CRM_PARITY.md](./docs/PRECALL_POSTCALL_CRM_PARITY.md) | Prep/post-call shared CRM path |
| [docs/CONTACT_ENRICHMENT.md](./docs/CONTACT_ENRICHMENT.md) | DISC / enrich API |
| [docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md) | Production deploy |
| [docs/FIREBASE_SETUP.md](./docs/FIREBASE_SETUP.md) | Firebase / production-like local |
| [docs/HARNESS_FINDINGS.md](./docs/HARNESS_FINDINGS.md) | Eval harness working log — real bugs the test suite caught |
| [deploy/cloudrun/README.md](./deploy/cloudrun/README.md) | Cloud Run + Freshdesk secret |
| [TEAM_SETUP.md](./TEAM_SETUP.md) | Onboarding & tunnels |
| [docs/POST_CALL_OVERVIEW.md](./docs/POST_CALL_OVERVIEW.md) | Leadership demo |

**Fix / review reports (2.1 / 2.1.1 pass):**

- [docs/PRECALL_FIX_REPORT.md](./docs/PRECALL_FIX_REPORT.md)
- [docs/ACCOUNT_DEAL_CONTACT_FIX_REPORT.md](./docs/ACCOUNT_DEAL_CONTACT_FIX_REPORT.md)
- [docs/REVIEW_ROUND2_FIX_REPORT.md](./docs/REVIEW_ROUND2_FIX_REPORT.md)
- [docs/ULTRA_REVIEW_A.md](./docs/ULTRA_REVIEW_A.md) · [docs/ULTRA_REVIEW_B.md](./docs/ULTRA_REVIEW_B.md)

---

## Contributing & remotes

```bash
# Add skut264 upstream (once)
git remote add skut264 https://github.com/skut264/lionpath.git

# Add production fork (once)
git remote add antony https://github.com/antonyanbu25/lionpath_V2.git

# Feature workflow
git checkout -b feature/my-change 2.1.2
# ... develop, npm test ...
git push -u skut264 feature/my-change
# Open PR to 2.1.2 (or 2.1.1 / 2.1) on skut264/lionpath
```

**Do not commit:** `worker/.dev.vars`, `web/firebase-config.local.js`, `worker/secrets/*` (except README), API keys, `.cursor/` debug logs.

---

## License & ownership

Internal Freshworks SE tooling. Not for public distribution without approval.
