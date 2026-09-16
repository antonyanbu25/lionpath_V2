# 11 — Independent Implementation Prompts

**Snapshot:** `SE-Labs` @ `c58eac930f8676e73a8406b9909c87b3f179b21c`, branch `main`, `VERSION` 2.1.30.
**Related:** [06-bugs-and-risks](06-bugs-and-risks.md) · [10-remediation-plan](10-remediation-plan.md) · [12-postcall-ux-zoom-and-loading](12-postcall-ux-zoom-and-loading.md)

Each prompt is self-contained and formatted for direct use by an implementation coding agent (e.g. Opus 5). **None of these were executed during the audit.**

## Dependency graph

```
P1 (credential)      — independent, do first
P4 (authz)           — independent
P6 (dead routes)     — independent
P10 (timeouts)       — independent
P15 (CI foundation)  — independent, but unlocks verification for all others

P2 (non-destructive UPSERT)  ──▶ P3 (unify keys) ──▶ P7 (persist hydration) ──▶ P8 (pipeline_state)
                                                              └──▶ P11 (bulk projection)
P5 (observability)   — ship alongside P3
P9 (ai_run)          — independent; prerequisite for all performance work
P12 (intake) · P13 (Zoom) · P14 (render) — independent of the data-loss chain
```

## Instructions that apply to EVERY prompt below

> **Before editing, open and read every file and symbol cited in your prompt.** The line numbers are from commit `c58eac93` and may have drifted; the symbol names are authoritative. Do not refactor beyond the stated scope. **Preserve unrelated uncommitted changes in the working tree** (at audit time: `web/package.json`, `worker/package.json`, `worker/wrangler.toml` all had local `allowScripts` / `nodejs_compat` edits — do not revert them).
> **Implement, do not plan.** Run the named tests and checks. Then return: (a) the list of changed files, (b) verification evidence — actual command output, not a claim, (c) risks you identified, (d) rollback notes.
> Never print a credential, token, connection string or transcript PII into your output. Naming a variable is fine; showing its value is not.
> Run PostgreSQL-dependent tests against a **disposable local** database only. `worker/scripts/start-local-postgres.mjs` will create one, but note it **rewrites `worker/.dev.vars`** — if that is unacceptable, pass `DATABASE_URL`/`DATABASE_URL_MIGRATIONS` via the environment instead, which the scripts honour without touching the file.

---

## P1 — Purge the committed Zoom recording credential

**Finding:** F-025 (P0), evidence E-112.

**Problem.** Five files each contain a real Freshworks Zoom cloud-recording share URL **and its plaintext recording passcode** as top-level `const` literals: `worker/scripts/debug-zoom.mjs` (≈lines 2-4), `debug-zoom2.mjs` (1-3), `debug-zoom3.mjs` (1-3), `debug-zoom4.mjs` (4-6), `debug-zoom5.mjs` (1-3).

**Verified evidence.** All five are dead code: absent from both `web/scripts/test-manifest.mjs` and `worker/scripts/test-manifest.mjs`, no npm script, and `grep -rn 'debug-zoom' worker/src worker/package.json .github/` returns nothing. They make real network calls to undocumented Zoom `nws/recording/1.0/*` endpoints when run. `debug-zoom3.mjs` additionally probes three endpoints not used in production.

**Invariant to establish.** No credential literal exists anywhere in the working tree.

**Desired implementation.**
1. Re-run the greps to confirm all five are still unreferenced.
2. Delete all five files.
3. Determine history exposure: `git log --all -S'<the passcode literal>' --oneline`. **Report the result without printing the literal.**
4. Add a secret-scanning step to `.github/workflows/ci.yml` (e.g. `gitleaks` or `trufflehog`) as a new matrix-independent job.

**Must remain unchanged.** Every other file in `worker/scripts/`, including the legitimate `test-zoom.mjs` (tagged `manual-only`, takes its URL and passcode as CLI arguments — that is the correct pattern).

**Non-goals.** Do **not** attempt any git history rewrite. Do not commit or push unless asked.

**Acceptance criteria.** Five files gone; secret scan runs in CI and passes; a written statement of whether the literals are in pushed history.

**Escalate to the user:** the recording passcode must be treated as compromised. Its owner must delete the recording or rotate its passcode. Deleting the files does **not** remediate pushed history.

---

## P2 — Make the `post_call` UPSERT non-destructive  ⚠️ MUST LAND BEFORE P3

**Finding:** F-005 (P1), evidence E-030–E-032, E-040; **reproduced** at `docs/astra-audit/repros/repro-h1-detail-erasure-and-pipeline-regression.ts`.

**Problem.** `PostgresRepository.upsertPostCall` (`worker/src/data/persistence/postgres-repository.ts:416-441`) does:

```sql
ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET
  transcript_ref = EXCLUDED.transcript_ref, analysis = EXCLUDED.analysis,
  detail = EXCLUDED.detail, pipeline_state = EXCLUDED.pipeline_state,
  analysis_shape_version = EXCLUDED.analysis_shape_version,
  detail_shape_version = EXCLUDED.detail_shape_version,
  se_motion = EXCLUDED.se_motion, updated_at = now()
```

and its history caller (`worker/src/routes.ts:2996`) always passes `detail: null`, plus `pipelineState: "analysis_done"` (`:3000`) and usually `transcriptRef: null`.

**Verified evidence — run the repro to see it.** A single ordinary history patch destroyed: all 12 `detail` collections (followUps, objections, videoFacts, timelineSegments, technicalCommit, …), `transcript_ref`, `detail_shape_version` (2→1) and `pipeline_state` (`signals_done` → `analysis_done`).

**Why this is urgent even though it looks dormant.** F-001 currently masks it — the second writer raises `23505` before reaching this branch. **P3 makes this branch live on every hydration patch (5–8 per call).** Landing P3 first would convert a silent write-failure into recurring active data loss.

**Invariant to establish.** *A writer that has no value for a column must never null it, and `pipeline_state` must never move backwards.*

**Architecture constraints.** The correct pattern already exists 500 lines away in the same codebase — `worker/src/routes.ts:2400-2409` uses `COALESCE($2::jsonb, analysis)` / `COALESCE($3::jsonb, detail)` for the `upsertPostCall`/`upsertCallSummary` domain-write cases. Match it.

**Desired implementation.**
1. Change the `DO UPDATE SET` clause to `COALESCE(EXCLUDED.col, post_call.col)` for `detail`, `transcript_ref`, `detail_shape_version` and `analysis_shape_version`.
2. `pipeline_state`: never regress. Use a `GREATEST`-style ordering over the enum, or a `CASE` that keeps the existing value unless the incoming one is strictly later. The six values in order are `ingested`, `analysis_done`, `detail_done`, `scoring_done`, `signals_done`, and `failed` (terminal, always wins).
3. Log at WARN when an incoming payload would have nulled a non-null `detail`, so the historical rate is measurable.
4. Leave `analysis` as an unconditional replace — it is always fully supplied.

**Must remain unchanged.** `analysis` replacement semantics. `upsertActivity` (already correct). The `ON CONFLICT` target itself — that is P3's job.

**Database migration.** None. No DDL.

**Concurrency / idempotency.** The statement must stay a single atomic upsert; do not split it into SELECT-then-UPDATE.

**Tests to create.** Promote the repro to `worker/scripts/test-postcall-detail-merge.ts` and register it in `worker/scripts/test-manifest.mjs` as `unit` (it needs PG — coordinate with P15, or tag it so it is selected only when `DATABASE_URL` is present **and hard-fails when the tag is requested without one**). It **must fail before your change and pass after**.

