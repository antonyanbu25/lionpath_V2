# 10 — Remediation Plan

**Snapshot:** `SE-Labs` @ `c58eac93`, `VERSION` 2.1.30, 2026-09-08.
**Related:** [06-bugs-and-risks](06-bugs-and-risks.md) · [09-architecture-options](09-architecture-options.md) · [11-implementation-prompts](11-implementation-prompts.md)

Five phases: **containment → correctness → reconciliation → controlled refactor → optimisation.** The ordering inside phase 1 is load-bearing and is justified below.

---

## 0. The one ordering constraint that matters

**R2 (make the UPSERT non-destructive) must land before R3 (unify the idempotency keys).**

Today F-001 masks F-005: the second `post_call` writer raises `23505` before reaching the `ON CONFLICT … DO UPDATE` branch, so that branch never executes. [`repros/repro-h1-…ts`](repros/repro-h1-detail-erasure-and-pipeline-regression.ts) exercised it directly and a **single** ordinary history patch destroyed all 12 `detail` collections, `transcript_ref`, `detail_shape_version` and `pipeline_state`.

Unifying the keys first would make that branch live on **every hydration patch — 5 to 8 per call.** It would convert a silent write-failure into recurring active data loss, and it would look like a successful fix while doing so.

---

## Phase 1 — Immediate containment (days)

### R1 — Purge the committed Zoom credential · F-025 · P0
1. **Findings**: F-025 (`E-112`)
2. **Files**: `worker/scripts/debug-zoom.mjs`, `debug-zoom2.mjs`, `debug-zoom3.mjs`, `debug-zoom4.mjs`, `debug-zoom5.mjs`
3. **Current**: each contains a real Freshworks Zoom share URL and its plaintext passcode as top-level constants; all five are dead code in no manifest
4. **Target**: files deleted; the recording's passcode treated as compromised
5. **Why first**: it is the only finding where the exposure grows with time and cannot be undone by a later code change
6. **Dependencies**: none
7. **Migration**: none
8. **Reconciliation**: `git log --all -S'<literal>'` to determine history exposure. **Deleting the files does not remediate pushed history** — the recording must be deleted or re-passcoded by its owner
9. **Tests before**: re-confirm all five are unreferenced
10. **Tests after**: a secret-scanning step in `ci.yml`
11. **Telemetry**: none
12. **Flag**: none
13. **Deploy**: any
14. **Rollback**: n/a (deletion of dead code)
15. **Acceptance**: no credential literal remains in the working tree; owner has rotated or deleted the recording
16. **Unchanged**: everything else

### R2 — Make `upsertPostCall` non-destructive · F-005 · P1 (**before R3**)
1. F-005 (`E-030`–`E-032`, `R-005`)
2. `worker/src/data/persistence/postgres-repository.ts:upsertPostCall:416-441`; caller `worker/src/routes.ts:2996`
3. `ON CONFLICT … DO UPDATE SET detail = EXCLUDED.detail, transcript_ref = EXCLUDED.transcript_ref, pipeline_state = EXCLUDED.pipeline_state, …` — an unconditional whole-column replace, driven by a caller that always sends `detail: null`
4. **Invariant: a writer that has no value for a column must never null it.** Use `COALESCE(EXCLUDED.col, post_call.col)` for `detail`, `transcript_ref` and the shape versions; never regress `pipeline_state` to an earlier state. The correct pattern already exists at `routes.ts:2400-2409`
5. Safe because it strictly narrows what a write can destroy
6. None
7. No schema change
8. `SELECT count(*) FROM post_call WHERE detail IS NULL` before and after, to size existing damage
9. Promote [`repros/repro-h1-…ts`](repros/repro-h1-detail-erasure-and-pipeline-regression.ts) to `worker/scripts/test-postcall-detail-merge.ts`, add to the manifest — **must fail before the change**
10. Same test green; add a case asserting `pipeline_state` never regresses
11. Log at WARN when an incoming payload would have nulled a non-null `detail`
12. None needed — strictly safer
13. Worker only
14. Revert the SQL string
15. One history patch after a hydrated write leaves `detail`, `transcript_ref`, shape versions and `pipeline_state` intact
16. `analysis` must still be replaced (it is always fully supplied)

