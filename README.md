# Lionpath — SE Singha Paathai

**One portal for Freshworks Solution Engineers:** research prospects **before** the call, debrief **after** the call, and manage **accounts, contacts, deals, and team coaching** in one place.

| | |
|---|---|
| **This branch** | **`feat/sql-foundation`** — Firestore → Cloud SQL (Janus v9.3): schema, dual-write, QA fixes (16/16), gated |
| **Portal build** | `2.1.42` (`web/index.html` `portal-build`, cache-busted CSS/JS) |
| **Worker build** | `2.1.30` (`worker/src/build-id.ts`, `GET /api/config`) |
| **Version file** | [`VERSION`](./VERSION) — build stamp **2.1.30** |
| **Live app** | [https://lionpath.benjaminsquare.com](https://lionpath.benjaminsquare.com) |
| **Live API** | [https://lionpathapi.benjaminsquare.com](https://lionpathapi.benjaminsquare.com) |
| **Upstream repo** | [github.com/skut264/lionpath](https://github.com/skut264/lionpath) |
| **Production deploy fork** | [github.com/antonyanbu25/lionpath_V2](https://github.com/antonyanbu25/lionpath_V2) (VPS pulls from here) |
| **Branch on GitHub** | [antonyanbu25/lionpath_V2/tree/main](https://github.com/antonyanbu25/lionpath_V2/tree/main) |

---

## Table of contents

1. [What it does](#what-it-does)
2. [SQL migration (feat/sql-foundation)](#sql-migration-featsql-foundation)
3. [Security hardening (feat/security-fixes)](#security-hardening-featsecurity-fixes)
4. [Pre-call grounding (feat/precall-grounding)](#pre-call-grounding-featprecall-grounding)
5. [Release highlights](#release-highlights)
6. [Inherited from 2.1.1 / 2.1](#inherited-from-211--21)
7. [Architecture](#architecture)
8. [Repository layout](#repository-layout)
9. [Quick start (developers)](#quick-start-developers)
10. [Demo logins](#demo-logins)
11. [Testing](#testing)
12. [Deploy](#deploy)
13. [Documentation index](#documentation-index)
14. [Contributing & remotes](#contributing--remotes)

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

## SQL migration (feat/sql-foundation)

Branch **`feat/sql-foundation`** adds **PostgreSQL on Cloud SQL** as the future system of record (Janus v9.3 schema), with a **dual-write transition** path. Firestore remains the default read/write path until `PERSISTENCE_MODE` is flipped.

**Status:** Phase B ops complete; all **16 QA blockers confirmed and fixed** (see [docs/SQL_QA_VALIDATION.md](./docs/SQL_QA_VALIDATION.md)). Fresh schema install, grants, RLS, view RLS, dual-write soak, and TypeScript compile all pass — see [QA gate results](#sql-qa-gate-results-2026-08-20) below.

| Piece | Location |
|-------|----------|
| Schema (phases 00–13) | `janus/schema/` |
| Persistence layer | `worker/src/data/persistence/` |
| Build plan | [docs/SQL_BUILD_PLAN.md](./docs/SQL_BUILD_PLAN.md) |
| QA fix plan | [docs/SQL_QA_FIX_PLAN.md](./docs/SQL_QA_FIX_PLAN.md) |
| QA validation matrix | [docs/SQL_QA_VALIDATION.md](./docs/SQL_QA_VALIDATION.md) |
| Cutover runbook | [docs/CUTOVER_SQL.md](./docs/CUTOVER_SQL.md) |
| Security (QA public IP) | [docs/CLOUDSQL_SECURITY.md](./docs/CLOUDSQL_SECURITY.md) |
| ADR | [docs/adr/008-firestore-to-sql-decision.md](./docs/adr/008-firestore-to-sql-decision.md) |

**`PERSISTENCE_MODE`:** `firestore` (default) → `dual` (SQL primary + outbox projection to Firestore) → `sql` (SQL only).

### Local Cloud SQL setup

1. Copy `worker/.dev.vars.example` → `worker/.dev.vars` (gitignored).
2. Add **single-quoted** connection strings (never paste URLs into zsh — `!` triggers history expansion):

   ```bash
   DATABASE_URL_MIGRATIONS='postgresql://postgres:…@HOST:5432/janus?sslmode=require'
   DATABASE_URL='postgresql://janus_app:…@HOST:5432/janus?sslmode=require'
   PERSISTENCE_MODE=firestore   # use dual after smoke tests pass
   ```

3. Verify and apply schema:

   ```bash
   node worker/scripts/verify-db-env.mjs
   node worker/scripts/apply-janus-schema.mjs
   ```

4. **Full QA gate** (must pass before dual mode):

   ```bash
   cd worker && npm run test:sql-gates
   ```

   Or run individually — see [SQL QA gate results](#sql-qa-gate-results-2026-08-20).

5. Optional: prove fresh install on empty DB (reproduces QA #1 fix):

   ```bash
   node worker/scripts/repro-empty-db.mjs
   ```

### SQL QA gate results (2026-08-20)

All gates run against live Cloud SQL QA (`DATABASE_URL` / `DATABASE_URL_MIGRATIONS` in `worker/.dev.vars`). **30 assertions, 0 failures.**

| Gate | Command | Result |
|------|---------|--------|
| Env parse | `node worker/scripts/verify-db-env.mjs` | PASS — vars parsed, no secrets logged |
| Schema apply | `node worker/scripts/apply-janus-schema.mjs` | PASS — phases 00–13 applied |
| Fresh install | `node worker/scripts/repro-empty-db.mjs` | PASS — empty `janus_repro` DB, all phases ok |
| TypeScript | `cd worker && npx tsc --noEmit` | PASS — 0 errors |
| Grants smoke | `node janus/tests/grants_smoke.test.mjs` | **18/18** — see table below |
| RLS fails-closed | `node janus/tests/rls_fails_closed.test.mjs` | **8/8** — see table below |
| View RLS | `node janus/tests/view_rls.test.mjs` | **4/4** — see table below |
| Dual-write soak | `cd worker && npm run test:dual-soak` | PASS — SQL row + `sync_outbox` entry |

<details>
<summary><strong>Grants smoke — 18 checks</strong> (<code>janus/tests/grants_smoke.test.mjs</code>)</summary>

| # | Check |
|---|--------|
| 1 | connected as `janus_app` |
| 2–9 | SELECT on account, contact, deal, activity, pre_call, post_call, task, scorecard |
| 10–11 | INSERT + DELETE org_unit round-trip |
| 12 | INSERT app_user (identity sequence) |
| 13–18 | REVOKE holds: deal_stage_history UPDATE/DELETE, audit_log UPDATE/DELETE, score_override UPDATE, contact_merge_log UPDATE |

</details>

<details>
<summary><strong>RLS fails-closed — 8 checks</strong> (<code>janus/tests/rls_fails_closed.test.mjs</code>)</summary>

| # | Check |
|---|--------|
| 1 | No session vars → 0 deals |
| 2 | Typo `app.org_path` — no cross-org deals |
| 3 | Typo `app.org_path` — owner sees own deal |
| 4 | Org path only — sees in-org deal |
| 5 | Org path only — not cross-org |
| 6 | SE context sees own org deal |
| 7 | SE context cannot see other org deal |
| 8 | Admin sees both fixture deals (2/2) |

</details>

<details>
<summary><strong>View RLS (security_invoker) — 4 checks</strong> (<code>janus/tests/view_rls.test.mjs</code>)</summary>

| # | Check |
|---|--------|
| 1 | Org2 session sees 0 rows for org1 deal in `v_deal_traction` |
| 2 | Org2 session sees 0 active_deals for org1 in `v_org_metrics` |
| 3 | Org1 session sees its own deal in `v_deal_traction` |
| 4 | Admin sees the deal in `v_deal_traction` |

</details>

<details>
<summary><strong>Dual-write soak</strong> (<code>worker/scripts/dual-write-soak.ts</code>)</summary>

| Step | Check |
|------|--------|
| 1 | Upsert account into SQL under system context |
| 2 | Corresponding `sync_outbox` row created (entity `account`, op `update`, status `pending`) |
| 3 | Fixture rows cleaned up |

</details>

### Cloud Run (staging)

```bash
bash deploy/cloudrun/setup-sql-secrets.sh          # store secrets in Secret Manager
ATTACH=1 bash deploy/cloudrun/setup-sql-secrets.sh # mount DATABASE_URL + PERSISTENCE_MODE=dual
```

See [deploy/cloudrun/README.md](./deploy/cloudrun/README.md) and [deploy/cloudsql/README.md](./deploy/cloudsql/README.md).

**Do not commit** `worker/.dev.vars` or any connection strings.

---

## Security hardening (feat/security-fixes)

Branch **`feat/security-fixes`** (stacked on `feat/ai-run-cost-tracking`) merges the two security fix drops — `feat/security-hardening` + `feat/vuln-fixes` — that address the [security & vulnerability review](./janus_security_vuln_review.pdf) of the SQL migration surface.

### Addressed

| ID | Severity | Finding | Fix |
|----|----------|---------|-----|
| C1 | Critical | Impersonation endpoint mints tokens for anyone, auto-creates users | `routes/impersonate.ts` — hard-gated to non-production, requires `X-Impersonate-Secret` header, no user auto-create, structured audit log |
| C2 | Critical | Postgres TLS `rejectUnauthorized: false` for **all** sslmodes (MITM) | `persistence/postgres-pool.ts` — verify-cert for `verify-ca`/`verify-full`; `PG_SSL_INSECURE=1` escape hatch refused at boot in production (`node-server.ts`) |
| H1 | High | RLS session-var bypass: direct `janus_app` connection + `set_config('app.is_admin','true')` | `janus/schema/17_rls_role_defaults.sql` — `ALTER ROLE janus_app` fail-closed defaults (`is_admin=false`, empty user/org) |
| H2 | High | `redact_pii()` left transcript/MEDDPICC/ARR intact — false compliance signal | `06_phase6_outbox_integrations_pii.sql` — NULLs `analysis`/`detail`, tombstones `transcript_ref` |
| H3 | High | `ai_run` had no RLS — any `janus_app` query reads all token/cost data | `janus/schema/18_ai_run_rls.sql` — FORCE RLS, owner-read/admin-write policies (encryption posture documented, CMEK still open) |
| M1 | Medium | SQL domain-write path skipped app-layer authz for un-RLS'd tables (account/contact) | `routes.ts` — `canWriteUnscopedResource` gate in `trySqlDomainWrite`; failures fall through to Firestore rules |
| M3 | Medium | `withSystemContext` name hid the RLS bypass | Renamed `withUnrestrictedSystemContext` (alias kept) in `persistence/session-context.ts` |
| M4 | Medium | Cron secret compared with `!==` (timing attack) | `routes/internal-batch.ts` — `timingSafeEqualString` |
| L3 | Low | `FIREBASE_AUTH_ENFORCED=0` in production silently disabled token verification | Boot guard in `node-server.ts` refuses to boot |
| NEW-1 | High | Manager proxy-write (`targetEmail`) honored for any authenticated caller | `auth.ts` — `isManagerOrAdmin` DB role check in `resolveHistoryEmailForWrite` + `assertManagerProxyOwnerEmail` |
| NEW-2 | Medium | 5xx error handler leaked internals (SQL table names, paths) | `index.ts` — generic `"Internal error."` for 5xx, detail logged server-side |
| NEW-3 | High | `POST /api/deals` had no authorization check (IDOR) | `routes.ts` — `assertCanReadResource` on the parent account |
| NEW-4 | Medium | Transcripts sent to LLM with PII unredacted | `data/transcript-redaction.ts` + `postcall/commit.ts` — opt-in `LLM_TRANSCRIPT_REDACTION=1` regex redaction (email/phone/CC) |
| NEW-5 | Medium | Health readiness leaked env names / Firestore errors | `routes/health.ts` — `checks` detail only for admin or local probe |
| NEW-6 | Medium | Rate limit keyed on unverified JWT payload (spoofable uid) | `rate-limit.ts` — falls back to IP key when no verified uid |
| NEW-7 | Medium | 60s SQL session cache delayed role-revocation effect | `session-context.ts` — 5s TTL + `invalidateSqlSession()` |
| NEW-8 | Medium | `ALLOWED_ORIGINS=*` with credentials | Boot guard in `node-server.ts` refuses wildcard in production |
| NEW-9 | Medium | `jsonrepair` on unbounded LLM output (DoS) | 256KB cap in `json.ts` + `postcall/commit.ts` |

Also pulled in from the drops (correctness, not findings):

- **`14_rls_owner_write_calls.sql`** — `pre_call`/`post_call` owner-write RLS policies; fixes the silent dual-write denial where a normal SE's insert was rejected and the worker fell back to Firestore.
- **`15_id_registry_backfill.sql`** — idempotent `id_registry` backfill so `resolveInternalId()` stops 500ing on migrated parents (`\echo` psql lines stripped for the pg-client applier).
- **Route shadowing** — explicit `POST /api/deals` entry shadowed the `domainReadRoutes` GET entry; merged into `{ GET, POST }`.
- **`init_all.sql`** — was stale (stopped at phase 12); now lists all 21 phase files.

### Still open

| Finding | Status |
|---------|--------|
| Prompt-injection hardening on LLM prompts (transcript/brief content is attacker-influenceable) | Not addressed in either drop — needs prompt isolation / output validation work |
| Hardcoded demo password / demo auth path | Not addressed — demo mode remains for local dev |
| CORS fallback default origins in non-production | Partially mitigated by NEW-8 (production guard only) |
| No request body size limit on JSON endpoints | Not addressed |
| CMEK / column-level encryption for `post_call.analysis`/`detail` + GCS call-payload bucket | Documented in `18_ai_run_rls.sql` header; infra work, not code |
| `audit_log` table is dead — impersonation audit events go to `console.error` only | Queued behind audit_log operationalization |
| `routes/health.ts` not registered in the route table | Pre-existing dead module; NEW-5 hardens it for when it is wired |

### Not ported (non-security changes in the drops)

- `history-firestore.ts` chunked-blob storage (feature)
- `postgres-repository.ts` contact email-dedup upsert (feature, from `origin/2.1`)
- `shapes.ts` expanded JSONB shape key lists (schema drift)
- `createPrepBrief` `doc.prep` field fallback (robustness)

### Verification

`npx tsc --noEmit` clean; `apply-janus-schema.mjs --dry-run` lists 21 phases in order (14/15 after 13, 17/18 after 16 — 18 depends on `ai_run.user_id` from 16); `node --check` on changed scripts. `janus/tests/ai_run_insert.test.mjs` updated for the new `ai_run` RLS (asserts non-admin reads fail closed, then reads/probes as admin). Live DB gates (`npm run test:sql-gates`) require Cloud SQL access.

---

## Pre-call grounding (feat/precall-grounding)

Branch **`feat/precall-grounding`** (stacked on `feat/security-fixes`) makes pre-call briefs **reliably grounded**: every claim must be traceable to the text of the specific source it names, and anything unverifiable is dropped or degraded to `unknown`/`[]` — never passed on faith.

**Why:** an SE repeats whatever the brief says to the customer. Two review passes found the free-prose half of the brief (description, fitSnapshot, likelyPains, discoveryKit) was prompt-only, and even the "grounded" structured fields only checked that a *label resolves* — not that the *claim is in the named source*.

**How:** `prep/claim-verify.ts` gates claims on content-token overlap + literal number match against the named source's snippet; `<untrusted_web_content>` delimiters + `looksInjected` defend against prompt injection; unverifiable fields degrade honestly; `prep/synthesize-repair.ts` recovers truncated sections field-by-field so repairs can't rewrite survivors.

| | |
|---|---|
| Why / goal / status | [docs/PRECALL_GROUNDING.md](./docs/PRECALL_GROUNDING.md) |
| Per-item build detail (Tier 1 + Tier 2) | [docs/PRECALL_GROUNDING_BUILD.md](./docs/PRECALL_GROUNDING_BUILD.md) |
| Core gate | `worker/src/prep/claim-verify.ts` |
| Tests | `worker/scripts/test-precall-grounding.ts` (61 checks) + rivals/news/icp/normalize suites |

**Status:** Tier 1 + Tier 2 complete and verified (`tsc` clean; grounding suites pass with source-branch check counts; full unit suite **85/85**). **Tier 3** (per-section grounding report, research age, label disambiguation, unknown-sentinel collision, SE-context PII) is documented and explicitly not started — optional hardening, not required for trustworthiness.

---

## Release highlights

Build **`2.1.2`** is on **`main`** at [antonyanbu25/lionpath_V2](https://github.com/antonyanbu25/lionpath_V2/tree/main). Build stamps: portal **`2.1.42`**, worker / `VERSION` **`2.1.30`**.

### What’s new at a glance

| Area | What shipped |
|------|--------------|
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
  Firebase Auth (optional)     Firestore (legacy / dual projection)
  localStorage / Firestore     Cloud SQL PostgreSQL (Janus v9.3, dual/sql mode)
                               Secrets in worker/.dev.vars / Secret Manager
                               Zoom share → VTT transcript
                               File/KV history (VPS)
```

| Layer | Role |
|-------|------|
| **`web/`** | Static portal — prep, post-call, Activities feed, dashboard, accounts, deals, org settings, Crayons (Dew) UI |
| **`web/domain/`** | Client-side domain store — accounts, contacts, deals, lifecycles, dual-write, product signals, RBAC |
| **`worker/`** | API — prep synthesize, post-call passes, contact enrich, search RAG, org structure, Freshdesk tickets, dispute notify; **persistence layer** for Cloud SQL dual-write |
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
├── janus/               # Janus v9.3 PostgreSQL schema + smoke tests
│   ├── schema/          # phases 00–12 (DDL)
│   ├── scripts/         # manage-partitions.mjs
│   └── tests/           # grants_smoke, rls_fails_closed
├── worker/              # Node API :8787
│   ├── src/data/persistence/  # Postgres + dual-write + outbox
│   ├── src/prep/        # Research, synthesize, fish sizing, recent news
│   ├── src/postcall/    # Multi-pass post-call pipeline
│   ├── src/freshdesk.ts # Freshdesk ticket create (disputes + feedback)
│   ├── src/notify-email.ts  # Manager dispute email notify
│   ├── secrets/         # Local secret files (gitignored except README)
│   └── scripts/         # apply-janus-schema, verify-db-env, dual-write-soak
├── docs/                # ADRs, RBAC, fix reports, SQL migration runbooks
├── firestore.rules      # Security rules (org structure, account team, artifacts)
├── deploy/vps/          # Production Docker + Caddy
├── deploy/cloudrun/     # Cloud Run deploy + Freshdesk/SQL secret setup
├── deploy/cloudsql/     # Cloud SQL provision + partition cron
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
git checkout feat/sql-foundation   # or main for stable portal-only work

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

# worker — Janus Cloud SQL smoke (grants + RLS; needs DATABASE_URL in .dev.vars)
npm run test:janus-smoke

# worker — full SQL QA gate (grants + RLS + view RLS + dual soak + tsc)
cd worker && npm run test:sql-gates

# worker — view RLS only (security_invoker on read-model views)
node janus/tests/view_rls.test.mjs

# worker — fresh schema install on empty DB (QA #1 repro gate)
node worker/scripts/repro-empty-db.mjs

# worker — dual-write soak (SQL + sync_outbox; needs DATABASE_URL)
npm run test:dual-soak

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

Production deploys from **`2.1`** (the deploy anchor). Developers branch from **`main`**, push `feat/` or `fix/` branches, and open PRs into **`main`**; do not create release branches for production deploys.

```bash
# Developer machine — push a feature/fix branch and open a PR into main
git checkout main
git pull origin main
git checkout -b feat/my-change
git push -u origin feat/my-change

# On VPS — update.sh auto-deploys the 2.1 deploy anchor
cd /opt/se-singha-paathai
cd deploy/vps && bash update.sh
```

Stable production line remains **`2.1`**. See [docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md).

#### Promotion checklist (before pushing a release branch to production)

1. **CI green** on the source branch — `web`, `worker`, and `rules` legs in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).
2. **Manually trigger [`Promotion Gate`](./.github/workflows/promotion-gate.yml)** (Actions tab → Promotion Gate → Run workflow) and confirm it's green — this runs the full fast test suite plus both live-Gemini evals (prep golden-set, post-call score self-consistency) in one pass.
3. **Note the Promotion Gate run URL** in the release commit or PR description, so there's a record of what was checked before this went live.
4. Only then run the VPS deploy steps below. `deploy/vps/update.sh` also runs its own fast/free test gate automatically before rebuilding the worker container (opt out with `SKIP_TEST_GATE=1` only for an urgent hotfix — see [docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md)).

For Freshdesk on Cloud Run: `FRESHDESK_API_KEY='…' bash deploy/cloudrun/setup-freshdesk-secret.sh` then confirm `GET /api/config` → `"freshdesk": { "configured": true }`.

### Push workflow summary

| Remote | Repo | Branch | Purpose |
|--------|------|--------|---------|
| **`origin`** | antonyanbu25/lionpath_V2 | **`main`** (`feat/` / `fix/` branches) | PR into **`main`** — Tony's fork / VPS |
| **`skut264`** | skut264/lionpath | `2.1` / features | Upstream / team development |

For the full branch naming policy, see [docs/BRANCHING.md](./docs/BRANCHING.md).

```bash
git checkout -b feat/my-change main
git push -u origin feat/my-change
# Open a PR into main
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
| [docs/SQL_BUILD_PLAN.md](./docs/SQL_BUILD_PLAN.md) | Cloud SQL migration build plan |
| [docs/SQL_QA_FIX_PLAN.md](./docs/SQL_QA_FIX_PLAN.md) | QA blocker fix plan (Phases 0–6) |
| [docs/SQL_QA_VALIDATION.md](./docs/SQL_QA_VALIDATION.md) | QA claim validation matrix (16/16 confirmed) |
| [docs/CUTOVER_SQL.md](./docs/CUTOVER_SQL.md) | Firestore → SQL cutover stages |
| [docs/CLOUDSQL_SECURITY.md](./docs/CLOUDSQL_SECURITY.md) | Cloud SQL QA security posture |
| [docs/PRECALL_GROUNDING.md](./docs/PRECALL_GROUNDING.md) | Pre-call grounding goal/status + Tier 3 backlog |
| [docs/PRECALL_GROUNDING_BUILD.md](./docs/PRECALL_GROUNDING_BUILD.md) | Grounding Tier 1/2 per-item build detail |
| [docs/FIREBASE_SETUP.md](./docs/FIREBASE_SETUP.md) | Firebase / production-like local |
| [docs/HARNESS_FINDINGS.md](./docs/HARNESS_FINDINGS.md) | Eval harness working log — real bugs the test suite caught |
| [deploy/cloudrun/README.md](./deploy/cloudrun/README.md) | Cloud Run + Freshdesk/SQL secrets |
| [deploy/cloudsql/README.md](./deploy/cloudsql/README.md) | Cloud SQL provision + worker wiring |
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
git checkout main
git pull                       # always pull latest first
git checkout -b feat/my-change # new work branches off main
# ... develop, npm test ...
git push -u origin feat/my-change
# Open a PR into main (the source of truth) on antonyanbu25/lionpath_V2
```

Branch naming: use `feat/<scope>` for features, `fix/<scope>` for fixes, `docs/<scope>` for documentation, and `chore/<scope>` for chores. Never branch off `2.1`; it is the production deploy anchor. Hotfixes are the only exception: PR them into `2.1`, then cherry-pick to `main`. See [docs/BRANCHING.md](./docs/BRANCHING.md) for the full policy.

**Do not commit:** `worker/.dev.vars`, `web/firebase-config.local.js`, `worker/secrets/*` (except README), API keys, `.cursor/` debug logs.

---

## License & ownership

Internal Freshworks SE tooling. Not for public distribution without approval.