**Tests to run.** The new test; `worker/scripts/test-postcall-update-idempotency-conflict.ts` (currently an orphan — it passes, run it directly); `npm test --prefix worker`; `npx tsc --noEmit` in `worker/`.

**Telemetry.** The WARN line above.

**Rollout / rollback.** No flag needed — strictly narrows what a write can destroy. Rollback = revert the SQL string.

**Acceptance criteria.** After a hydrated write, one history patch leaves `detail`, `transcript_ref`, both shape versions and `pipeline_state` intact. `SELECT count(*) FROM post_call WHERE detail IS NULL` stops growing.

**Non-goals.** Do not touch the idempotency key, the conflict target, or any caller.

---

## P3 — One `post_call` row per call: unify the idempotency key

**Finding:** F-001 (P0) and F-015 (P1), evidence E-022–E-029, E-038, E-039, E-056; **reproduced** at `docs/astra-audit/repros/repro-h2-dual-writer-idempotency-collision.ts`. Independently corroborated by the repository's own migration comment at `janus/schema/34_usage_and_leaderboard_views.sql:15-21`.

**DEPENDENCY: P2 must be merged first.** See P2's "why this is urgent".

**Problem.** Two writers target the same `post_call.public_id` with **different** `idempotency_key` values:

- History: `worker/src/routes.ts:2976` — `call_${stringField(rec.callIdentityKey) || id}`. The record built by `web/history.js:savePostCallAnalysis` has **no `callIdentityKey` field**, so this is always `call_<postCallPublicId>`.
- Domain: `worker/src/routes.ts:2718,2729` — `call_${stringField(postCall.callIdentityKey) || id}`, and `web/domain/dual-write.js:233,265` always sets it, so this is `call_zoom:<recordingId>`.

`upsertPostCall` conflict-targets only the partial unique index on `idempotency_key`, while `post_call.public_id` is `text UNIQUE NOT NULL` and `activity_id` is `NOT NULL UNIQUE` (`janus/schema/02_phase2_activities.sql:88,90,99`). So the second writer's INSERT finds no conflict on the key, proceeds, and violates `post_call_public_id_key`.

`upsertReturningId` (`worker/src/data/persistence/id-registry.ts:74-94`) does not handle `23505`; `withSessionContext` (`session-context.ts:349-351`) ROLLBACKs the whole transaction and rethrows; `trySqlDomainWrite` has no try/catch around it, so it escapes to `worker/src/index.ts:148-159` as a 500 with the body rewritten to `"Internal error."`; and `web/app.js:3229-3234` catches it with `console.warn`.

**Verified consequence.** `linkPostCallToLifecycle` throws at `attachPostCall`, so everything sequenced after it never runs: scorecard, participants, videoFacts, timeline, followUps, objections, MoM, qualification, technicalCommit, **Pass 8 deal traction**, ARR, Pass 6 gaps, **Pass 9 deal/account summaries**, contact frameworks, deal-contact links, identity stamping. The account, deal and contacts DO land, because they are written before `attachPostCall`.

**Second, related defect (F-015).** Writers store `'call_' + key`; readers compare the **raw** key — `worker/src/data/persistence/read-repository.ts:140` maps `callIdentityKey: row.idempotency_key` and `:757` compares `pc.idempotency_key = $2`, while `web/domain/api-store.js:472-477` compares `c.callIdentityKey === key`. So `findPostCallByIdentity(ownerId, 'zoom:abc')` can never match a row this app wrote, and `attachPostCall`'s re-analysis dedupe branch (`web/domain/lifecycle-service.js:186-188`) is dead.

**Invariant to establish.** *One call ⇒ exactly one `post_call` row, reachable by both writers and by the identity reader, in either write order.*

**Architecture constraints.** `PostgresRepository.upsertActivity` (`postgres-repository.ts:346-393`) **already solves this correctly** with a CTE that resolves on `public_id OR idempotency_key`, prefers `public_id`, and UPDATEs the existing row. Copy that pattern — do not invent a new one, and do not change `upsertActivity`.

**Desired implementation.**
1. Rewrite `upsertPostCall` with the same CTE shape as `upsertActivity`, preserving P2's `COALESCE` semantics in the UPDATE branch.
2. Choose **one** key derivation and use it in all three write sites. Recommended: `call_${callIdentityKey || publicId}`, and make the history record carry `callIdentityKey` — `web/call-identity.js:callIdentityKey(record)` already computes it from `zoomLink`/`analysis`/`title`, and `web/history.js:savePostCallAnalysis` has everything it needs to call it.
3. Fix the read side: strip the `call_` prefix in `read-repository.ts:140`, **or** add it in the reader's comparison. Pick one and apply it in both `read-repository.ts:757` and `web/domain/api-store.js:472-477`. Add a comment naming the convention.
4. Note that `upsertActivity`'s UPDATE branch does **not** rewrite `idempotency_key`, so the first writer's key sticks. Verify that is still consistent after your change.

**Must remain unchanged.** `upsertActivity`. `post_call.public_id` remains the stable external identifier. No schema change.

**Database migration / backward compatibility.** No DDL. Existing rows have mixed key formats; the CTE resolves them via `public_id`, so no backfill is *required*. An optional separate migration can normalise historical `idempotency_key` values — do not bundle it here.

**Concurrency / idempotency.** Must be correct in **both** orders (history-then-domain and domain-then-history) and under concurrent execution. Use `FOR UPDATE` in the resolving CTE, as `upsertActivity` does.

**Tests to create.**
- Promote `docs/astra-audit/repros/repro-h2-dual-writer-idempotency-collision.ts` to `worker/scripts/test-postcall-writer-convergence.ts`; register it. **It must fail before your change.**
- Extend it to the two cases nothing covers today: **(c)** history-SQL before domain-SQL and **(d)** initial history SQL skipped (no `accountId`) then later history patches. Drive these through `handleHistoryPost` and `handleDomainWrite` as HTTP handlers, not through the repository directly — that is exactly the gap in the existing test (see [08](08-test-coverage.md) §6).
- Un-orphan `worker/scripts/test-postcall-update-idempotency-conflict.ts` by adding it to the manifest. It currently **passes**; nothing runs it.

**Tests to run.** All of the above; `npm test --prefix worker`; `npx tsc --noEmit`; and the P2 test to confirm no regression.

**Telemetry.** Count `[history][dual-write-DROPPED]` (`routes.ts:1406`) and the `/api/domain-write` 500 rate. Both must go to zero. Ship P5 alongside so this is measurable.

**Rollout / rollback.** **Feature-flag the new CTE path** — this is the highest-blast-radius change in the plan. Watch both counters for a full day before removing the flag. Rollback = flag off.

**Acceptance criteria.** `linkPostCallToLifecycle` completes without throwing; the `scorecard` table gains a row for each new call; `post_call` has exactly one row per call in both write orders; `findPostCallByIdentity` matches a row this app wrote.

**Non-goals.** Do not fix the hydration-tail persistence here — that is P7. Do not change the destructive-UPSERT semantics — that is P2.

---

## P4 — Close three authorisation holes

**Findings:** F-004 (P0), F-010 (P1), F-011 (P1); evidence E-048, E-047, E-046.

