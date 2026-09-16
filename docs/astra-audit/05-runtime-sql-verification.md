# 05 — Runtime SQL Verification

**Snapshot audited:** `SE-Labs` @ `c58eac930f8676e73a8406b9909c87b3f179b21c`, branch `main`, `VERSION` 2.1.30, 2026-09-08.
**Related:** [_evidence-index](_evidence-index.md) · [03-postcall-write-ledger](03-postcall-write-ledger.md) · [04-sql-persistence-map](04-sql-persistence-map.md) · [06-bugs-and-risks](06-bugs-and-risks.md) · [08-test-coverage](08-test-coverage.md)

---

## 1. Environment classification

Per the audit's scope boundary, no write may touch an environment that cannot be positively classified.

| Candidate | Present? | Classification | Evidence (values never displayed) |
|---|---|---|---|
`DATABASE_URL` in the shell environment | no | n/a | `[ -n "$DATABASE_URL" ]` → UNSET |
`worker/.dev.vars` | yes | contains **only** `FIREBASE_PROJECT_ID` and `GEMINI_API_KEY` — **no** `DATABASE_URL`, **no** `DATABASE_URL_MIGRATIONS` | key-name extraction only |
`worker/.env`, `deploy/vps/.env` | **absent** | n/a | `ls` → No such file |
Any listening Postgres on 5432 | none found | n/a | `lsof -nP -iTCP:5432 -sTCP:LISTEN` → no result |
Staging / production Cloud SQL | **not reachable and not classifiable** | **UNKNOWN → do not touch** | no credentials exist in this working copy |

**Conclusion:** no shared, staging, or production database was contacted at any point in this audit (`R-001`). No paid external API was called (`R-002`).

### 1.1 The disposable environment that WAS used

To obtain real runtime evidence without touching any classifiable-as-unknown system, a brand-new PostgreSQL cluster was created **inside the session scratchpad**, on a non-default port, and used for nothing else.

| Property | Value |
|---|---|
Engine | PostgreSQL 18.4 (`@embedded-postgres/darwin-arm64`, vendored in `worker/node_modules`) |
Cluster path | session scratchpad (`.../scratchpad/pgdata`) — outside the repository |
Port | `55432` (never 5432) |
Contents at creation | empty `initdb` cluster; no pre-existing data of any kind |
Repository files modified to create it | **none** — in particular `worker/.dev.vars` was NOT touched, so `worker/scripts/start-local-postgres.mjs` was deliberately NOT used (it rewrites that env file, which the audit scope forbids) |
Classification | **disposable local**, positively established: the cluster did not exist before this audit and contains only fixtures this audit created |

Schema was applied with the repository's own installer, driven purely by environment variables so `.dev.vars` remained untouched:

```
DATABASE_URL_MIGRATIONS=<disposable local> node worker/scripts/apply-janus-schema.mjs
```

Result: **38 of 38 `PHASE_FILES` applied `ok`**, ending at `33_user_usage.sql`. 64 tables in `public`.

---

## 2. R-003 — Migration 34 is genuinely never applied by the automated path

**Status: RUNTIME-VERIFIED.** Upgrades `E-052` from CODE-PROVEN to RUNTIME-VERIFIED.

After running the only automated installer against an empty database:

| Probe | Result |
|---|---|
`SELECT count(*) FROM pg_views WHERE viewname='v_se_score_leaderboard'` | **0** |
`SELECT count(*) FROM pg_tables WHERE schemaname='public'` | 64 |
`app_user` row `usr_janus_ai` (system sentinel) | present (created by phase 00) |

`janus/schema/34_usage_and_leaderboard_views.sql` is referenced only by `janus/schema/init_all.sql:56`. Any environment provisioned by `npm run schema:apply` (or by `start-local-postgres.mjs`, which shells out to the same installer) is missing it. Only a human running `\i janus/schema/init_all.sql` in `psql` gets it.

Current blast radius is **latent**: a repo-wide grep for `v_se_score_leaderboard` finds no application consumer. It becomes real the moment a leaderboard surface ships.

---