### R3 — Unify the post-call idempotency key · F-001 · P0
1. F-001 (`E-022`–`E-029`, `R-004`), F-015 (`E-038`)
2. `worker/src/routes.ts:2718,2729,2976`; `postgres-repository.ts:upsertPostCall`; `read-repository.ts:140,757`; `web/domain/api-store.js:472-477`; `web/history.js:savePostCallAnalysis`
3. History writer keys on `call_<publicId>`; domain writer on `call_<callIdentityKey>`; the second raises `23505` and rolls back the whole transaction. Readers compare the key **without** the `call_` prefix, so dedupe is dead
4. **Invariant: one call ⇒ one `post_call` row, reachable by both writers and by the identity reader.** Give `upsertPostCall` the same conflict-resolving CTE `upsertActivity` already uses (resolve on `public_id OR idempotency_key`, prefer `public_id`, then UPDATE). Pick **one** key derivation and use it in all three places, prefix included
5. **Depends on R2** — see §0
6. R2
7. No DDL. A backfill to normalise existing `idempotency_key` values is optional and separate
8. §8.2 of [05](05-runtime-sql-verification.md) counts affected calls
9. Promote [`repros/repro-h2-…ts`](repros/repro-h2-dual-writer-idempotency-collision.ts) — **must fail before the change.** Also un-orphan `worker/scripts/test-postcall-update-idempotency-conflict.ts` (it passes; nothing runs it)
10. Both writer orders converge on one row; extend to cases (c) and (d) by driving `handleHistoryPost`/`handleDomainWrite` as HTTP handlers
11. Count `dual-write-DROPPED` and the domain-write 500 rate; both should go to zero
12. **Yes** — flag the CTE path, since this is the highest-blast-radius change in the plan
13. Worker only; watch the two counters for one full day before removing the flag
14. Flag off
15. `linkPostCallToLifecycle` completes; `scorecard` gains a row per new call
16. Do not change `upsertActivity` — it is already correct

### R4 — Close the three authorisation holes · F-004, F-010, F-011 · P0/P1
1. F-004 (`E-048`), F-010 (`E-047`), F-011 (`E-046`)
2. `worker/src/routes/domain-reads.ts:handleCallPayloadOffloadPost:133-151`; `worker/src/routes.ts:handleFeedbackGet:949-952`, `handleSearchRag:1414-1428`
3. `offload-payload` authenticates but never authorises — any signed-in user can overwrite any call's payload. `?global=1` returns all users' feedback before auth resolves. `/api/search/rag` has no auth at all and spends embedding tokens
4. Add `assertCanReadResource(ctx, resourceFromRow(postCall))` exactly as the GET sibling does at `:166`; move the `global` branch after `resolveHistoryEmail` and require an admin scope; add `requireUser` to `handleSearchRag`
5. Independent of everything else; smallest possible diffs
6. None
7. None
8. Review GCS object writes for cross-tenant overwrites; there is no audit row today, so this may be inconclusive
9. Route authz tests (T6, T7 in [08](08-test-coverage.md) §8)
10. Same tests green
11. Log and alert on rejected cross-tenant attempts
12. None
13. Worker only
14. Revert
15. A cross-tenant id returns 403; `?global=1` requires admin; unauthenticated RAG returns 401
16. Legitimate same-tenant access must keep working — verify with the existing e2e suite