**Problem 1 — cross-tenant IDOR write.** `handleCallPayloadOffloadPost` (`worker/src/routes/domain-reads.ts:133-151`) calls `await authContext(request, env)` and then immediately `uploadCallPayload(id, body, fsEnv(env))`. Its GET sibling `handleCallPayloadGet` (`:153-170`) correctly does `assertCanReadResource(ctx, resourceFromRow(postCall))` at `:166`. **Any authenticated user can overwrite any call's offloaded payload by id.**

**Problem 2 — unauthenticated cross-user read.** `handleFeedbackGet` (`worker/src/routes.ts:949-952`): `const global = url.searchParams.get("global") === "1"; if (global) { const entries = await loadGlobalFeedback(env); return json(...) }` — this returns **before** the `resolveHistoryEmail` call at `:954`.

**Problem 3 — unauthenticated compute.** `handleSearchRag` (`worker/src/routes.ts:1414-1428`) makes **no auth call at all** and invokes `rerankWithEmbeddings`, which spends embedding-API tokens. It is not in the rate-limit exempt list, so the 120/min IP bucket is the only control.

**Invariant to establish.** *Every route that reads or writes tenant data authorises the caller against that specific resource; no route spends provider tokens anonymously.*

**Desired implementation.**
1. In `handleCallPayloadOffloadPost`, load the `post_call` the same way the GET sibling does and call `assertCanReadResource(ctx, resourceFromRow(postCall))` before `uploadCallPayload`. Return 404 for an unknown id (do not leak existence).
2. Move the `global` branch **after** `resolveHistoryEmail` and require an admin scope (see `isRecoveryAdmin` in `routes/recovery.ts:251` for the existing pattern).
3. Add `await requireUser(request, env)` to `handleSearchRag` and reject when it yields no uid.

**Must remain unchanged.** Legitimate same-tenant access. Verify with the existing e2e suite that the call view still loads and search still works.

**Tests to create.** T6/T7 from [08](08-test-coverage.md) §8: a cross-tenant id on `offload-payload` returns 403; `?global=1` without admin returns 403; unauthenticated `/api/search/rag` returns 401. Register all three.

**Tests to run.** The new tests; `npm test --prefix worker`; `npm test --prefix web` (for the e2e regression check).

**Telemetry.** Log and alert on rejected cross-tenant attempts.

**Rollout / rollback.** No flag; three minimal diffs. Rollback = revert.

**Acceptance criteria.** All three routes reject unauthorised callers; no legitimate flow regresses.

**Non-goals.** Do not audit the other 40+ routes here. (Do note that `authContext` at `domain-reads.ts:58` calls `ensureNodeFirestore` first, so these routes already 503 on Cloudflare — that is separate.)

---

## P5 — Stop the silence around failed durable writes

**Findings:** F-001 observability, H14; evidence E-028, E-029, E-035, E-036.

**Problem.** A failed post-call SQL write is invisible. `trySqlDomainWrite` (`worker/src/routes.ts:1767`) has **no try/catch** around `withSessionContext`, so a write error becomes a 500 whose body `worker/src/index.ts:148-159` rewrites to `"Internal error."`; `web/app.js:3229-3234` then does `console.warn("Lifecycle dual-write (post-call) failed:", err)` and the user sees a normal call view. Separately, `tryHistoryPostCallSqlWrite` (`routes.ts:2921-2952`) returns silently on six distinct skip conditions, and **six of them log nothing at all** — including the common "no `accountId`" case.

**Invariant to establish.** *A durable write that did not happen is always recorded somewhere queryable.*

**Desired implementation.**
1. Wrap the `withSessionContext` call in `trySqlDomainWrite` so a write error produces a `logFallback({method, reason: "write_error", entityPublicId, detail})` row in `sql_fallback_log` (schema: `janus/schema/30_fallback_telemetry.sql`) **and still propagates** — do not swallow it.
2. Add a `logFallback` call to each silent skip in `tryHistoryPostCallSqlWrite`, naming the specific reason (`no_port`, `pg_not_ready`, `no_uid`, `no_account_id`, `no_analysis`, `no_sql_session`, `no_owner_org`, `shape_validation_failed`).
3. In the browser, replace the bare `console.warn` with a non-blocking, dismissible indicator ("Some details could not be saved — retrying"). Do **not** block navigation or show a modal.

**Must remain unchanged.** **The 200 contract of `POST /api/history` is deliberate** (`routes.ts:1391-1409` documents it). Make the failure *visible*, not the response code. Keep the `[history][dual-write-DROPPED]` line — it is intentionally loud and greppable.

**Tests to create.** Force a write failure and assert a `sql_fallback_log` row appears with the right reason.

**Tests to run.** The new test; `npm test --prefix worker`.

**Telemetry.** Alert on the `sql_fallback_log` insert rate, grouped by `method` and `reason`. Query: `SELECT method, reason, count(*) FROM sql_fallback_log GROUP BY 1,2 ORDER BY 3 DESC;`

**Rollout / rollback.** Diagnostic only — ship alongside P3 so P3's effect is measurable.

**Acceptance criteria.** Every dropped post-call write appears in `sql_fallback_log`; the rate visibly drops to zero once P3 lands.

---

## P6 — Register the unreachable routes

**Findings:** F-012 (P1), F-013 (P1); evidence E-043, E-044, E-045.

**Problem.** The route table is an exact-match two-level object at `worker/src/routes.ts:3298-3340`. These handlers exist and are imported by nothing:

| Path | Handler | Who calls it |
|---|---|---|
`GET /api/health`, `/health/live`, `/health/ready` | `routes/health.ts:129,79,89`; `healthRoutes:138` | `deploy/cloudrun/README.md:21` configures Cloud Run **liveness and readiness probes** here |
`POST /api/read-models/schedule` | `routes/read-models.ts:33` | **the browser**, `web/domain/read-models-service.js:76` |
`POST /api/internal/batch/enqueue` | `routes/internal-batch.ts:96` | `deploy/vps/cron-batch.sh:37` — an **active** cron |
`POST /api/internal/read-models/nightly-rebuild` | `routes/internal-batch.ts:204` | `deploy/vps/cron-batch.sh:38`, `deploy/cloudrun/cloud-scheduler.example.sh:37` |
`POST /api/internal/batch/poll`, `/fallback`, deal-grace-sweep | `routes/internal-batch.ts:161,182,263` | nothing (but they are the Gemini **batch** summary path) |

Negative proof: `grep -rn 'healthRoutes\|handleHealth' worker/src` returns only definitions.

**Invariant to establish.** *Every exported route handler is reachable from the route map, or is deleted.*

**Desired implementation.**
1. Import and spread `healthRoutes` into the `routes` object. Keep them in the `rate-limit.ts:131-142` exemption list (already there).
2. Register `/api/read-models/schedule` and the four `/api/internal/*` routes, preserving each handler's existing `verifyInternalCronAuth` / `X-Cron-Secret` check.
3. **Verify the Cloud Run probe paths actually match** before anyone relies on them.

**Must remain unchanged.** Auth requirements on every handler. Do not weaken the cron secret check.

**Tests to create.** **T8** — a test that enumerates every exported `handle*` symbol in `worker/src/routes/*.ts` and asserts each is reachable from `routes`, `index.ts`'s hardcoded branch, or one of the two `dispatch*ById` regex tables. This single test prevents the entire class. Register it as `unit`.

**Tests to run.** T8; `npm test --prefix worker`; then `curl` each newly-registered path against a local `dev-node.mjs`.

**Telemetry.** Alert on non-2xx from the nightly cron — it has been 404ing silently.

**Rollout / rollback.** Purely additive. Rollback = remove the entries.

**Acceptance criteria.** All five paths return the handler's response instead of 404; T8 green.

