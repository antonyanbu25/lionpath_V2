# Database Wiring Fixes — SQL Cutover Stabilization

**Window covered:** 2026‑09‑07 → 2026‑09‑11
**Branches:** `main` (Sep 7–10 fixes) → `fix/janus-handover-and-forensic-reaudit-20260911` (Sep 11 fixes)
**Author:** Nitish Radha

This is a handoff doc, not the audit trail. If you need the exhaustive evidence
(measurements, row counts, staging queries, test output) it's all in:

- [`docs/janus-forensic-reaudit-20260911/12-findings-ledger.md`](./janus-forensic-reaudit-20260911/12-findings-ledger.md) — the finding-by-finding log (J‑001…J‑018), each with reproduction steps
- [`docs/merge-audit/DATABASE_GUARDRAIL_REPORT.md`](./merge-audit/DATABASE_GUARDRAIL_REPORT.md) — proof that a parallel functional-fix merge touched zero schema/persistence code
- [`docs/janus-forensic-reaudit-20260911/_audit-state.md`](./janus-forensic-reaudit-20260911/_audit-state.md) — environment/tooling constraints for this repo (no `gcloud`, no Java, etc.)

This doc is the "what was broken, why, and what changed" summary so you don't
have to reconstruct it from 30+ commit messages.

---

## Background

Per [ADR‑008](./adr/008-firestore-to-sql-decision.md), PostgreSQL (via the
worker API) is the target read/write path; Firestore is legacy. The worker's
`PERSISTENCE_MODE` flag controls this per-request: `firestore` → `dual`
(SQL-primary + outbox to Firestore) → `sql` (SQL only). Staging/prod are
supposed to be running `sql`.

The problem this whole window addresses: **the SQL cutover had landed in
code, but the wiring between "user clicks save" and "row lands in
PostgreSQL" had multiple independent breaks.** None of them were exceptions
that crashed anything — they were silent authorization denials, silent
no-ops, and silently-discarded fields. The API returned 200, the UI looked
fine, and the row either never existed or existed with missing/wrong data.
`sql_fallback_log` (the table built specifically to catch this) had **1,280
rows on staging**, most of them invisible until this window because nothing
surfaced them.

---

## What was actually broken, grouped by cause

### 1. Writes silently refused — RLS / session-context wiring

The biggest single bucket of lost writes. Two separate bugs, same shape:
the RLS predicate that gates a write was evaluating against the *wrong
session state*.