## 3. R-004 — F-001 reproduced: the dual-writer idempotency collision aborts the post-call domain write

**Status: TEST-REPRODUCED.** Upgrades `F-001` from CODE-PROVEN to TEST-REPRODUCED.

Harness: [`repros/repro-h2-dual-writer-idempotency-collision.ts`](repros/repro-h2-dual-writer-idempotency-collision.ts)
It drives the **real** `PostgresRepository` methods that `routes.ts` drives, in the real order, inside one real transaction.

### Setup — mirrors the production existing-account flow

| Field | Writer 1 (`POST /api/history` → `tryHistoryPostCallSqlWrite`) | Writer 2 (`POST /api/domain-write` → `upsertPostCallWithSummary`) |
|---|---|---|
`post_call.public_id` | `pc_astra_h2_0001` | `pc_astra_h2_0001` — **same** |
`activity.public_id` | `act_pc_astra_h2_0001` | `act_pc_astra_h2_0001` — **same** |
`idempotency_key` | `call_pc_astra_h2_0001` (`routes.ts:2976`, because the history record has no `callIdentityKey` — `E-022`) | `call_zoom:astrah2abc` (`routes.ts:2729`, from `web/domain/dual-write.js:233`) — **different** |
`detail` | `null` (`routes.ts:2996`) | populated |
`pipeline_state` | `'analysis_done'` (`routes.ts:3000`) | `'analysis_done'` |

### Observed output (verbatim)

```
[1] history writer inserted post_call id=1 idempotency_key=call_pc_astra_h2_0001
[1] row state: {"idempotency_key":"call_pc_astra_h2_0001","pipeline_state":"analysis_done","detail_null":true}
[2] domain writer upsertActivity OK (CTE resolved on public_id — activity is safe)
[2] domain writer upsertPostCall FAILED: 23505 on constraint post_call_public_id_key
[2] message: duplicate key value violates unique constraint "post_call_public_id_key"
[3] FINAL row: {"idempotency_key":"call_pc_astra_h2_0001","marker":"history-writer","detail_null":true,"pipeline_state":"analysis_done"}
[3] rows for public_id pc_astra_h2_0001: 1
```

### Mechanism, precisely

