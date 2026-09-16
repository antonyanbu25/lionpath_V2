# Lionpath — SE Singha Paathai

**One portal for Freshworks Solution Engineers:** research prospects **before** the call, debrief **after** the call, and manage **accounts, contacts, deals, and team coaching** in one place.

| | |
|---|---|
| **Integration branch** | **`integrate/precall-assume-identity`** — **staging release candidate:** Pre-Call fixes (`fix/precall-fixes`) + Assume Identity (`feat/assume-identity-hardening`) on `main` @ `70897d7`. **Co-deploy web + worker.** See [docs/INTEGRATION_PRECALL_ASSUME_IDENTITY_FILE_MAP.md](./docs/INTEGRATION_PRECALL_ASSUME_IDENTITY_FILE_MAP.md). |
| **This branch (main)** | **`fix/extensive-deployment-review`** lineage — deployment review workstreams on current staging `main`. |
| **Portal build** | `2.1.45` (`web/index.html` `portal-build`, cache-busted CSS/JS) |
| **Worker build** | `2.1.41` (`worker/src/build-id.ts`, `GET /api/config`) |
| **Version file** | [`VERSION`](./VERSION) — build stamp **2.1.30** |
| **Live app** | [https://lionpath.benjaminsquare.com](https://lionpath.benjaminsquare.com) |
| **Live API** | [https://lionpathapi.benjaminsquare.com](https://lionpathapi.benjaminsquare.com) |
| **SE-Labs (this work)** | [github.com/Antony-sagayaraj/SE-Labs](https://github.com/Antony-sagayaraj/SE-Labs) — push via `git@github.com-se-labs:…` (`sowravsunil` SSH) |
| **Production deploy fork** | [github.com/antonyanbu25/lionpath_V2](https://github.com/antonyanbu25/lionpath_V2) (VPS pulls from here) |

---

## Table of contents

1. [What it does](#what-it-does)
2. [Assume identity hardening (feat/assume-identity-hardening)](#assume-identity-hardening-featassume-identity-hardening)
3. [SQL migration (feat/sql-foundation)](#sql-migration-featsql-foundation)
4. [Security hardening (feat/security-fixes)](#security-hardening-featsecurity-fixes)
5. [Pre-call grounding (feat/precall-grounding)](#pre-call-grounding-featprecall-grounding)
6. [QIP human calibration](#qip-human-calibration)
7. [SQL data model mapping (feat/sql-datamodel-mapping)](#sql-data-model-mapping-featsql-datamodel-mapping)
8. [SQL-only cutover (main — staging live)](#sql-only-cutover-main--staging-live)
9. [Extensive deployment review (this branch)](#extensive-deployment-review-this-branch)
10. [Release highlights](#release-highlights)
11. [Inherited from 2.1.1 / 2.1](#inherited-from-211--21)
12. [Architecture](#architecture)
13. [Repository layout](#repository-layout)
14. [Quick start (developers)](#quick-start-developers)
15. [Demo logins](#demo-logins)
16. [Testing](#testing)
17. [Deploy](#deploy)
18. [Documentation index](#documentation-index)
19. [Contributing & remotes](#contributing--remotes)

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

## Assume identity hardening (feat/assume-identity-hardening)

**GitHub branch:** [feat/assume-identity-hardening](https://github.com/Antony-sagayaraj/SE-Labs/tree/feat/assume-identity-hardening)

**Mirror-gate / SP-AIH (operator — you):** This line is the Sep-2026 assume-identity remediation drop. It is **not** the precall branch (`feat/precall-grounding` ships separately). History on SE-Labs may show **many commits behind `main`** until rebased; that is expected for this import path.

### What shipped

| Area | Change |
|------|--------|
| Web | Removed `index.html` inline impersonate; single `login-as-ui.js` path; menu gated by `GET /api/admin/assume-identity/capabilities` (SQL `isAdmin`) |
| API assume | `POST /api/admin/assume-identity` — audit **before** token mint (503 if audit fails); blocks nested assume |
| API exit | `POST /api/admin/assume-identity/exit` — **`requireReauth: true`**, no admin custom token (stolen assumed JWT cannot restore admin) |
| Legacy impersonate | `POST /api/admin/impersonate-token` only if `ALLOW_DEV_IMPERSONATE=1` (+ secret); not `NODE_ENV` |
| Authz | `domain-reads` accounts + call-payload offload use `canReadResource` / `assertCanReadResource` |
| Client | `inMemoryPersistence` on assume; `assumeIdentityExpired` handling; correlation-scoped assume headers |

### Runtime requirements (Node worker)

- `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `DATABASE_URL` (Postgres for admin role + `audit_log`)
- Assume is **not** available on Cloudflare Workers-only deploy (no Postgres)

### Docs & tests

| | |
|---|---|
| Design | [docs/ASSUME_IDENTITY_DESIGN.md](./docs/ASSUME_IDENTITY_DESIGN.md) |
| Build notes | [docs/ASSUME_IDENTITY_BUILD.md](./docs/ASSUME_IDENTITY_BUILD.md) |
| Worker tests | `cd worker && npm run test:assume-identity` |

### Local push (SE-Labs)

```bash
# SSH must use the GitHub user that is a collaborator (sowravsunil):
git remote get-url se-labs   # git@github.com-se-labs:Antony-sagayaraj/SE-Labs.git
git push se-labs feat/assume-identity-hardening
```

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
| **Agent SQL verification** | [docs/SQL_AGENT_VERIFICATION.md](./docs/SQL_AGENT_VERIFICATION.md) |
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

3. Verify network, then apply schema:

   ```bash
   node worker/scripts/verify-db-env.mjs
   node worker/scripts/verify-sql-network.mjs   # TCP + SELECT 1 — must pass before SQL claims
   node worker/scripts/apply-janus-schema.mjs
   ```

   See [SQL Agent Verification](./docs/SQL_AGENT_VERIFICATION.md) if the network gate fails (`ETIMEDOUT`).

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

## QIP human calibration

Branch **`feat/qip-human-calibration-discovery-na`** (SE Labs) — **the base of this branch** — makes Quality Coach scorecards match how directors actually score, and stops punishing discovery calls for incidents that never happened. **Re-analyse existing calls** — saved scorecards keep old numbers until then.

Full reviewer note: [docs/BRANCH_QIP_CALIBRATION.md](./docs/BRANCH_QIP_CALIBRATION.md). Spec: [docs/QIP_SCORING_V2_1.md](./docs/QIP_SCORING_V2_1.md).

| Change | What to know |
|--------|----------------|
| **Three passes** | Score → verifier → golden-set calibration. Pass 3 is on unless `SCORECARD_GOLDEN_PASS=0`. |
| **Add golden calls** | `python3 tools/import-qip-golden-xlsx.py sheet.xlsx` → paste into `worker/src/postcall/golden-set/examples.ts`. |
| **Discovery N/A** | On discovery, `objections` / `comp_pitch` / `case_study` are N/A when that moment never occurred. A 0 stays in the denom only when it happened and the SE missed it. |
| **NB discovery** | `storytelling` removed (credits 33 → 32). |
| **Category N/A** | If every child theme is N/A, the category is N/A, not 0. |
| **Identity merge** | Kaia **Andirius** ↔ Andrius email; **Matt Newman** ↔ `matthewn@`. |
| **Also on the branch** | Firestore→Postgres wiring, se-motion catalogs, Zoom share-link messaging — see the branch note. |

---

## SQL data model mapping (feat/sql-datamodel-mapping)

Branch **`feat/sql-datamodel-mapping`**, off `feat/qip-human-calibration-discovery-na`, maps the
Firestore data model onto PostgreSQL so that **every piece of functionality the code already
implements has a column to live in**.

**This is a database migration, not a data migration.** Postgres starts empty; nothing is copied
out of Firestore (D6). No functionality is added, changed or dropped.

> ### ⚠️ DB build requires testing in staging
>
> **Nothing in this branch has been applied to any database.** No `DATABASE_URL` was configured
> when it was written, so no migration has been executed, no rubric row has been written, and
> **not one of the AT-1…AT-5 acceptance tests has ever run against a live schema.**
>
> The SQL is structurally linted and every cross-file table / index / policy / trigger / FK
> reference resolves, but *written* is not *verified*. Before this branch is relied on:
>
> 1. Apply `00`–`29` to a **staging** Cloud SQL instance and confirm every file reports `ok`.
> 2. Run the rubric loader and confirm **19 profiles → 270 themes → 1350 sub-parameters**.
> 3. Run the full acceptance suite as `janus_app` and read every `[FAIL]` and `[APP ]` line.
> 4. Re-run `apply-janus-schema.mjs` a second time — every migration is written to be
>    idempotent, and that claim is untested.
>
> Do **not** point this at the production instance, and do **not** flip `PERSISTENCE_MODE`
> until steps 1–4 pass. Several migrations intentionally `RAISE EXCEPTION` when they find rows
> that predate the reshape; on a clean staging database that path never fires, so it is
> untested too.

Plan and rationale: **[docs/datamodel/](./docs/datamodel/)** — start with
[BUILD_PLAN.md](./docs/datamodel/BUILD_PLAN.md), then
[FIELD_MAP.md](./docs/datamodel/FIELD_MAP.md) for field-by-field mapping.

### What it changes

| Area | What to know |
|--------|----------------|
| **Score scale fixed** | `composite_score` was `CHECK 0..2` while the code's overall is 0–10 — **every score insert above 2 was rejected outright.** Now `0..10`, storing the raw value; the 8.0 leadership cap is applied on read, never stored. |
| **Rubric hierarchy inverted** | `rubric_theme` was the *parent* of `rubric` (one theme per rubric); a QIP profile contains 11–16 themes. Now `rubric → rubric_theme → rubric_parameter`. Profiles could not be stored at all before this. |
| **Profiles are rows** | 19 profiles → 270 themes → 1350 sub-parameters, loaded by `janus/scripts/load-rubric-catalog.mjs`. The call-type × motion matrix is **sparse** (19 of 24), enforced by the `rubric` table rather than by CHECK constraints. |
| **N/A is expressible** | Was `NOT NULL CHECK 0..2` in three places, so a discovery incident that never happened could not be recorded and a 0 was indistinguishable from an exclusion. Fixed on `scorecard_theme`, `scorecard_line` and `score_override`. |
| **Motion provenance** | `se_motion_source` records `resolved` / `override` / `defaulted`, and the column `DEFAULT 'new_business'` is dropped — a missing motion is now a loud error instead of a silently wrong profile. |
| **Identity relationships** | `app_user.manager_user_id`, `org_unit_leader` (4 capacities, temporal), `org_unit.default_se_motion` + `resolve_se_motion()` — replacing the hardcoded team/segment id sets in `se-motion.ts` / `se-motion.js`. |
| **Wired-up tables** | `call_participant` (5 kinds, real `app_user` FK), `task` RLS + write path, `audit_log` writer + triggers, `notification` delivery evidence, `account_se_team`, the three pricing books. |
| **Pre-call defect closed** | A brief with no `dealId` was written and then invisible (the read path inner-joins `deal`). Now rejected by `trg_pre_call_deal_required` at the data layer, not by whichever caller remembers to check. |

### Running it (staging only)

```bash
node worker/scripts/apply-janus-schema.mjs --dry-run   # lists all 33 files
node worker/scripts/apply-janus-schema.mjs             # needs DATABASE_URL_MIGRATIONS
node janus/scripts/load-rubric-catalog.mjs --dry-run   # works with no database
node janus/scripts/load-rubric-catalog.mjs
node janus/tests/acceptance/run_acceptance.mjs         # as janus_app, under RLS
```

The loader must run **before** the tests: `scorecard.rubric_id` is a `NOT NULL` foreign key, so
no score can be saved until the 19 profiles exist as rows.

### Known and deliberate

- **Only 2 of the 19 profiles are non-provisional** (`demo`/NB, `discovery`/NB). Every expansion
  profile is shadow-mode and out of aggregates by design (D25), so day-one ranking covers two
  call types in one motion until calibration promotes more.
- **Two acceptance assertions need application code**, not schema, and the suite reports them as
  `[APP ]` rather than failing: rejecting an unknown `post_call.detail` key, and the
  `upsertAppUser` / `upsertOrgUnit` production callers that still do not exist.
- **AT-5.5 contradicts the access model.** "An SE sees only themselves" is not true anywhere in
  this schema — every read policy is an org-path prefix match, so a team-scoped SE sees their
  team. Flagged rather than silently passed; changing it is an access-model decision.

---

## SQL-only cutover (main — staging live)

Merged 2026-09-04: branch **`feat/sql-only-cutover`** (Firestore→SQL cutover) into `main`,
verified and deployed to staging. Status: **`workerBuild 2.1.41`** serving on Cloud Run
(`se-labs-worker`), all CI checks green, `sql_fallback_log` shows **zero lost writes** since deploy.

| | What happened | Where |
|---|---|---|
| **Cutover merged** | `feat/sql-only-cutover` @ `caa3fb0` → `main` (merge `ffeea8f`): 8 conflicts resolved — migration list taken as branch superset, `resolveSqlSession` 3-arg signature kept, README stamps synced | `ffeea8f` |
| **Six upstream TS errors fixed** | All existed identically on the cutover branch (verified against the pure branch before merging): `EntityType` union missing `"task"`, `toMillis` undefined in `read-repository.ts`, `rowCount` null guard, `speaker: string \| null` type, `DealRow` import | `73e45d3` |
| **Buildpack deploy fix** | Staging Cloud Build failed twice: Google buildpacks detected a single `.py` file (`worker/scripts/import-qip-golden-xlsx.py`) and picked the **Python runtime** instead of Node — the container had no Node and died before listening on `PORT=8080`. Moved the script to `tools/` so `worker/` stays py-free. **Rule: never ship `.py` files inside `worker/`.** | `f42b7da` |
| **Recovery / prep-brief sync fix** | `POST /api/recovery/upload` 500'd on prepBriefs/disputes: the PG history backend only accepted `history|tasks|feedback` keys. Added `user_kv.sidecar` JSONB (migration `31_user_kv_sidecar.sql`, applied to the production `janus` database), extended `history-pg.ts` to map `recovery:sidecar:<kind>:<email>` keys onto it with a `jsonb_set` merge | `58bcd43` |

### Post-deploy verification (2026-09-04)

- Staging Cloud Run: `GET /api/config` → `workerBuild 2.1.41`, `history`/`tasks`/`feedback` storage all `pg`.
- CI: `SE-Labs-Staging`, `SE-Labs-Web-Staging`, `test (worker/web/rules)`, `eval` — all green.
- Data flowing: `pre_call` 88, `post_call` 290, `scorecard`/`scorecard_line` 2/10 (**scores above 2 now save** — the 0..2 constraint was a real blocker), `call_participant` 5, `task` 2, `audit_log` 165, `ai_run` 1,400+, accounts auto-provisioned.
- **Known behaviour (D24):** pre-call briefs generated **outside** a deal/lifecycle flow carry no `dealId`/`lifecycleId` and are intentionally NOT written to `pre_call` (`trg_pre_call_deal_required`). They live in the client sidecar instead. Briefs generated from the deal/account flow land in Postgres.
- Two transient Gemini flash-lite `remote_error`s on `synthesize` self-heal via retry on `gemini-3.6-flash` — nothing lost.

---

## Extensive deployment review (this branch)

Branch **`fix/extensive-deployment-review`**, based on `main` @ `5121bc4`. Two things, in
order: a **bounded set of non-functional fixes**, then a **read-only forensic re-audit** of
the whole system. Every fix has a test that fails before the change and passes after.

**Not deployed.** Migration `37` is not yet applied to staging, and the P5 telemetry below
is inert until it is.

### The fixes

| Workstream | What was wrong | Verification |
|---|---|---|
| **J-010** — lost writes | The account write predicate was evaluated **before** the statement that set `app.user_id`, so it ran with a NULL user and denied every write. **60/60 denials measured pre-fix.** Moved into `withSessionContext` as `accountWritableBySession()` | `test-account-writable-session.ts`, 5 assertions (`sql` lane) |
| **P1** — credentials | Five committed credential files, proven dead before deletion. Found a **second, different** exposure the prior audit missed | `scripts/scan-secrets.mjs` — 5 rules, masked output, blocking CI job: 5 findings → 0 |
| **P4** — authorization | Four holes: a cross-tenant IDOR write, a `global=1` feedback branch with no role check, an unbounded RAG query, and an offload handler that discarded its auth context. Write scope narrowed to owner-or-admin; **404 not 403**, to avoid an existence oracle | `test-route-authorization.ts`, 20-assertion matrix |
| **P5** — observability | Seven durable-write failures were silent. Added `logFallback` at each, plus `correlation_id`/`owner_public_id` (migration `37`). Removed a response field that leaked a **full stack trace** to the client | `test-fallback-telemetry.ts`, 18 assertions (`sql` lane) |
| **P10** — provider timeouts | **Ten** unguarded provider calls could hang forever (the prior audit said three). Added `fetchWithTimeout` with per-provider budgets; deliberately **no retry**. Classified all 31 LLM pass names | `test-provider-timeouts.ts`, 21 assertions against a real hung socket |
| **P15** — CI | 13 tests existed but were registered nowhere; e2e was suppressed by unit failures; no PostgreSQL in CI | `ai_run_insert` **13/15 → 15/15**; new `sql` lane, excluded from the hermetic default |
| **J-004 / J-017** — schema drift | Four migrations were on disk but absent from the applier's phase list. Fixing that exposed a latent **non-idempotency** the drift had been hiding (`22_scoring_reshape.sql` dropped a view a dependent view still needed) | 42 files apply from zero **and** on re-apply; drift = none |
| **J-014** — Analyse gate | The submit button was enabled-and-visible for ~87 ms with empty fields; superseded Zoom warm-ups were not aborted | First-frame rAF trace; reverting the fix re-fails the test |

### The audit

A 17-document package in [`docs/janus-forensic-reaudit-20260911/`](./docs/janus-forensic-reaudit-20260911/) —
findings `J-001`–`J-035` with 115 evidence IDs, each tagged `CODE-PROVEN`,
`TEST-REPRODUCED`, `STAGING-VERIFIED`, `FIXED-AND-VERIFIED`, `PARTIAL`, `STALE` or
`RUNTIME-BLOCKED`. Start at [`01-executive-summary.md`](./docs/janus-forensic-reaudit-20260911/01-executive-summary.md);
the ordered work list is [`13-remediation-roadmap.md`](./docs/janus-forensic-reaudit-20260911/13-remediation-roadmap.md).

**The finding that reframes the rest (J-028):** `PERSISTENCE_MODE` defaults to `sql` but
`PERSISTENCE_READ_MODE` defaults to **`firestore`**, and `persistenceReadReady()` is true
only for exactly `"pg"`. Composed, **PostgreSQL is write-only by default** and Firestore is
read-authoritative. Nothing reconciles them — the `sync_outbox` projector is populated only
in `dual` mode and is not running in any case. This explains two findings that previously
had no explanation: 283 of 345 post-calls have no scorecard, and 2812 of 2816 `ai_run` rows
cannot be joined to a call — **because the product reads neither, so nobody noticed.**

**Reading the deployed `PERSISTENCE_READ_MODE` is the single highest-value action available**
(`D1` in the roadmap). It is one command, and it decides whether half the roadmap is aimed
at data anyone consumes.

### Concurrency suite (P-C1)

`worker/scripts/test-concurrency-hazards.ts` — nine hazards exercised against a **disposable
local PostgreSQL** (`embedded-postgres`, loopback-guarded; never staging). Characterisation,
not pass/fail: each hazard has a recorded `EXPECTED` verdict and the suite fails on
divergence, so a fix must update the baseline in the same commit.

**Measured: 6 HAZARD, 3 SAFE.** `H9` refuted the audit's own prediction — the twelve unique
constraints named by no `ON CONFLICT` were inferred to raise raw duplicate-key errors, but
`upsertActivity`'s `existing` CTE selects on `public_id = $1 OR idempotency_key = $2`, so
that collision is found and updated, never inserted. **"Unnamed" does not imply
"reachable"** — each of the twelve needs its own test.

### Telemetry and dormant jobs (P9, P11)

Two of the six database workstreams are now implemented. **In both cases the audit's own
diagnosis was wrong, and the correction is the interesting part.**

**P9 — `ai_run` attribution (J-019, 4 of 2816 rows).** The audit said the call id never
reached `recordLlmUsage`. It did: `postcall/*.ts` set it on the `LlmRequest` and
`providers/index.ts` forwards it. The real cause is **ordering** — `handleAnalyzeCall` runs
every LLM pass and writes *no* activity row, and `POST /api/history` creates
`act_<callId>` only later, so the resolver was resolving against a row that did not exist
yet. Every time. The 4 rows that did resolve are re-analyses of an already-saved call.
`janus/tests/ai_run_insert.test.mjs` passes 15/15 because it seeds the activity **first** —
an ordering production never uses.

Migration `38` records the raw call id and resolves attribution at **read** time through
`v_ai_run_attributed`, rather than back-stamping `activity_id` with a trigger:
`18_ai_run_rls.sql` makes `ai_run` append-only on purpose, and a denormalised FK is not
worth re-granting `UPDATE` for. `attribution_source` distinguishes
`stored` / `resolved` / `unsaved_call` / `no_call_id`, so unattributable spend is never
counted as zero.

Second defect, same finding: `handleAnalyzeCall` called `requireUser` and **discarded the
result**, then passed the request body's `userId` to the pipeline. That is most of the 16.5%
`user_id` coverage *and* an attribution-spoofing hole — a caller could bill its token spend
to another user by setting one field, the same shape as J-025.

**P11 — the dormant mechanisms (J-021, J-023).** The audit said all four "exist and are
correct; each needs a Cloud Scheduler entry, not new code". True for the projector; not for
the others. `sync_outbox` had **no reader but the projector itself**, so a dead letter or a
stalled backlog was unobservable — and the reaper lives *inside* `claim_outbox_batch`, so a
stopped projector cannot report that it stopped. The rollup existed only as a CLI whose own
docstring said "not on a schedule". Added `GET /api/internal/outbox/health` and
`POST /api/internal/usage/rollup`.

The health endpoint reports `enqueueActive`, which matters: `enqueueOutbox` is called only
from `DualWriteRepository`, so in `sql` mode nothing enqueues and the 236 pending rows are a
**historical backlog** that can neither drain nor grow. An alert on `pending` alone would
fire once and never clear.

**`redact_pii()` is deliberately still unwired**, and wiring it is what surfaced:

**J-036 — `redact_pii()` was executable by `PUBLIC` and `janus_app`.** Migration `06` ends
with `GRANT EXECUTE ... TO janus_redactor`, which reads as a restriction. It is decorative:
PostgreSQL grants `EXECUTE` to `PUBLIC` by default, and `07_grants.sql:22` re-widens it with
`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO janus_app` — which runs *after* 06. The
routine is `SECURITY DEFINER` owned by `postgres`, so it bypasses RLS, and it irreversibly
`NULL`s `post_call.analysis`/`detail` for lost deals older than 12 months. `janus_app` is
the role the web worker connects as. Fixed in migration `39`, which revokes it and ends with
a `DO` block that raises if a future blanket grant re-widens it. The gate checks the
**effective** privilege, not the direct grant.

Schedules are written out in [`docs/scheduled-jobs.md`](./docs/scheduled-jobs.md) and are
**not applied** — they need `gcloud`.

### Test lane and concurrency (P-D1, P-C1 follow-up)

**The browser lane is green for the first time: 157/157 from a cold start.** It was
144/157, and the audit's explanation was wrong. It blamed J-015 — `waitUntil: "networkidle"`
never settling because of the looping `<video>` — but 11 of the 13 failures had a different
cause: `web/firebase-config.local.js` being **present** makes real Firebase auth boot,
resolve signed-out, and discard the session the specs inject. Measured `#app-shell`
`hidden` timeline: `t=0 hidden`, `t=171ms NOT hidden`, `t=701ms hidden`. A
`waitForSelector("#app-shell:not([hidden])")` lands inside that window and passes, so every
spec looked like it cleared its own boot check before failing on the next click.
`forceDummyAuth` in [`web/scripts/lib/e2e-dummy-auth.mjs`](./web/scripts/lib/e2e-dummy-auth.mjs)
makes the mode independent of machine-local state. J-015 is real for **4** specs and is
intermittent.

**Concurrency:** H1 (history lost update) and H7 (a duplicate person wiping the whole
participant set) are **fixed**; H6 went from unmeasured to **measured**. H4 is left open on
purpose — `id_registry` is 1:1 by construction, so an alias needs a migration and a decision
about which id wins; the remap now logs instead of being silent.

**`contact` has no RLS (J-038).** `account`, `deal`, `post_call`, `scorecard`, `ai_run` and
`user_kv` all carry RLS + FORCE; `contact` carries neither and has no policies at all. With
`GET /api/contacts?email=` taking an arbitrary email from any authenticated caller and
returning **records**, that is an unrestricted lookup over customer contact PII — not merely
the "existence oracle" the audit described. Not fixed: contacts are global by design, the
right scope is a product question, and enabling RLS is staging DDL. The posture is now
pinned by a baseline gate that fails if it changes in **either** direction.

**`POST /api/fetch-transcript` is not SSRF (J-037).** `08` §7 ranked it the top security
gap. Seven payloads — GCP metadata server, loopback PostgreSQL, the internal API, an
external host, `file://`, `zoom.us` as a domain *prefix*, and the userinfo `@` trick — were
all rejected with **zero outbound requests**. The protection is one layer below the handler,
and the load-bearing part is the `/rec/` anchor rather than the host allowlist, so it is now
pinned by a gate.

### Known-open, deliberately not fixed here

Four of the six **database** workstreams remain re-verified-and-open, not implemented:
`P2`/`J-026` (non-destructive `post_call` UPSERT), `P3`/`J-033` (writer convergence),
`P7`/`J-020` (283 missing scorecards), `P8`/`J-012` (`pipeline_state`, one value on 345/345
rows). `P7` and `P8` are blocked on `D1` — if reads come from Firestore, a missing PostgreSQL
scorecard is a *projection* failure rather than a scoring failure and the fix is a different
fix. Specified as runnable prompts in
[`14-implementation-prompts.md`](./docs/janus-forensic-reaudit-20260911/14-implementation-prompts.md).

Also open: **H2** (J-026, = P2), **H3** (J-033, = P3), **H4** (J-034, needs a migration and
an identity decision) and **H6** (non-atomic clear-then-append, = P3). **Phase 2**
(identity → motion) is blocked on provisioning `org_unit_id` for 16 users, which is staging
DML and must not be inverted with the motion fix.

### Suite state at branch tip

| | |
|---|---|
| Worker TypeScript | `tsc` clean |
| Worker tests | **105 / 105** |
| Web tests | **158 / 158** — 141 unit + 17 e2e, from a cold start with no worker API running |
| `test:sql-gates` | exit 0 end to end — 8 gates including the dual-write soak |
| `scripts/scan-secrets.mjs` | exit 0 |
| Bundle | byte-identical at 373.4 KB |

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

## Bug fixes (base branch)

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

# worker — daily usage rollup for yesterday + today (needs DATABASE_URL as janus_app)
node worker/scripts/rollup-user-usage.mjs

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
| [docs/SQL_AGENT_VERIFICATION.md](./docs/SQL_AGENT_VERIFICATION.md) | Agent runbook: network gate, SQL write proof, silent Firestore fallback |
| [docs/QIP_SCORING_V2_1.md](./docs/QIP_SCORING_V2_1.md) | QIP spec (credits, profiles, discovery incident N/A) |
| [docs/BRANCH_QIP_CALIBRATION.md](./docs/BRANCH_QIP_CALIBRATION.md) | Base branch: three-pass scoring, golden set, identity merge |
| **[docs/datamodel/](./docs/datamodel/)** | **This branch: NoSQL → PostgreSQL data model. Start at [BUILD_PLAN.md](./docs/datamodel/BUILD_PLAN.md)** |
| [docs/datamodel/FIELD_MAP.md](./docs/datamodel/FIELD_MAP.md) | Firestore field → SQL column, table by table |
| [docs/datamodel/DECISIONS_LOG.md](./docs/datamodel/DECISIONS_LOG.md) | D1–D27, authoritative — the decisions the model implements |
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

## Merge history: pre-merge changes to `main` (for AI IDEs & reviewers)

When asking an AI IDE to fix or modify this repo, reference this section first: it explains
**why `main` contains commits that are not a straight line from any single branch**, and what
constraints were honored while merging. Written 2026-09-07 by the Gideon agent session; verify
against `git log` if anything looks stale.

1. **Reconciled with PR #3 instead of overwriting it.** The attached PG patch and a teammate's
   concurrent PR both touched `worker/src/data/persistence/postgres-repository.ts`. The patch was
   split so `main` received only the slug-reuse + rubric auto-provision parts; the teammate's
   commits stayed intact. *Why: a force-push would have destroyed merged work.*
2. **Build stamp bumped to 2.1.41** (`worker/src/build-id.ts`). *Why: makes the serving build
   verifiable via `GET /api/config` instead of guessing from deploy logs.*
3. **Merged, not force-pushed, when `lionpath_V2` main moved mid-flight.** Preserved 10 commits
   from PR #5 (account slug-collision fix, CTE activity fix, partial-index `ON CONFLICT`, history
   dual-writes). *Why: the remote had moved during the work; rewriting history would have lost
   those fixes.*
4. **UI rollback required explicit file restores.** After `feat/mono-ui-overhaul` was reverted,
   the git merge auto-kept `main`'s new-UI versions for files touched after the rollback point.
   Old-UI files were force-restored and `test-user-menu.mjs` re-pointed to the SE Labs brand.
   *Why: default merge behavior silently keeps the newer UI; the intent was old UI + all
   functional fixes.*
5. **Adopted anbu's newer `web/app.js` and `web/styles.css` into SE** (local-recovery
   `autoSyncOnLogin` wiring, KPI hover polish). *Why: anbu was ahead on those two files; taking
   them kept the codebases converging instead of diverging.*
6. **UI divergence is intentional.** As of 2026-09-07: SE-Labs `main` serves the OLD UI (orbit
   spinner, Dew palette, SE Labs brand) while `feat/mono-ui-overhaul` on `lionpath_V2` holds the
   new UI (Janus rebrand, thinking-orbs loader, mono editorial styles) parked for a later merge.
   Do not "fix" this difference by porting UI files in either direction without checking which
   side is supposed to have which.

Related: [docs/plans/](./docs/plans/) holds the PG-flip wave plans; the Ongrid duplicate root
cause lives at `docs/plans/2026-09-02-ongrid-duplicate-root-cause.md` on `lionpath_V2`.

---

## Contributing & remotes

```bash
# Add skut264 upstream (once)
git remote add skut264 https://github.com/skut264/lionpath.git

# Add production fork (once)
git remote add antony https://github.com/antonyanbu25/lionpath_V2.git

# SE Labs (Cloud Run / Cloud Build source)
git remote add selabs https://github.com/Antony-sagayaraj/SE-Labs.git

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