- **`account`/`account_se_team` RLS self-recursion** — [`1730aa7`](https://github.com/Antony-sagayaraj/SE-Labs/commit/1730aa7)
  `fix(db): break account/account_se_team RLS self-recursion`.
  Both tables' `FOR ALL` policies called `account_writable_by_current_user()`,
  which queried the other table, whose policy called the same function again
  — infinite recursion, "stack depth limit exceeded" on `/api/accounts` and
  `/api/domain-write` in production. Fixed by splitting each `FOR ALL` policy
  into `INSERT`/`UPDATE`/`DELETE` so `SELECT` stays governed by the existing
  non-recursive read policy.

- **`account_writable_by_current_user()` evaluated with a NULL user** —
  [`0b59d5e`](https://github.com/Antony-sagayaraj/SE-Labs/commit/0b59d5e) `fix(persistence): evaluate the account
  write predicate with a real session`. The Sep 7 P0 fix ran the predicate
  and the `set_config()` that sets `app.user_id` **in the same SELECT target
  list**. Postgres doesn't guarantee target-list evaluation order and the
  predicate was listed first, so it always saw the *pre-statement* (unset)
  value. Measured 60/60 deterministic denials. Worse, the `set_config` call
  wasn't even inside a transaction, so the value couldn't have persisted to a
  later statement anyway. **This alone accounts for 1,130 of the 1,249
  `not_authorized` rows in `sql_fallback_log` — the largest lost-write bucket
  on staging.** Fixed by extracting the check into
  `accountWritableBySession()` in
  [`worker/src/data/persistence/session-context.ts`](../worker/src/data/persistence/session-context.ts),
  routed through `withSessionContext`, which opens a real transaction and
  sets the session variables in an earlier statement. Regression test:
  `worker/scripts/test-account-writable-session.ts`.

- **`account_se_team` was never populated** — [`b14b139`](https://github.com/Antony-sagayaraj/SE-Labs/commit/b14b139)
  `fix(worker): populate account_se_team on write + fix deal-creation
  authorization to read it`. The RLS schema for account ownership was correct,
  but nothing ever inserted into `account_se_team`, and `handleDealsCreate`
  was still checking a Firestore-shaped `primarySeUserId` field that's never
  populated for SQL-era accounts. Every SE saw "You are not authorized to
  create deals for this account" on any account created since the SQL
  cutover. Fixed with `seatAccountSeTeamMember()` wired into
  `createAccount`/`updateAccount`, and `handleDealsCreate` now defers to the
  same `account_writable_by_current_user` predicate.

**Takeaway:** if you're debugging a new "not authorized" write failure,
check session-context wiring first — specifically whether the RLS session
variable is guaranteed to be set *before* the predicate that reads it runs,
in the same transaction.

### 2. API-store methods that were 501s or silent no-ops

Leftover stubs from the Firestore→SQL migration that were never filled in:

- [`c58d78d`](https://github.com/Antony-sagayaraj/SE-Labs/commit/c58d78d) `implement getUserByEmail/getUserIdByAuthUid/getUser on the API store`
- [`c0978ec`](https://github.com/Antony-sagayaraj/SE-Labs/commit/c0978ec) `implement upsertUser/upsertAuthIndex no-ops on the API store`
- [`15c29d0`](https://github.com/Antony-sagayaraj/SE-Labs/commit/15c29d0) `stop remaining SE-role updateContact/updateAccount 501s + give contacts a real Postgres read path`
- [`39db584`](https://github.com/Antony-sagayaraj/SE-Labs/commit/39db584) `resolveSqlSession's primary lookup never selected email, so login tracking silently no-op'd`
- [`cb435ad`](https://github.com/Antony-sagayaraj/SE-Labs/commit/cb435ad) `stop upsertFirebaseUser from silently rebinding authIndex to a fresh dummy profile`

Pattern across all five: the SQL-mode branch of the store existed and
compiled, but either returned a stub (`501`), returned `null`/no-op'd
without an error, or queried the wrong column — so the caller had no signal
that anything had gone wrong.

### 3. Data landing, but incomplete or wrong

Writes that *succeeded* but didn't persist what the caller sent:

- [`755282e`](https://github.com/Antony-sagayaraj/SE-Labs/commit/755282e) `SQL-mode upsertPostCallWithSummary now writes callSummaries, unblocking deal/account summaries` —
  the handler only ever read `args[0]`; `callSummary` (`args[1]`) was
  silently discarded on every write since SQL mode went live. `account.calls`
  came back empty and deal/account summaries never regenerated.
- [`739a97a`](https://github.com/Antony-sagayaraj/SE-Labs/commit/739a97a) `make deal/account summaries read call history from SQL, not Firestore` — companion fix, the read side.
- [`310c7ab`](https://github.com/Antony-sagayaraj/SE-Labs/commit/310c7ab) `pre-call data now actually lands in SQL, so usage reporting has something to count`
- [`7ece801`](https://github.com/Antony-sagayaraj/SE-Labs/commit/7ece801) `bump pre_call.input_snapshot to shape v2 for seAdditionalContext`
- [`0dfd6b1`](https://github.com/Antony-sagayaraj/SE-Labs/commit/0dfd6b1) `make upsertPostCall race-safe on public_id, not just idempotency_key`
- [`731704a`](https://github.com/Antony-sagayaraj/SE-Labs/commit/731704a) `P0 prep-save data loss - no silent drop without companyDomain; SE updateAccount defers to RLS predicate; derived placeholder accounts + forensics logging` — the original Sep 7 fix this whole window traces back to.
- [`78b5535`](https://github.com/Antony-sagayaraj/SE-Labs/commit/78b5535) `add missing "research" value to deal_stage_enum`
- [`c504fd7`](https://github.com/Antony-sagayaraj/SE-Labs/commit/c504fd7) `remove confidence threshold from v_scorecard_rankable, update AT-4 accordingly`
- [`300fed4`/`fb292e4`](https://github.com/Antony-sagayaraj/SE-Labs/commit/fb292e4) `default PERSISTENCE_MODE to sql, not dual`

### 4. Schema drift & idempotency (`J‑004`, `J‑017`)

- **Four schema files existed that no automated apply path ran.**
  `19_history_tasks_feedback.sql`, `34_usage_and_leaderboard_views.sql`,
  `35_fix_account_rls_recursion.sql`, `36_add_research_deal_stage.sql` were
  listed in `init_all.sql` but missing from the `PHASE_FILES` array that the
  only `npm`-aliased apply path uses. Net effect: a from-zero install lacked
  the leaderboard view, carried the unfixed RLS recursion, and had no
  `research` deal stage — while staging had all three (applied by hand,
  off-path, at some point). Staging also carries three undeclared
  `*_admin_write` RLS policies that don't exist in the repo at all — nobody
  can reproduce staging's actual grant surface from a clean checkout.
  Fixed in [`56833ae`](https://github.com/Antony-sagayaraj/SE-Labs/commit/56833ae) by adding 34/35/36 to
  `PHASE_FILES` in `worker/scripts/apply-janus-schema.mjs`.

- **That fix immediately broke idempotency.** Re-applying the schema failed:
  `cannot drop view v_scorecard_rankable because other objects depend on it`
  — migration 22 drops that view, migration 34's `v_se_score_leaderboard`
  depends on it. The two defects had been hiding each other (34 was never
  applied, so the dependency never existed on a from-zero install). Fixed by
  having 22 explicitly drop the dependent view first — deliberately **not**
  `CASCADE`, since a cascade would silently take out any future dependent
  too, which is exactly the class of thing that caused this. Verified: 42
  files, first apply and re-apply both exit 0, drift = none.

### 5. Failures were invisible — observability (`P5`)

`sql_fallback_log` already existed and was well-designed, but three gaps
meant most failures never reached it:

- Seven early-return paths in `tryHistoryPostCallSqlWrite` were silent or
  console-only (e.g. no session, unmapped parent, shape validation failure).
  A `POST /api/history` returns 200 regardless, so a skip was invisible in
  both the response and any queryable record.
- A thrown write error was surfaced by putting the **full stack trace** in
  a `_sqlDualWriteError` response field, labeled `TEMP DEBUG` from an earlier
  investigation, with **no consumer anywhere** in the codebase. Replaced with
  a queryable `write_error` row; the stack now stays server-side only.
- No correlation id, and the actor (who clicked save) was conflated with the
  owner (whose data it is) — in a manager-proxy flow those differ, so a lost
  write got attributed to the wrong person.

Fixed in [`56833ae`](https://github.com/Antony-sagayaraj/SE-Labs/commit/56833ae) `fix(observability): make failed
durable writes queryable and attributable (P5)`:
`janus/schema/37_fallback_correlation.sql` adds `correlation_id` and
`owner_public_id` to `sql_fallback_log` plus an 8‑arg `log_sql_fallback`
(the old 6-arg version is dropped, not kept alongside — two overloads would
make every existing call site ambiguous). `logFallback` reads the
correlation id ambiently from `worker/src/request-context.ts`, so no call
site had to be threaded through. 18 new assertions in
`worker/scripts/test-fallback-telemetry.ts`.

**Content of the log, once it could finally be read (Sep 11):**

| Reason | Count | | Method | Count |
|---|---|---|---|---|
| `not_authorized` | 1,249 | | `updateAccount` | 1,130 |
| `no_sql_session` | 22 | | `updateContact` | 103 |
| `unmapped_parent` | 4 | | `createAccount` | 14 |
| `shape_validation_failed` | 3 | | `createContact` | 11 |
| `method_not_implemented` | 2 | | `createPrepBrief` / `upsertScorecardLine` | 5 each |

By mode: **1,015 of these are `sql`-mode**, which the schema's own view
comment defines as lost writes (Firestore never caught them). Active range
2026‑09‑03 → 2026‑09‑11, still accruing as of the last check. `updateAccount`
alone is explained by the RLS session-context bug in section 1.

**Important:** migration 37 (the correlation-id columns) has **not** been
applied to staging yet — that requires DDL approval. Until it is,
`logFallback` against staging will call an 8-arg function that doesn't exist
there, fail, and be swallowed. Applying it is a prerequisite for deploying
this fix, not a follow-up.

### 6. The test suite was lying about DB coverage

[`787c8aa`](https://github.com/Antony-sagayaraj/SE-Labs/commit/787c8aa) `ci: make the suite trustworthy —
PostgreSQL, loud DB gates, no orphan tests (P15)`:

- `web/scripts/run-tests.mjs` gated the entire e2e batch on every unit test
  passing — one failing unit test silently skipped every e2e file. The
  suite got *smaller*, not redder, exactly when something was already wrong.
- Three database gates **exited 0 on an unset `DATABASE_URL`** — indistinguishable
  from a pass, in precisely the environment where they verified nothing. Now
  they exit 1 by default, with `--allow-skip` as an explicit local opt-out.
- 13 orphan test files (9 worker, 4 web) existed but were never registered
  in the manifest, so they never ran in CI regardless of pass/fail.
- Added a CI job that applies the schema from zero, applies it **again**
  (the only thing that catches the class of idempotency bug in section 4),
  then runs the SQL gate suite — pinned to `postgres:16` because staging is
  16.14 while local dev runs 18.4 (see "still open" below); CI, not a laptop,
  is the release authority for that question.

---

## Still open — do not assume these are fixed

These were **found and documented** this window but are not yet remediated.
If you're picking up related work, start here rather than re-discovering
them:

- **Three PostgreSQL major versions across the stack** (`J‑005`): local
  dev/test runs 18.4, staging runs 16.14, the provisioning script asks for
  15. A query or collation behavior that passes locally can differ on
  staging and differ again on a freshly provisioned instance.
- **`PERSISTENCE_MODE` still resolves to different defaults by deploy
  target** (`J‑007`): Node/Cloud Run entry point defaults to `sql`, but VPS
  docker-compose defaults to `firestore`, the Cloud Run secret-attach script
  and Cloud SQL README say `dual`, and local bootstrap forces `firestore`.
  There is no single source of truth for "what mode is production actually
  running." Deployed Cloud Run config could not be inspected this window
  (no `gcloud` access) — this needs a live check, not more code reading.
- **`se_motion` is uniformly `new_business` on staging** (`J‑011`) despite
  two org units configured for `expansion` — 345/345 `post_call` rows,
  62/62 `scorecard` rows. `post_call.se_motion_source` is `NULL` on every
  row (the column exists but isn't in the insert/update column list in
  `postgres-repository.ts`), while `scorecard.se_motion_source` claims
  `'resolved'` on all 62 — a positive claim that's contradicted by the org
  configuration. Scoring-fairness impact: an Expansion SE is being scored
  against a New Business rubric.
- **`pipeline_state` never advances past `analysis_done`** (`J‑012`): 345/345
  rows stuck at that state despite 62 scorecards existing (so scoring
  demonstrably happened). Confirms a prior finding that two writers both
  hardcode `analysis_done` instead of deriving state from artifact presence.
- **Correlation id lives in a module-level variable, not
  `AsyncLocalStorage`** (`J‑018`): correct for nested calls, not for
  interleaved concurrent requests under Cloud Run concurrency > 1 — a lost
  write's recorded correlation id could belong to a different request. Still
  recorded (better than nothing), just not safe to trust for attribution yet.
- **`POST /api/history` returns 200 regardless of whether the SQL write
  succeeded** (`B‑08`, blocked for a product/architecture decision on which
  store is authoritative for that response — not a bug fix, a decision).
- **Staging's actual grant/RLS surface can't be reproduced from the repo**:
  three `*_admin_write` policies on `activity`/`post_call`/`pre_call` exist
  on staging with zero declaration anywhere in `janus/schema/`.

---

## How to verify any of this locally

No staging/prod database is touched by any of the tests below.

```bash
# schema from zero + idempotent re-apply (catches J-017-class defects)
DATABASE_URL_MIGRATIONS=<disposable db> node worker/scripts/apply-janus-schema.mjs
DATABASE_URL_MIGRATIONS=<same db>       node worker/scripts/apply-janus-schema.mjs   # must also exit 0, drift = none

# the RLS session-context regression test (section 1)
npx tsx worker/scripts/test-account-writable-session.ts

# the fallback-telemetry gate (section 5) — needs migration 37 applied locally first
npx tsx worker/scripts/test-fallback-telemetry.ts

# everything DB-touching in one lane
npm run test:sql-gates --prefix worker
```

The SQL test lane is intentionally excluded from the default hermetic
`npm test` so that suite stays DB-free; these fail loudly (exit 1) rather
than skipping green when no database is configured.

## Key files if you're extending this

| Concern | File |
|---|---|
| RLS session variables (`app.user_id`, etc.) | [`worker/src/data/persistence/session-context.ts`](../worker/src/data/persistence/session-context.ts) |
| SQL write implementations | [`worker/src/data/persistence/postgres-repository.ts`](../worker/src/data/persistence/postgres-repository.ts) |
| Lost/skipped-write logging | [`worker/src/data/persistence/fallback-log.ts`](../worker/src/data/persistence/fallback-log.ts) |
| Persistence-mode resolution | [`worker/src/data/persistence/types.ts`](../worker/src/data/persistence/types.ts), [`worker/src/data/persistence/index.ts`](../worker/src/data/persistence/index.ts) |
| Route-level write handlers | `worker/src/routes.ts` |
| Schema apply order | `worker/scripts/apply-janus-schema.mjs` (`PHASE_FILES`) vs `janus/schema/init_all.sql` — **must list the same files in the same order** |
| Per-migration SQL | `janus/schema/*.sql` |
| Client store abstraction (SQL vs Firestore mode) | `web/domain/store.js` (`resolveReadMode`/`resolveWriteMode`, ADR‑008) |