1. `PostgresRepository.upsertActivity` (`postgres-repository.ts:346-393`) is **safe**: a CTE resolves an existing row on `public_id OR idempotency_key`, preferring `public_id`, and UPDATEs it. It does not raise.
   *(An earlier reading of this audit's own draft assumed `upsertActivity` was the failing statement. The repro locates the failure precisely at `upsertPostCall`; `upsertActivity` is correct.)*
2. `PostgresRepository.upsertPostCall` (`postgres-repository.ts:416-441`) has **no such CTE**. It conflict-targets only `ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL`.
3. `post_call.public_id` is `text UNIQUE NOT NULL` (`janus/schema/02_phase2_activities.sql:88`) and `activity_id` is `NOT NULL UNIQUE` (`:90`), neither of which is a conflict target.
4. The second writer's INSERT therefore finds no conflict on `idempotency_key`, proceeds, and violates `post_call_public_id_key`.
5. `upsertReturningId` (`id-registry.ts:74-94`) does not handle `23505`.
6. `withSessionContext` (`session-context.ts:349-351`) ROLLBACKs the **entire** transaction and rethrows.
7. `trySqlDomainWrite` has no try/catch around it (`E-028`); the error escapes to `index.ts:148-159` → HTTP 500 with the body rewritten to `"Internal error."`.
8. The browser logs `console.warn("Lifecycle dual-write (post-call) failed:", err)` and carries on (`web/app.js:3229-3234`, `E-029`).

### Consequence

`linkPostCallToLifecycle` throws at `attachPostCall`. Everything sequenced **after** that call never runs:

scorecard · call participants · videoFacts · call timeline · followUps · objections · MoM draft · MEDDPICC qualification · technical commit + TC deltas · **deal traction rollup (Pass 8)** · ARR persistence · Pass 6 product gaps · gap clustering · **deal + account summaries (Pass 9)** · contact frameworks · deal-contact links · call identity stamping.

The account, the deal and the contacts DO land, because `resolveEngagementEntities` and `getOrCreateLifecycle` run *before* `attachPostCall`. That is exactly the observed production shape: populated CRM tables, an empty `scorecard` table.

### Independent corroboration from the repository itself

`janus/schema/34_usage_and_leaderboard_views.sql:15-21` (`E-055`):

> As of this migration, `v_scorecard_rankable` has rows for exactly 2 calls (both 2026-09-03) — every real call since has 0 rows in `scorecard`, because `linkPostCallToLifecycle` (`web/domain/dual-write.js`) has been failing silently for every user.

That comment was written by the team from production observation. This audit supplies the mechanism.

### Cleanup proof

`{"pc":0,"act":0,"acct":0,"usr":0,"org":0}` — every synthetic fixture row removed.

---

## 4. R-005 — F-005 reproduced: the destructive `detail` UPSERT

**Status: TEST-REPRODUCED.** Upgrades `F-005` from CODE-PROVEN to TEST-REPRODUCED.

Harness: [`repros/repro-h1-detail-erasure-and-pipeline-regression.ts`](repros/repro-h1-detail-erasure-and-pipeline-regression.ts)

This exercises the `ON CONFLICT … DO UPDATE` branch of `upsertPostCall` directly — the branch that F-001 currently prevents from ever being reached, and that a naive F-001 fix would immediately activate.

### Observed output (verbatim)

```
[1] hydrated row: {"pipeline_state":"signals_done","detail_shape_version":"2",
     "transcript_ref":"gs://astra/transcript.txt","follow_ups":2,"objections":1,
     "video_facts":1,"tc_status":"committed"}
[2] after ONE history patch: {"pipeline_state":"analysis_done","detail_shape_version":"1",
     "transcript_ref":null,"detail_null":true,"marker":"history-patch"}

detail erased to NULL ............ YES — DATA LOSS
pipeline_state regressed ......... YES (signals_done -> analysis_done)
transcript_ref cleared ........... YES
detail_shape_version rolled back . YES (2 -> 1)
```

A **single** ordinary history patch — the exact payload `tryHistoryPostCallSqlWrite` sends — destroyed:

- `detail.followUps` (2 rows)
- `detail.objections` (1 row)
- `detail.videoFacts` (1 row)
- `detail.timelineSegments` (1 row)
- `detail.technicalCommit`
- `transcript_ref` (an additional loss not in the original H1 hypothesis)
- `detail_shape_version` (2 → 1)
- `pipeline_state` (`signals_done` → `analysis_done`)

### Why this matters for remediation ORDER

Today F-001 masks F-005: the second writer errors out before the `DO UPDATE` branch runs. **Aligning the two idempotency keys without first making the UPSERT non-destructive would convert a silent write-failure into active, recurring data loss on every hydration patch.**

**F-005 must be fixed before F-001.** See [10-remediation-plan](10-remediation-plan.md).

The correct pattern already exists 500 lines away in the same file (`worker/src/routes.ts:2400-2409`, `E-032`):

```sql
UPDATE post_call SET
  analysis = COALESCE($2::jsonb, analysis),
  detail   = COALESCE($3::jsonb, detail),
  updated_at = now()
WHERE public_id = $1
```

### Cleanup proof

`{"pc":0,"act":0,"acct":0,"usr":0,"org":0}`.

---

## 5. R-006 — The repository's own SQL gate tests, actually run

Executed against the disposable cluster. These are **real results**, not README claims.

| Test | Result | Notes |
|---|---|---|
`janus/tests/grants_smoke.test.mjs` | **18/18 PASS**, exit 0 | `janus_app` grants and the REVOKEs on `deal_stage_history`, `audit_log`, `score_override`, `contact_merge_log` all hold (`42501`). Caveat: the 8 `SELECT <table>` checks only assert `typeof n === 'number'`, and `check('DELETE org_unit', true)` is a hardcoded pass. |
`janus/tests/rls_fails_closed.test.mjs` | **8/8 PASS**, exit 0 | No session vars → 0 deals. Typo'd `app.org_path` does not widen access. Cross-org isolation holds. Admin sees all. **RLS genuinely fails closed.** |
`janus/tests/view_rls.test.mjs` | **4/4 PASS**, exit 0 | `security_invoker` on `v_deal_traction` / `v_org_metrics` genuinely enforces base-table RLS. |
`janus/tests/ai_run_insert.test.mjs` | **2 checks FAILED**, exit **1** | See R-007. |

**This is the audit's one genuinely reassuring result: the RLS/grants layer works.** Where SQL rows do exist, they are correctly isolated.

---

## 6. R-007 — `ai_run` telemetry insertion cannot be exercised at all

**Status: RUNTIME-VERIFIED. New finding (F-023).**

`janus/tests/ai_run_insert.test.mjs` shells out to `janus/tests/ai_run_insert.harness.ts`. That harness fails to load:

```
janus/tests/ai_run_insert.harness.ts:12:11: ERROR: Top-level await is currently not supported
  with the "cjs" output format
janus/tests/ai_run_insert.harness.ts:28:0:  ERROR: Top-level await is currently not supported
  with the "cjs" output format
```

Consequences observed:

| Check | Result |
|---|---|
`insertAiRun harness exit 0` | **FAIL** — status 1 |
`ai_run RLS fails closed for non-admin` | PASS (visible=0) |
`ai_run row inserted` | **FAIL** — the row was never inserted, because the harness never ran |
`non-activity id FK rejected` | PASS |

The harness uses top-level `await` in a `.ts` file that `npx tsx` resolves as CJS (no `"type": "module"` applies at `janus/tests/`). So `insertAiRun` — the function behind ALL LLM cost/latency telemetry — has **no working test**, and this has been true for however long the toolchain has resolved it this way.

Note that the test itself is honest: it exits 1. It simply is not run by any workflow (see [08-test-coverage](08-test-coverage.md)).

---

## 7. R-008 — A broken re-export in the persistence barrel

**Status: RUNTIME-VERIFIED. New finding (F-024, P3).**

`worker/src/data/persistence/session-context.ts:365` exports `withUnrestrictedSystemContext` and `:383` keeps `withSystemContext` as a deprecated alias. The barrel `worker/src/data/persistence/index.ts:10` re-exports **only the deprecated alias**:

```ts
export { resolveSqlSession, resolveSqlSessionByEmail, withSessionContext, withSystemContext } from "./session-context";
```

So the M3 rename described at `session-context.ts:362` ("renamed withSystemContext → withUnrestrictedSystemContext so the RLS bypass is explicit at every call site") never reached the public surface. Encountered directly: importing `withUnrestrictedSystemContext` from the barrel yields `is not a function` at runtime. Every existing call site (`worker/scripts/dual-write-soak.ts:13,42,50`, `worker/scripts/test-postcall-update-idempotency-conflict.ts:19,267`) still uses the name the rename was meant to eliminate, so the RLS bypass is *not* explicit at any call site.

---

## 8. What is NOT proven at runtime, and the exact commands to prove it

Everything below is marked `REQUIRES RUNTIME EVIDENCE`. Commands are given redacted; run them against staging/production read-only credentials.

### 8.1 Does any production/staging environment write to PostgreSQL at all?

The single most important open question, because `deploy/vps/docker-compose.yml:28` sets `PERSISTENCE_MODE: "${PERSISTENCE_MODE:-firestore}"` — **defaulting the VPS to `firestore`, in which `resolvePersistencePort` returns `null` and no SQL write of any kind is attempted** (`dual-write-repository.ts:353-360`).

```bash
# On the VPS, redact before sharing:
docker compose -f deploy/vps/docker-compose.yml exec worker \
  sh -c 'echo "PERSISTENCE_MODE=${PERSISTENCE_MODE}"; echo "READ_MODE=${PERSISTENCE_READ_MODE}"; \
         echo "HISTORY_BACKEND_MODE=${HISTORY_BACKEND_MODE}"; \
         echo "DATABASE_URL set: $([ -n \"$DATABASE_URL\" ] && echo yes || echo no)"'
```

### 8.2 Blast-radius queries for F-001 (how many calls are already affected?)

```sql
-- post_call rows whose idempotency_key came from the HISTORY writer
-- (key == 'call_' || public_id) => the domain dual-write for that call FAILED.
SELECT count(*) AS history_written,
       count(*) FILTER (WHERE detail IS NOT NULL) AS with_detail
FROM post_call
WHERE idempotency_key = 'call_' || public_id;

-- post_call rows whose key came from the DOMAIN writer (zoom/title identity)
SELECT count(*) FROM post_call
WHERE idempotency_key IS NOT NULL
  AND idempotency_key <> 'call_' || public_id;

-- Calls with no scorecard at all — the direct symptom
SELECT count(*) AS calls_without_scorecard
FROM post_call pc
JOIN activity a ON a.id = pc.activity_id
WHERE NOT EXISTS (SELECT 1 FROM scorecard s WHERE s.activity_id = a.id);
```

### 8.3 F-006 — pipeline_state distribution

```sql
SELECT pipeline_state, count(*) FROM post_call GROUP BY 1 ORDER BY 2 DESC;
-- Expected from E-033: 100% 'analysis_done' (or 'ingested' for rows created by other paths).
-- Any row in 'detail_done'/'scoring_done'/'signals_done' would DISPROVE E-033.
```

### 8.4 F-002 — is any hydrated artefact in SQL?

```sql
SELECT
  count(*)                                                              AS calls,
  count(*) FILTER (WHERE detail IS NOT NULL)                            AS any_detail,
  count(*) FILTER (WHERE detail ? 'followUps')                          AS follow_ups,
  count(*) FILTER (WHERE detail ? 'objections')                         AS objections,
  count(*) FILTER (WHERE detail ? 'videoFacts')                         AS video_facts,
  count(*) FILTER (WHERE detail ? 'timelineSegments')                   AS timeline,
  count(*) FILTER (WHERE detail ? 'technicalCommit')                    AS tech_commit
FROM post_call;

SELECT count(*) FROM deal_summary;     -- Pass 9
SELECT count(*) FROM account_summary;  -- Pass 9
SELECT count(*) FROM technical_commit; -- Pass 5
SELECT count(*) FROM product_signal;   -- Pass 6
```

### 8.5 Fallback and audit telemetry

```sql
SELECT method, reason, count(*)
FROM sql_fallback_log
GROUP BY 1,2 ORDER BY 3 DESC LIMIT 50;   -- 30_fallback_telemetry.sql
```

Also grep the worker log for the two loud markers this audit relies on:

```bash
grep -c 'dual-write-DROPPED' <worker log>       # routes.ts:1406 — history SQL write failed
grep -c 'Lifecycle dual-write (post-call) failed' <browser console / RUM>   # web/app.js:3230
```

### 8.6 F-023 — is `ai_run` actually populated in production?

```sql
SELECT run_type, count(*), min(created_at), max(created_at)
FROM ai_run GROUP BY 1 ORDER BY 2 DESC;

-- Can cost be attributed to a user-visible post-call?
SELECT count(*) AS runs, count(DISTINCT call_id) AS distinct_calls,
       count(*) FILTER (WHERE call_id LIKE 'call_pending_%') AS orphan_video_runs
FROM ai_run;
```

`orphan_video_runs > 0` would confirm `E-064` at runtime.

---

## 9. Unresolved items in this document

- Production/staging `PERSISTENCE_MODE`, `PERSISTENCE_READ_MODE`, `HISTORY_BACKEND_MODE` — unknown.
- Whether Cloud SQL has migration 34 (applied manually or not) — unknown.
- Actual historical damage counts for F-001/F-002 — needs §8.2/§8.4.
- Whether `sync_outbox` has a running projector in any environment — `POST /api/internal/outbox/project` is registered, but nothing in `deploy/vps/cron-batch.sh` calls it (that script targets two **unregistered** routes; see `E-045`).

## 10. Teardown

The disposable cluster lives only in the session scratchpad and holds no repository or user data. It can be discarded by deleting that directory; nothing in the repository references it, and `worker/.dev.vars` was never modified.