### R5 — Stop the silence · F-001 observability, H14 · P1
1. F-001, F-014, H14
2. `worker/src/routes.ts:trySqlDomainWrite:1767` (add a `logFallback` on write error), `web/app.js:3229-3234` (surface, don't swallow)
3. `trySqlDomainWrite` has no try/catch around `withSessionContext`, so the error escapes as a 500 whose body is rewritten to `"Internal error."`; the browser logs `console.warn` and shows a normal UI
4. **Invariant: a failed durable write is never invisible.** Record it in `sql_fallback_log` with the method and entity id, and show the user a non-blocking "some details could not be saved — retrying" indicator
5. Diagnostic only; ship alongside R3 so its effect is measurable
6. None
7. None
8. None
9. None
10. Assert a fallback row is written on a forced failure
11. **This IS the telemetry item.** Alert on `sql_fallback_log` rate
12. None
13. Worker + web
14. Revert
15. Every dropped write appears in `sql_fallback_log`
16. Do not change the 200 contract of `POST /api/history` — that is deliberate; make the *failure* visible, not the response code

### R6 — Register the dead routes · F-012, F-013 · P1
1. F-012 (`E-043`), F-013 (`E-044`, `E-045`)
2. `worker/src/routes.ts:3298-3340`; handlers in `routes/health.ts`, `routes/read-models.ts`, `routes/internal-batch.ts`
3. Health probes 404 while Cloud Run docs configure them; the browser calls `/api/read-models/schedule` (404); an **active** cron hits two unregistered batch routes nightly
4. Register `healthRoutes` and the four internal routes; keep the `X-Cron-Secret` check
5. Purely additive
6. None
7. None
8. Check cron logs for the historical 404 rate
9. **T8** — a test asserting every handler exported from `routes/*.ts` is reachable from the route map. This one test prevents the entire class
10. Health returns 200; the nightly cron returns 2xx
11. Alert on cron non-2xx
12. None
13. Worker; verify probes before relying on them
14. Revert
15. All five routes reachable; T8 green
16. Auth requirements unchanged

---

## Phase 2 — Correctness repair (1–2 weeks)

### R7 — Persist the hydration tail · F-002, F-003 · P0
1. F-002 (`E-013`–`E-017`), F-003 (`E-018`, `E-019`)
2. `web/postcall.js:runPostcallParallelHydration:4715-5035` (end), `web/app.js:setOnCallRecordHydrated:3118-3124`, `web/domain/dual-write.js:linkPostCallToLifecycle:172-505`
3. `/generate` returns none of the hydrated artefacts; the one lifecycle link consumes only that response; the completion hook performs no write. 18 of 20 artefacts never reach SQL, and Pass 8/9 compute from `undefined`
4. **Invariant: every artefact in [03](03-postcall-write-ledger.md) §2 has a proven durable destination, and Pass 8/9 run only after their required evidence exists.** Minimum viable: on hydration completion, re-invoke the child persisters with the **merged** record, then recompute Pass 8 and Pass 9. Extract the child-write block from `linkPostCallToLifecycle` into an idempotent function callable twice
5. Requires R2 + R3 first, or the writes still cannot land
6. R2, R3
7. None
8. **This is the big one.** A replay job can reconstruct every historical call's child rows from the history blobs, which retain everything. Scope it from §8.4 of [05](05-runtime-sql-verification.md)
9. **T3** — one assertion per artefact, asserting presence not just row existence
10. Same, plus Pass 8/9 assertions that their inputs were non-empty
11. Per-artefact write counters; alert when a call completes hydration with zero child rows
12. **Yes**
13. Web + worker together
14. Flag off — reverts to today's behaviour, which writes nothing (so rollback is safe by construction)
15. A fixture post-call produces a row in every expected table; Pass 8/9 inputs are non-empty
16. Do not change the initial `linkPostCallToLifecycle` call — make the child block re-callable, and keep it idempotent

### R8 — Give `pipeline_state` meaning · F-006 · P1
1. F-006 (`E-033`, `E-034`)
2. `worker/src/routes.ts:2734,3000`; `worker/src/data/persistence/read-repository.ts:155`
3. Two writers both hardcode `'analysis_done'`; four of six enum values are never written; `provisional` is therefore permanently true for every SQL-read call
4. **Invariant: the state reflects which artefacts exist and never moves backwards.** Write `detail_done` / `scoring_done` / `signals_done` from R7's completion writer, based on actual presence; `failed` on a terminal error
5. Depends on R7 having something to report
6. R7
7. No DDL (all six values already exist)
8. Existing rows stay `analysis_done`; a backfill can derive the state from present artefacts
9. **T4** — a state-machine test, including a no-regression assertion
10. Same, plus `provisional` becoming false
11. `pipeline_state` distribution dashboard
12. With R7
13. Worker
14. With R7
15. A completed call reads back non-provisional
16. Do not widen the enum — the six values are sufficient

### R9 — Fix `ai_run` attribution · F-023 · P1
1. F-023 (`E-092`–`E-097`, `E-064`, `E-120`, `R-007`)
2. `worker/src/data/persistence/ai-run.ts:119-132,204-226`; every post-call handler in `routes.ts`; `web/postcall.js:4520`; `janus/tests/ai_run_insert.harness.ts`
3. No `call_id` column; the `callId` string is resolved-and-discarded; no route injects the authenticated identity; critical-path passes send no `callId`; the video pass sends `call_pending_<ms>`; `summaries` cannot carry one; the only test cannot load
4. **Invariant: every `ai_run` row joins to the post-call it belongs to.** Inject `userId` server-side from the verified token (never trust the body). Mint the call id **before** the first LLM call so `callId` is real, or persist the raw `callId` string alongside `activity_id` so a late-resolving row is repairable. Fix the harness's module format
5. Prerequisite for all performance work — [07](07-performance-and-cost.md) is a model until this lands
6. None (independent of R2/R3)
7. Consider adding a nullable `call_ref text` column so unresolvable rows remain diagnosable. `ai_run` is append-only, so historical rows can never be repaired
8. Historical `ai_run` data is permanently unattributable — accept and move on
9. **T10**
10. `SELECT count(*) FROM ai_run WHERE activity_id IS NULL` trends to ~0 for post-call passes
11. Cost-per-call dashboard becomes possible
12. None
13. Worker
14. Revert
15. Every pass of a fixture post-call joins to its `post_call`
16. Do not weaken the append-only REVOKE

### R10 — Timeouts and pass classification · F-027 · P1
1. F-027 (`E-099`, `E-100`)
2. `worker/src/video/transcript-infer.ts:341,464`; `worker/src/embeddings.ts:58`; `worker/src/providers/gemini-retry.ts:10-20`
3. Three provider calls on the live path have no timeout, no AbortController and no retry; five passes fall through to the 45 s `extraction` budget despite 8000 maxTokens on the critical path
4. Route every provider call through `fetchGeminiWithRetry`; add the five missing names to `POSTCALL_PASS_NAMES`
5. Small, isolated, reliability-only
6. None
7. None
8. None
9. **T11** — a static test forbidding bare `fetch(` to a provider host outside the retry helper
10. Same
11. Timeout-rate metric per pass
12. None
13. Worker
14. Revert
15. No unbounded provider call remains
16. Do not change the existing budget values

### R11 — Bulk history sync must project to SQL · F-014 · P1
1. F-014 (`E-037`)
2. `worker/src/routes.ts:handleHistoryPost:1382-1385`
3. The `entries` branch returns before `tryHistoryPostCallSqlWrite`, so login sync and recovery upload never reach SQL
4. Project each entry, best-effort, after the blob write
5. After R2/R3, or bulk sync would multiply the collision
6. R2, R3
7. None
8. **This becomes the reconciliation mechanism for R7** — a bulk re-push of history replays every call into SQL
9. Assert a bulk push lands `post_call` rows
10. Same
11. Count projected rows per bulk push
12. Yes — it can be a heavy operation
13. Worker
14. Flag off
15. A bulk push of N entries yields N `post_call` rows
16. Keep the 200 contract

---

## Phase 3 — Reconciliation (after Phase 2, one-off)

### R12 — Replay historical calls from history blobs
The history blobs retain every artefact, so nothing is permanently lost **provided they are intact**. Build a one-off, resumable, idempotent job that reads each user's history document and re-drives the R7 completion writer per call. Run it read-only first to produce a per-call diff report; require sign-off before writing. Depends on R2, R3, R7, R11.

### R13 — Schema parity and CI foundation · F-020, F-038
Apply migration 34 wherever it is missing; delete the orphan `19_history_tasks_feedback.sql`; add **T9** (installer parity). Add a **PostgreSQL service container** to `ci.yml`; add `typecheck`; make missing `DATABASE_URL` a hard failure in the three skipping gates; add `setup-java` to `promotion-gate.yml`; fail the build when a `test-*` file is absent from a manifest; give `janus/tests/` a runner. **Nothing else on this list is durable without this step** — every finding in this audit was reachable because nothing tested it.

---

## Phase 4 — Controlled refactor (Option B)

### R14 — `POST /api/postcall/finalize`
Move R7's completion writer server-side into one idempotent, re-callable, transactional endpoint. `POST /api/history` stops writing `post_call` entirely; history becomes a read model. Pass 8/9 move inside the finalizer, behind an evidence check. This is also the exact component a future durable scheduler would call, so Option C stops being a rewrite. See [09](09-architecture-options.md) §3.

### R15 — One view-state model · F-029–F-035
The seven-point target in [12](12-postcall-ux-zoom-and-loading.md) §C7: one state machine, two paints maximum, `unknown` distinguished from `empty`, one request-coalescing layer, one timestamp-based merge rule, subscription fixed or deleted, `bindActionOnce` everywhere.

### R16 — Intake streamlining · F-016, F-017, F-018
Remove the `crmPreviewSurfacedOnce` network gate; drop the redundant third CRM lookup; render the confirmation gate on `resolve` and fill the call-type chip when classify lands; parallelise the contact loop; run `verify` and `golden calibration` concurrently. Preserve every correctness-essential confirmation as a **correction affordance on a confident default** — see [12](12-postcall-ux-zoom-and-loading.md) §A3.

---

## Phase 5 — Optional optimisation

R17 Zoom reliability (the six-point "smallest reliable path" in [12](12-postcall-ux-zoom-and-loading.md) §B5) · R18 dead-code removal (F-037, F-021, F-024) · R19 report the right predicates in `/api/config` (F-039) · R20 the measured performance work from [07](07-performance-and-cost.md) §7, **after R9**.

---

## What must explicitly NOT change yet

| Do not touch | Why |
|---|---|
RLS policies, `FORCE ROW LEVEL SECURITY`, grants/REVOKEs, `security_invoker` views | verified working (`R-006`); the only reason landed data is safely isolated |
`upsertActivity`'s CTE | already correct; it is the pattern R3 copies |
`upsertAccount`'s slug-dedupe | prevents a known staging-blocker class |
The verifier and golden-set passes, incl. fail-safe leadership capping | correctness machinery; do not "optimise" them away |
`replaceCallParticipants`'s SAVEPOINT | correct transaction isolation |
The `[history][dual-write-DROPPED]` log line | deliberately loud; keep it |
The 200 contract of `POST /api/history` | intentional; make failures visible instead |
`beginPostcallPipeline` / `isPostcallPipelineStale` / `crmMatchesToken` / `callPanelRenderGen` | the abort machinery is well built where applied |
**Option C infrastructure** | do not build a durable job queue until Phases 1–3 are done; the repo already shows scheduled execution is unreliable (no `scheduled()` handler, two crons on 404s, an outbox projector with no caller) |
**The idempotency keys, before R2** | `R-005` proves aligning them first starts active data loss |