**Non-goals.** Do not implement the Zoom webhook here (that is P13's long-term section). Do not build a scheduler for `/api/internal/outbox/project` — note in your report that it is registered but has no caller.

---

## P7 — Persist the hydration tail; give Pass 8/9 real evidence

**Findings:** F-002 (P0), F-003 (P0); evidence E-013–E-019.
**DEPENDENCY: P2 and P3 must be merged first**, or these writes still cannot land.

**Problem — structural, not a race.** Three facts compose:

1. `POST /api/postcall/generate` returns only `{...narrative, scorecard, videoFacts, confirmed, analysisMeta}` (`worker/src/postcall/generate.ts:269-287`). It does **not** return `summarise`, `qualification`, `technicalCommit`, `pass6`, `arrCompute` or `timeline`.
2. `linkPostCallToLifecycle` (`web/domain/dual-write.js:172-505`) is the **only** writer of normalized child rows, and it reads every artefact off `data.*` — so on a first analysis they are all `undefined`. That includes `rollupDealTractionAfterPostCall` (Pass 8, `:395-407`) and `regenerateSummariesAfterPostCall` (Pass 9, `:441-447`), which therefore compute from nothing.
3. `setOnCallRecordHydrated` (`web/app.js:3118-3124`) only calls `scheduleCallRecordPanelRefresh` — **a UI repaint. It performs no write.**

Net: 18 of 20 post-call artefacts never reach relational SQL. See [03](03-postcall-write-ledger.md) §2 for the full matrix.

**Invariant to establish.** *Every artefact listed in `docs/astra-audit/03-postcall-write-ledger.md` §2 has a proven durable destination, and Pass 8/9 run only after their required evidence is present.*

**Architecture constraints.** Keep the browser orchestration and the existing API surface for now (Option B, not C — see [09](09-architecture-options.md)). The child-write block must become **idempotent and callable twice**, because the first call still happens at `onAnalysisSaved`.

**Desired implementation.**
1. Extract everything in `linkPostCallToLifecycle` from `persistScorecardDraft` onward into a separate exported function, e.g. `persistPostCallChildren(ctx, artefacts)`. Make it idempotent: every write already upserts by a stable id, so verify rather than assume, and add ids where missing.
2. At the end of `runPostcallParallelHydration` (`web/postcall.js:~5029`), after the final `updatePostCallAnalysis`, call `persistPostCallChildren` with the **merged** record — the one that now has `qualification`, `summarise`, `technicalCommit`, `arrCompute`, `pass6`, `timeline`, `videoFacts`.
3. **Recompute Pass 8 and Pass 9 there**, with an explicit precondition check: skip and log if the required evidence is still absent, rather than computing from `undefined`.
4. Report per-artefact success/failure back to the caller so it is observable — do not add another 14 silent `try/catch` blocks.

**Must remain unchanged.** The initial `linkPostCallToLifecycle` call at `onAnalysisSaved` — the account/deal/contact spine must keep landing early, since W6/W7 currently succeed. The abort machinery (`isPostcallPipelineStale`) must gate the new call.

**Database migration.** None.

**Concurrency / idempotency.** The child writer may run twice for one call (once early, once at completion) and must converge. It must also tolerate two browser tabs; rely on the upsert keys, not on ordering.

**Tests to create.** **T3** — drive a fixture post-call end-to-end, then assert **one row per artefact** in every expected table (`scorecard`, `scorecard_line`, `scorecard_theme`, `call_participant`, `technical_commit`, `product_signal`, `deal_traction`, `deal_summary`, `account_summary`, plus the `post_call.detail` collections). Assert **presence of content**, not merely row existence. Add explicit assertions that Pass 8/9 inputs were non-empty.

**Tests to run.** T3; the P2 and P3 tests; `npm test --prefix worker`; `npm test --prefix web`; `npx tsc --noEmit`.

**Telemetry.** Per-artefact write counters. Alert when a call completes hydration with zero child rows.

**Rollout / rollback.** **Feature-flag it.** Rollback is safe by construction: with the flag off, behaviour reverts to today's, which writes nothing.

**Acceptance criteria.** A fixture post-call produces a row in every expected table; Pass 8/9 inputs are provably non-empty; `SELECT count(*) FROM scorecard` grows one per call.

**Non-goals.** Do not move this server-side yet (that is the later `POST /api/postcall/finalize` work). Do not fix `pipeline_state` here — that is P8, which depends on this.

---

## P8 — Make `pipeline_state` mean something

**Finding:** F-006 (P1); evidence E-033, E-034. **DEPENDENCY: P7.**

**Problem.** `pipeline_state` has exactly two writers — `worker/src/routes.ts:2734` and `:3000` — and **both hardcode `'analysis_done'`**. Exhaustive grep confirms `detail_done`, `scoring_done`, `signals_done` and `failed` are never written by application code; they appear only in the enum (`janus/schema/00_phase0_infra_and_org.sql:47-49`), one partial index, and a **reader**: `worker/src/data/persistence/read-repository.ts:155` derives `provisional: row.pipeline_state !== "signals_done" && row.pipeline_state !== "scoring_done"`. Since neither value is ever written, **every SQL-read call summary is permanently `provisional: true`.**

**Invariant to establish.** *`pipeline_state` reflects which artefacts actually exist, and never moves backwards.*

**Desired implementation.** Write the state from P7's completion writer based on real presence: `analysis_done` after generate; `detail_done` once the `detail` collections land; `scoring_done` once the scorecard and its lines land; `signals_done` once Pass 6/8/9 land; `failed` on a terminal error. Rely on P2's no-regression guard.

**Must remain unchanged.** The enum — all six values already exist and are sufficient. `read-repository.ts:155`'s derivation is correct once the states are written; do not change it.

**Database migration.** No DDL. Existing rows stay `analysis_done`; a separate optional backfill can derive state from present artefacts.

**Tests to create.** **T4** — a state-machine test walking all six values, including an assertion that a regression attempt is rejected, and that `provisional` becomes false at `scoring_done`.

**Tests to run.** T4; P7's T3; `npm test --prefix worker`.

**Telemetry.** A `pipeline_state` distribution dashboard: `SELECT pipeline_state, count(*) FROM post_call GROUP BY 1;`

**Rollout / rollback.** Ship with P7 behind the same flag.

**Acceptance criteria.** A completed call reads back with `provisional: false`; the distribution shows more than one value.

---

## P9 — Make `ai_run` joinable to the call it belongs to

**Finding:** F-023 (P1); evidence E-092–E-097, E-064, E-120, R-007.

**Problem.** Of ~28 provider invocations per post-call, essentially **none** join back to a `post_call` row.

- `ai_run` has **no `call_id` column** — only `activity_id bigint REFERENCES activity(id)` (`janus/schema/03_phase3_ai_pipeline.sql:59-77`). `resolveActivityId` (`worker/src/data/persistence/ai-run.ts:119-132`) converts the incoming `callId` to `act_<id>`, resolves it, and **discards the string**. A miss writes `activity_id = NULL`, unrecoverably.
- **No post-call route injects the authenticated identity.** `requireUser`'s return value is discarded at every post-call handler (`worker/src/routes.ts:525,557,578,619,641,663,705,727,808`); `userId` and `callId` are client-supplied body fields.
- The critical-path passes send **no `callId` at all** — `generateBody`, `qualifyBody`, `summariseBody` and the gaps body have no such key (`web/postcall.js:4542-4582,4426-4436,4821-4832`).
- The video pass sends `callId: \`call_pending_${Date.now()}\`` (`web/postcall.js:4520`), which the worker threads through verbatim (`routes.ts:408-415`) and which resolves to nothing.
- `summaries.ts` is structurally unattributable: `PostCallSummariesInput` (`worker/src/postcall/summaries.ts:54-57`) has no such field.
- `insertAiRun` is fire-and-forget (`void aiRunRepository.insert(...)`, `worker/src/data/llm-usage.ts:61`) and resolves the activity at write time, so it can lose the race against the client-driven creation of `act_<id>`.
- `ai_run` is append-only (`REVOKE UPDATE, DELETE … FROM janus_app`, `janus/schema/16_ai_run_telemetry.sql:36`), so no row can ever be backfilled.
- **Its only test cannot load**: `janus/tests/ai_run_insert.harness.ts:12,28` uses top-level `await` in a `.ts` file that `tsx` resolves as CJS. Observed failure: `ERROR: Top-level await is currently not supported with the "cjs" output format`.

Downstream: `worker/src/data/usage-anomaly.ts:56-57` skips rows without a `callId`, so the summarise cost-anomaly detector has a permanently empty baseline and can never fire.

**Invariant to establish.** *Every `ai_run` row joins to the post-call it belongs to, and `user_id` comes from the verified token.*

**Desired implementation.**
1. **Inject `userId` server-side** in every post-call handler from the `VerifiedUser` that `requireUser` already returns. **Never trust the body for identity.**
2. Mint the call id **before** the first LLM call so `callId` is real from `/resolve` onward — *or*, if that is too invasive, add a nullable `call_ref text` column so an unresolvable row stays diagnosable and repairable at the reporting layer.
3. Replace `call_pending_${Date.now()}` with the real id, threading it through `/api/video-pass`.
4. Add `userId`/`callId` to `PostCallSummariesInput` and pass them through `generateSummaryJson`.
5. Fix the harness: convert `ai_run_insert.harness.ts` to an async `main()` (the pattern the audit's own repros use), or add the `"type": "module"` resolution it needs.

**Must remain unchanged.** The append-only REVOKE. The Firestore `llmUsage` mirror.

**Database migration.** Optional additive nullable `call_ref text`. Additive only; no backfill of historical rows is possible.

**Tests to create.** **T10** — after a fixture post-call, assert `activity_id IS NOT NULL` for every pass, and that `SUM(cost_usd) GROUP BY activity_id` returns one row for that call.

**Tests to run.** T10; `janus/tests/ai_run_insert.test.mjs` (must now pass — it currently fails with 2 checks); `npm test --prefix worker`.

**Telemetry.** This *is* the telemetry work. Monitor `SELECT count(*) FROM ai_run WHERE activity_id IS NULL` — it must trend to ~0 for post-call passes.

**Rollout / rollback.** No flag. Rollback = revert.

**Acceptance criteria.** Cost and latency per user-visible post-call are reconstructable by joining `ai_run` → `activity` → `post_call`; `janus/tests/ai_run_insert.test.mjs` exits 0.

**Note for the implementer.** All performance figures in [07](07-performance-and-cost.md) are a static model **because of this bug**. Landing P9 is what makes real measurement possible.

---

## P10 — Timeouts on every provider call; fix pass classification

**Finding:** F-027 (P1); evidence E-099, E-100.

**Problem.** Three provider calls on the live post-call path have **no timeout, no `AbortController` and no retry**:

- `worker/src/video/transcript-infer.ts:341` (`inferSummaryPhaseTimeline`) — bare `await fetch(url, {...})`
- `worker/src/video/transcript-infer.ts:464` (`inferVideoFactsFromTranscript`) — bare fetch, and note the malformed formatting `const res = await fetch(url, {      method: "POST",`. **This is the default video route** whenever `visualAnalysisConsent` is false (`video/pass2.ts:497`)
- `worker/src/embeddings.ts:58` (`embedVerbatim`) — bare fetch, and up to **12 run concurrently** per gaps pass (`worker/src/postcall/gaps.ts:368-370`)

Negative proof: neither file contains `AbortController` or `signal`.

Separately, `POSTCALL_PASS_NAMES` (`worker/src/providers/gemini-retry.ts:10-20`) lists only 9 names, so **`scorecard-verify`, `scorecard-calibrate`, `deck-validate`, `speaker-attribution` and `linkedin-identity` fall through to the 45 s `extraction` budget** — despite verify and calibrate carrying 8000 maxTokens plus a full transcript window and sitting on the same critical path as the 75 s `scorecard`.

**Invariant to establish.** *No provider call can hang unbounded, and every pass gets a budget matched to its actual size.*

**Desired implementation.**
1. Route all three calls through `fetchGeminiWithRetry` (`worker/src/providers/gemini-retry.ts:127-160`), which already provides the AbortController, retry ladder and backoff.
2. Add the five missing names to `POSTCALL_PASS_NAMES`.
3. Consider whether `embedContent` warrants its own workload class — 12 concurrent calls under one budget is a different shape from a single generate.

**Must remain unchanged.** The existing budget values in `GEMINI_TIMEOUT_MS` — they carry documented p95 rationale. The ffmpeg timeouts (15 min / 5 min per window) are separate and correct.

**Tests to create.** **T11** — a static test asserting (a) no bare `fetch(` to a provider host exists outside `fetchGeminiWithRetry`, and (b) every post-call `passName` used in `worker/src/postcall/**` appears in `POSTCALL_PASS_NAMES`.

**Tests to run.** T11; `npm test --prefix worker`; `npx tsc --noEmit`.

**Telemetry.** Timeout rate per `pass_name`.

**Rollout / rollback.** No flag. Rollback = revert.

**Acceptance criteria.** T11 green; a simulated hung socket aborts within budget rather than hanging.

**Non-goals.** Do not change `gemini-batch.ts` or `gemini-cache.ts` here — note them in your report as remaining unguarded (they are off the critical path).

---

## P11 — Bulk history sync must project to SQL

**Finding:** F-014 (P1); evidence E-037. **DEPENDENCY: P2, P3.**

**Problem.** `handleHistoryPost` (`worker/src/routes.ts:1382-1385`):

```ts
if (Array.isArray(body.entries)) {
  const entries = await replaceHistory(env, email, body.entries);
  return json({ email, entries, count: entries.length }, 200, cors);
}
```

It returns **before** the `tryHistoryPostCallSqlWrite` call at `:1398`. So `syncHistoryOnLogin` → `pushRemoteEntries` (`web/history.js:229`) and `POST /api/recovery/upload` never project anything to SQL. Locally-recovered calls can only ever repopulate the blob.

**Invariant to establish.** *Every path that persists a post-call record projects it to SQL, best-effort, exactly once per entry.*

**Desired implementation.** After `replaceHistory` succeeds, iterate the entries and call `tryHistoryPostCallSqlWrite` for each, preserving the best-effort contract (never change the 200, log every drop). Bound the concurrency — a bulk push can carry up to 100 records (`MAX_ENTRIES`).

**Must remain unchanged.** The 200 contract. `replaceHistory`'s blob semantics.

**Why after P2/P3.** Without them, a bulk push of 100 records would multiply the collision 100×.

**Tests to create.** Assert a bulk push of N entries yields N `post_call` rows.

**Tests to run.** The new test; the P3 convergence test; `npm test --prefix worker`.

**Telemetry.** Count projected rows and drops per bulk push.

**Rollout / rollback.** Feature-flag it — it can be a heavy operation. Rollback = flag off.

**Acceptance criteria.** A bulk push lands one `post_call` row per entry.

**Note.** This becomes the **reconciliation mechanism** for P7: a bulk re-push of history replays every historical call into SQL.

---

## P12 — Streamline post-call intake  *(mandatory product problem 1)*

**Findings:** F-016 (P2), F-017 (P2), F-018 (P2); evidence E-003–E-011, E-060, E-061, E-079. Full ledger: [12](12-postcall-ux-zoom-and-loading.md) Part A.

**Problem A — the primary action is gated on a network round-trip.** `computeAnalyzeButtonDisabled` (`web/postcall.js:697-715`) includes `!s.crmPreviewSurfacedOnce`, a flag set only when `renderCrmMatchesPanel` completes (`:1110`, `:1184`) — which requires a CRM lookup. It is reset on **every keystroke** in the prospect-emails field (`resetCrmPreviewGate`, `:5998`, `:6006`). `computeAnalyzeButtonProgress:722-727` counts it as one of three mandatory items, so the ring sits at 2/3 over two visibly-filled fields.

**Problem B — every handler fires twice.** `web/crayons-ui.js:215-218` documents that Crayons emits **both** `fwClick` and native `click` per gesture, and ships `bindActionOnce:221-236` to dedupe. It is used at **3 sites repo-wide** against ~99 `fw*` registrations. `web/postcall.js:5950-6010` binds `fwInput`+`input`(+`fwBlur`) pairs throughout — `#pc-recording-url` has 8 listeners for 3 logical handlers — and the emails `fwBlur`+`blur` handlers each call `renderCrmMatchesPanel()`, so **one blur issues two CRM lookups**. `#analyze-call` is `<fw-button type="submit">` inside `#postcall-form` (`web/index.html:772`) with both the form `submit` and the button `fwClick` calling `analyzeCall`. `startPipeline`'s `pass0Busy` guard is set only **after two `await`s** (`:5520-5533`), so two same-tick events both pass it.

**Problem C — needless serialisation.** `startPipeline:5551-5632` is strictly serial: `await postCallOwnerId()` (already promise-started 3 lines above, and awaited twice) → `await domainContextP` → `/resolve` → `enrichResolveDealsForAccount` → `resolvePipelineSeMotion` → `/classify` → gate. **Classification blocks the confirmation view** even though it only pre-selects a chip the user can override. On confirm, `confirmAndGenerate:4352-4372` runs a **serial `for … await ensureCustomerContact`** loop before any generation work.

**Invariant to establish.** *The Analyse button reflects field completeness only. No confirmation whose removal could produce a wrong account, deal, ownership or identity write is removed.*

**Desired implementation.**
1. Remove `crmPreviewSurfacedOnce` from `computeAnalyzeButtonDisabled` and from the progress ratio. Keep the CRM lookup — surface its result as a non-blocking preview, and keep `crmResolving` only as a transient spinner (not a disable).
2. Use `bindActionOnce` for every `fw*`+native pair in `web/postcall.js` and `web/call-view.js`. Remove the duplicate `submit`/`fwClick` binding on `#analyze-call` — keep one.
3. Make `startPipeline`'s re-entry guard atomic: set `pass0Busy = true` **before** the first `await`.
4. Delete the redundant `await flushCrmMatchesPanel()` at submit (step 13 of the ledger) and the double `await postCallOwnerId()`.
5. **Render the confirmation gate as soon as `/resolve` returns**; fill the call-type chip when `/classify` lands, marked as a suggestion with its confidence.
6. Parallelise the contact-creation loop (bounded concurrency), or defer it until after `/generate` returns — it is only needed by `linkPostCallToLifecycle`.
7. Start Zoom pre-resolution when the recording link is pasted, not at submit.
8. Where confidence is high (single account match, single open deal, SE inferred by session-email match — see `inferAttendeeRole:3312-3337`, which is already sophisticated), **auto-confirm and offer correction** rather than requiring a stop.
9. Fix the gate footnote at `:3820` ("Analysis usually finishes in 20–45 seconds") to match reality, or make it true by shipping the verify∥calibrate change in [07](07-performance-and-cost.md) §3.1.

**Must remain unchanged — these are correctness gates.** The manager proxy-SE requirement (`proxySeMissing`; there is a documented bug report behind it — see the comment at `web/postcall.js:700-706`). Account choice when >1 matched. Deal choice when >1. Attendee-role correction. The `!seIdentity` hard block. The company-domain requirement for free-mail domains. **All must remain *available*; only their blocking-by-default may change, and only where confidence is high.**

**Tests to create.** **T13** — unit tests over `computeAnalyzeButtonDisabled`/`computeAnalyzeButtonProgress` asserting no network dependency; a Playwright journey counting discrete interactions and blocking waits from page open to durable acceptance (target: ≤5 interactions, ≤2 human gates on the happy path); a test asserting one physical click produces exactly one `analyzeCall` invocation.

**Tests to run.** T13; `npm test --prefix web`; `npm run test:e2e --prefix web`.

**Telemetry.** Instrument time-to-button-enabled, click count to acceptance, and the CRM lookup count per session.

**Rollout / rollback.** Flag the gate-rendering change (item 5); the rest are safe. Rollback = flag off / revert.

**Acceptance criteria.** The button enables on field completeness alone and does not de-enable on keystrokes; one click = one pipeline; the happy path is ≤5 interactions; every correctness gate is still reachable.

**Non-goals.** Do not redesign the visual layout. Do not remove any confirmation control.

---

## P13 — Make Zoom transcript acquisition reliable  *(mandatory product problem 2)*

**Finding:** F-026 (P1); evidence E-102–E-111, E-106. Full analysis: [12](12-postcall-ux-zoom-and-loading.md) Part B.

**Problem.** Acquisition is pull-only, synchronous and single-attempt. Verified negatives: no `scheduled()` handler (`grep -n 'scheduled' worker/src/index.ts` → no match), no webhook receiver, no cron discovery, no readiness polling, no OAuth refresh grant, **no timeout or retry on any Zoom HTTP call**, and no speech-to-text anywhere (`worker/src/video/` emits JPEG frames only; `VideoFactsDraft` has no dialogue field).

Three specific defects:

1. **A still-processing transcript is reported as permanently absent.** `completedFiles` (`worker/src/zoom-api.ts:212-216`) filters out any file whose `status !== "completed"`, so `transcriptFile` is `undefined` and the user gets *"That Zoom recording has no transcript. Turn on 'Create audio transcript'…"* (`:304-310`) — with no retry affordance. This is the most common failure.
2. **A link without `?startTime=` cannot be resolved at all.** `fetchZoomRecordingViaApi` (`:280-288`) hard-stops, because the epoch-ms is the **only** join key against `/v2/accounts/me/recordings` — the share id is never sent to Zoom.
3. **Status reporting is inverted.** `/api/config` (`worker/src/routes.ts:153`) and `/api/zoom/status` (`:122`) report `zoomConfigured` — the **dead user-OAuth triple** (`ZOOM_CLIENT_ID`/`SECRET`/`REDIRECT_URI`, `worker/src/zoom.ts:16-18`) — not `zoomApiConfigured`, the working Server-to-Server triple (`ZOOM_ACCOUNT_ID`/`CLIENT_ID`/`CLIENT_SECRET`, `:21-23`). Zoom can display as configured while fetch is impossible, and vice versa.

Also: the intake hint says *"we'll pull it in to transcribe and analyze"* (`web/index.html:666`). Nothing transcribes.

**Invariant to establish.** *A recording whose transcript Zoom will eventually produce is never reported as having none, and every Zoom HTTP call is bounded.*

**Desired implementation — the smallest reliable path.**
1. Switch both status endpoints to `zoomApiConfigured`, and surface it in the intake so the SE knows before pasting whether automatic fetch is possible.
2. Read `recording_files[].status`. When a `TRANSCRIPT`/`CC` file exists but is not `completed`, return a distinct `transcript_pending` outcome carrying Zoom's own timestamp — never the "turn on audio transcript" message.
3. On `transcript_pending`, poll the recording lookup with bounded backoff (30 s / 2 min / 5 min / 15 min, then give up with a clear message). This alone converts the most common failure into a wait.
4. Add `AbortController` timeouts and bounded retries to every Zoom HTTP call in `zoom-api.ts` and `zoomShare.ts` — none has either today.
5. When `?startTime=` is missing, fall back to matching on `topic` plus the meeting date already known from intake, instead of refusing outright.
6. Fix the intake copy: "we'll fetch the transcript Zoom generated".

**Must remain unchanged.** The **API-first, scrape-second** dispatch order (`worker/src/postcall/resolve.ts:478-523`) and specifically the `fallback: true` discipline — a real API answer such as "no transcript" must NOT silently fall through to the scraper. There is a test asserting this (`worker/scripts/test-zoom-api.ts:255-262`); keep it green. Keep the deliberate exclusion of the `.token` path suffix as a passcode (it triggers `captcha_error` — `worker/src/zoomShare.ts:160-189`). Keep both CAPTCHA-detection branches and `assertZoomNotSsoHtml`. Keep the chapter-marker-only rejection (`isChapterOnlyVtt`). **Keep the manual VTT upload path** — it is the only recovery when Zoom genuinely has no transcript.

**Tests to create.** **T12** — a mocked-`fetch` suite (the highest-value new test file in the repo, since the entire `zoomShare.ts` network layer is currently untested, **including both CAPTCHA branches**) covering: transcript ready; transcript **pending** then ready on poll; transcript absent; missing `?startTime=`; embedded `?pwd=`; separately-entered passcode; expired/revoked link; permission denied; SSO redirect; CAPTCHA on the first call; CAPTCHA via `status:true`+`result:"captcha_error"`; duplicate re-analysis of the same meeting.

**Tests to run.** T12; existing `worker/scripts/test-zoom-api.ts` and `test-zoom-share-media.ts`; `npm test --prefix worker`. **Do not run `test-zoom.mjs` or `test-video-pass-live.mjs`** — they hit the live Zoom API.

**Telemetry.** Outcome counters per scenario (`ok`, `transcript_pending`, `transcript_absent`, `no_start_time`, `captcha`, `sso_redirect`, `permission_denied`, `timeout`), so the real failure distribution becomes visible for the first time.

**Rollout / rollback.** Flag the polling behaviour (item 3). The rest are safe. Rollback = flag off.

**Acceptance criteria.** A recording whose transcript is still processing yields `transcript_pending` and succeeds on a later poll; every Zoom call has a timeout; the status endpoints report the predicate that actually governs fetch.

**Non-goals — and an explicit product caveat.** Do **not** build the webhook connector here; it needs the durable ingestion boundary from [09](09-architecture-options.md) Option C. When that is scoped, the design must include: signature verification; an idempotency key on `(zoom_account_id, meeting_uuid, recording_file_id)` that the reader queries **with the same prefix convention** (the current `call_` mismatch is the cautionary tale); host→SE mapping that refuses rather than guesses; auto-created calls marked **provisional** and surfaced for confirmation; duplicate suppression; rate limits; transcript retention and deletion (transcripts are customer PII); retry/dead-letter; backfill; and a manual override. **Label as an unsupported product assumption** the premise that SEs want every recorded call auto-analysed — that should ship behind an opt-in with a visible approval queue, not as a silent default.

---

## P14 — One view-state model for the post-call views  *(mandatory product problem 3)*

**Findings:** F-029–F-035 (all P2); evidence E-065–E-084. Full ledger: [12](12-postcall-ux-zoom-and-loading.md) Part C.

**Problem.** A cold saved-call open performs **six** full `#call-panel.innerHTML` replacements (`web/app.js:1709`; `web/call-view.js:3399,3442,3450,3502,3525`), across **8 sequential await barriers** in `loadCallBundle`'s 18 `safeEnrich` sites, with **≥12 full localStorage history parses**, ~45 store operations, **≥10 network requests** (14 cold), one exactly duplicated technical-commit query and two reads of the same deal. `paintCallRecord` (`:3342-3350`) is unconditional destroy-and-rebuild, so each replacement discards scroll, open `<details>` and tab state, and restarts the KPI count-ups (because `call-view-animate.js` keys its "already animated" sets on `callId:attr:value`, and each paint supplies a different value).

Six compounding defects:

1. **Seven independent state deciders** (`app.js:1707-1717`, `:1636-1657`; `call-view.js:3386-3393`, `:3432-3435`, `resolveRecordHydration:595-608`, `resolveEffectiveHydrationPending:633-664`, plus per-section predicates), with `pending` derived **three** times from three different reads. Several section renderers (`renderTechnicalCommitTab`, `renderDealHealthTab`, `renderMinutesTab`, `renderStakeholderSection`) never receive `pending` at all. `showPostCallPipeline` (`web/postcall.js:3185-3190`) decides its own visibility by **reading another panel's DOM `hidden` attribute**.
2. **Nine empty states assert absence before any authoritative read** — all render on the local-bundle paint. Four instruct the user to "re-run post-call analysis" for a pipeline that already succeeded. The deal-context strip returns `""` entirely (`:1791`) and appears ~8 barriers later — the largest layout shift of the open. `safeEnrich` (`:2688-2700`) swallows every error into `null`/`[]`, so a failed read is indistinguishable from an empty one.
3. **The realtime subscription can never be torn down.** `buildSubscribeRemoteCallDetail` (`web/app.js:811-819`) is an `async` arrow, so `container._callDetailUnsub` holds a **Promise**; both teardown sites test `typeof === "function"` (`call-view.js:3378`, `app.js:922-930`) and never fire. In `firestore` mode each render stacks another 12 listeners permanently. In the default `api` mode it never attaches at all, because `fbReadyPromise` is only resolved when `readMode === "firestore"` (`web/domain/store.js:265-268`) while `resolveReadMode` returns `"api"` (`:68`) — so the one live-update path silently does not exist.
4. **Inverted merge precedence.** The awaited path prefers local (`se-access-service.js:78-81`; `call-view.js:3424-3429`, `:3024-3032`); the realtime path prefers remote **over a pre-hydration snapshot** (`call-view.js:3459-3465`); and `mergeHistoryLists(local, remote)` (`web/history.js:134-144`, called `:302`) resolves collisions by argument order with **no timestamp comparison**. Two concrete revert paths are documented in [12](12-postcall-ux-zoom-and-loading.md) §C5.
5. **Broken progress/refresh plumbing.** `setCallRecordProgress(recordId, "")` is a **no-op** (the `!message` guard at `:3147`), so the hydration-complete clear at `:5029` does nothing. `scheduleCallRecordPanelRefresh` (`app.js:1636-1674`) has four early returns that set `callRecordRefreshTargetId` and **arm no timer**, and nothing else reads that variable — so in the normal case (4–5 pending keys) a section update never repaints. `callRecordRefreshTimer` is one global, so `clearTimeout` for one call kills another call's pending refresh.
6. **`#call-mom-save` fires twice per click** (`fwClick` + native, no `bindActionOnce` — `call-view.js:2592,3286-3287`) → two concurrent `POST /api/history` read-modify-writes.

**Invariant to establish.** *One state machine per view; at most two full paints per open; `unknown` is never rendered as `empty`; the newest data always wins.*

**Desired implementation.**
1. Introduce one explicit state: `idle → loading → partial(record, pendingSet) → complete(record) → error(reason)`. Every section reads **only** that. Delete the seven ad-hoc deciders and the three separate `pending` derivations. Pass `pending`/`errors` to every section renderer that needs them.
2. Two paints maximum — one skeleton, one content paint — then **targeted** section updates keyed by a generation token. Never `innerHTML` the whole panel to add one field.
3. Change `safeEnrich` to return `{ok: false, reason}` instead of `null`. Every empty state must render "couldn't load — retry" for a failed read, and "none yet" only for a proven-absent artefact. **Remove the four "re-run analysis" instructions.**
4. Add a request-coalescing layer: de-duplicate the 3× technical-commit and 2× deal reads; cache `getAccount` like `getDeal`/`getCall`; collapse the 8 serial barriers into at most 2 waves.
5. One merge rule: `updatedAt` wins, on **both** paths and in `mergeHistoryLists`.
6. Fix the subscription or delete it. Either make the factory synchronous and resolve `fbReadyPromise` in every mode, or remove the dead path and keep the `lionpath:*` event bus as the single update channel. **Decide explicitly** — do not leave it half-wired.
7. Fix `setCallRecordProgress` to accept `""` as "clear"; give `scheduleCallRecordPanelRefresh` a per-call timer map and remove the four dead early returns.
8. Use `bindActionOnce` for every `fw*`+native pair.
9. Also remove `isFirestoreStoreReady` (`web/domain/store.js:283-285`) — it tests `fbReadyResolve` twice, returns true when the store is *not* ready, and has zero callers.

**Must remain unchanged.** The existing generation guards that DO work (`callPanelRenderGen`, `shouldApply`, `crmMatchesToken`, `isPostcallPipelineStale`) — extend the pattern, don't replace it. The `lionpath:call-record-progress` handler's surgical DOM update (`app.js:3131-3143`) is the only non-destructive update in the file; keep that approach and generalise it.

**Tests to create.** **T14** — an instrumented render test asserting paint count ≤2 per open, request count with no duplicates, and that a stale response cannot overwrite a newer paint; a test that a failed read renders "retry" rather than "none"; a test that one MoM-save click issues exactly one `POST /api/history`.

**Tests to run.** T14; `npm test --prefix web`; `npm run test:e2e --prefix web`.

**Telemetry.** `performance.mark` around each paint; count paints, requests and layout shifts per open.

**Rollout / rollback.** Flag the new state machine and keep the old path until the paint-count assertion holds in the e2e suite. Rollback = flag off.

**Acceptance criteria.** ≤2 paints per open; no duplicate queries; scroll/tab/`<details>` state survives hydration; a failed read is visibly distinct from an empty one; hydrated fields never revert.

**Non-goals.** Do not redesign the visual layout or change what the sections display.

---

## P15 — CI foundation

**Finding:** F-038 (P1); evidence E-122–E-130, E-054. **Independent, but it unlocks verification for every other prompt.**

**Problem.** CI provisions **no PostgreSQL**, so 12+ tests and every SQL gate are unreachable. `tsc --noEmit` **never runs** — it is reachable only inside `test:sql-gates`, which no workflow calls. Three `janus/tests` gates (`grants_smoke`, `rls_fails_closed`, `ai_run_insert`) **silently `return` and exit 0** when `DATABASE_URL` is unset; only `view_rls.test.mjs:21-24` hard-fails. `promotion-gate.yml` runs `firebase emulators:exec` and `test:rules` with **no `setup-java`**, which `ci.yml:19-23` documents as required. **13 test files are in no manifest**, including the entire ADR-008 persistence lane. `web/scripts/run-tests.mjs:123` silently drops all 14 shared-e2e tests when any unit test fails. `web/scripts/test-adr008-read-contract.mjs:9-12` is **permanently dead** — its guard greps `worker/src/routes.ts` for `PERSISTENCE_READ_MODE`, which appears there 0 times. Nothing compares `init_all.sql`'s `\ir` list to `apply-janus-schema.mjs`'s `PHASE_FILES`.

**Invariant to establish.** *A test that cannot run fails loudly; a test file that exists is in a manifest; every manifest tag runs somewhere.*

**Desired implementation.**
1. Add a **PostgreSQL service container** to `.github/workflows/ci.yml` and apply the schema via `node worker/scripts/apply-janus-schema.mjs` (pass `DATABASE_URL_MIGRATIONS` in the env — do **not** let anything rewrite `worker/.dev.vars`).
2. Add a `typecheck` step running `npx tsc --noEmit` in both `worker/` and `web/`.
3. Make missing `DATABASE_URL` a **hard failure** in `grants_smoke.test.mjs`, `rls_fails_closed.test.mjs` and `ai_run_insert.test.mjs`, matching `view_rls.test.mjs:21-24`. Keep an explicit `--allow-skip` for local use, as `verify-sql-network.mjs:109-113` already does.
4. Add a manifest-completeness test: **fail the build when a `test-*` file on disk is absent from its manifest.** This eliminates the orphan class permanently. Then triage the 13 current orphans — add or delete each.
5. Give `janus/tests/` a runner and a manifest; wire it into CI.
6. Add `setup-java` (Temurin 21) to `promotion-gate.yml` and remove `continue-on-error: true` from the emulator legs.
7. Fix `web/scripts/run-tests.mjs:123` so a unit failure does not silently drop the e2e pass — report it explicitly.
8. Add **T9**: assert `init_all.sql`'s `\ir` list === `PHASE_FILES` === `readdirSync('janus/schema')` minus `init_all.sql`. Then apply migration 34 where missing and delete the orphan `19_history_tasks_feedback.sql` (byte-identical to `20_`, referenced by nothing).
9. Fix or delete `test-adr008-read-contract.mjs` — point its guard at `node-server.ts`, where `PERSISTENCE_READ_MODE` actually lives.
10. Add a **secret-scanning** job (see P1).
11. Fix the tautologies: `worker/scripts/test-manifest.mjs:250-254` (self-listing), `test-batched-hydration.ts`'s fixture assertion, `check('DELETE org_unit', true)` in `grants_smoke`, and `test-postcall-cache.mjs:86-90`'s `console.warn`-instead-of-assert.

**Must remain unchanged.** The `manual-only` and `live-api` exclusions are deliberate and documented — do not start running tests that hit live paid APIs. Two `live-api` files hardcode absolute paths under another developer's home directory (`test-disc-dos-donts-pipeline.ts:53-54`, `test-e2e-http-prep-donts.mjs:39`) and can never pass anywhere else; flag them for deletion, do not try to fix them.

**Tests to run.** The whole suite, in CI, and report the real pass/skip/fail counts — this prompt's deliverable is a trustworthy baseline.

**Acceptance criteria.** CI runs PostgreSQL; `tsc --noEmit` runs; no test can silently skip on missing `DATABASE_URL`; no orphan test files remain; T9 green; the promotion gate can actually fail.

**Non-goals.** Do not write the missing feature tests here — those belong to P2, P3, P7, P8, P9, P10, P12, P13, P14.
