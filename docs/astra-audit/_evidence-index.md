# Astra Forensic Audit — Evidence Index

Snapshot: `SE-Labs` @ `c58eac930f8676e73a8406b9909c87b3f179b21c` (branch `main`), `VERSION` 2.1.30, audited 2026-09-08.
Every finding in every other audit document cites these IDs.

Legend — **Finding type**: `CONFIRMED BUG` / `LIKELY BUG` / `ARCHITECTURAL RISK` / `EXPECTED` / `DEAD OR HISTORICAL PATH` / `REQUIRES RUNTIME EVIDENCE`.
**Evidence level**: `CODE-PROVEN` / `TEST-REPRODUCED` / `RUNTIME-VERIFIED` / `DOC-CLAIM ONLY` / `INFERENCE`.

---

## E — Code evidence

| ID | Claim | Location (file:symbol:line) | Level |
|---|---|---|---|
| E-001 | Repo HEAD is `c58eac93…`, NOT the prompt's `c58d78d3…`; `.git` IS present (prompt said absent) | `git rev-parse HEAD` | CODE-PROVEN |
| E-002 | `worker/wrangler.toml` has an **uncommitted** `compatibility_flags = ["nodejs_compat"]` — deployed CF config ≠ working tree | `git diff worker/wrangler.toml` | CODE-PROVEN |
| E-003 | Analyse button is disabled until `crmPreviewSurfacedOnce` is true — a CRM network lookup must have completed at least once | `web/postcall.js:computeAnalyzeButtonDisabled:697-715` | CODE-PROVEN |
| E-004 | `crmPreviewSurfacedOnce` is reset to `false` on every keystroke in the prospect-emails field | `web/postcall.js:5994-6009` (`resetCrmPreviewGate`), `:758` | CODE-PROVEN |
| E-005 | The repo documents that Crayons emits **both** `fwClick` and native `click` per gesture, and ships `bindActionOnce` to dedupe | `web/crayons-ui.js:bindActionOnce:215-235` | CODE-PROVEN |
| E-006 | `web/postcall.js` does NOT use `bindActionOnce`; it binds `fwInput`+`input` (and `fwBlur`+`blur`) pairs to the same handlers → each fires twice per gesture | `web/postcall.js:5950-6010` | CODE-PROVEN |
| E-007 | `#analyze-call` is `<fw-button type="submit">` inside `<form id="postcall-form">`, and BOTH the form `submit` and the button `fwClick` call `analyzeCall` | `web/index.html:652,772`; `web/postcall.js:5951-5952` | CODE-PROVEN |
| E-008 | `startPipeline`'s re-entry guard (`pass0Busy`) is set only AFTER two `await`s, so two events in the same tick both pass it | `web/postcall.js:startPipeline:5519-5535` | CODE-PROVEN |
| E-009 | Pass 0 is strictly serial: `postCallOwnerId` → `domainContextP` → `/postcall/resolve` → `enrichResolveDealsForAccount` → `resolvePipelineSeMotion` → `/postcall/classify` → confirmation gate | `web/postcall.js:startPipeline:5551-5620` | CODE-PROVEN |
| E-010 | Classification blocks the confirmation view (awaited before `showConfirmationGate`) | `web/postcall.js:5606-5632` | CODE-PROVEN |
| E-011 | Customer-contact creation runs as a **serial `for … await`** loop before any generation work starts | `web/postcall.js:confirmAndGenerate:4352-4372` | CODE-PROVEN |
| E-012 | `generateBody.videoFacts` is taken from pre-existing `pipelineState.videoFacts`, never from the current `videoP` | `web/postcall.js:4581` | CODE-PROVEN |
| E-013 | `/api/postcall/generate` returns ONLY `{...narrative, scorecard, videoFacts, confirmed, analysisMeta}` — no `summarise`, `qualification`, `technicalCommit`, `pass6`, `arrCompute`, `timeline` | `worker/src/postcall/generate.ts:269-287` | CODE-PROVEN |
| E-014 | `onAnalysisSaved(record, savePayload, data)` is invoked with that initial `data` **before** hydration starts | `web/postcall.js:4635-4642` | CODE-PROVEN |
| E-015 | `linkPostCallToLifecycle` is the ONLY writer of normalized child rows and reads them all off `data.*` (scorecard, videoFacts, timeline, followUps, objections, momDraft, qualification, technicalCommit, traction, arr, pass6, summaries, frameworks, identities) | `web/domain/dual-write.js:linkPostCallToLifecycle:172-505` | CODE-PROVEN |
| E-016 | `setOnCallRecordHydrated` only calls `scheduleCallRecordPanelRefresh` — hydrated data is **never** re-fed to `linkPostCallToLifecycle` or any domain write | `web/app.js:3118-3124`; `web/postcall.js:5030` | CODE-PROVEN |
| E-017 | Hydration persists exclusively through `updatePostCallAnalysis` → history; no domain-write, no normalized SQL | `web/postcall.js:runPostcallParallelHydration:4715-5035` | CODE-PROVEN |
| E-018 | `rollupDealTractionAfterPostCall` (Pass 8) is called inside `linkPostCallToLifecycle` with `qualification`/`summarise`/`technicalCommit` all `undefined`, and is never re-run | `web/domain/dual-write.js:395-407` + E-013 | CODE-PROVEN |
| E-019 | `regenerateSummariesAfterPostCall` (Pass 9 sync) runs in the same place with the same incomplete evidence | `web/domain/dual-write.js:441-447` + E-013 | CODE-PROVEN |
| E-020 | `updatePostCallAnalysis` is an unsynchronised read-modify-write; it POSTs the **whole record** and multiple such calls are launched concurrently (qualify ∥ summarise ∥ detached `videoP.then`) | `web/history.js:updatePostCallAnalysis:~505-530`; `web/postcall.js:4768-4808,4890-4905` | CODE-PROVEN |
| E-021 | Server-side `saveHistoryEntry` is load-whole-blob → mutate → put-whole-blob with **no lock, CAS, or transaction** | `worker/src/history.ts:saveHistoryEntry:74-89` | CODE-PROVEN |
| E-022 | The history record built by `savePostCallAnalysis` has **no `callIdentityKey` field** | `web/history.js:savePostCallAnalysis:~345-395` | CODE-PROVEN |
| E-023 | History SQL writer idempotency key = `call_${rec.callIdentityKey \|\| id}` → resolves to `call_<postCallId>` because of E-022 | `worker/src/routes.ts:tryHistoryPostCallSqlWrite:2976` | CODE-PROVEN |
| E-024 | Domain SQL writer idempotency key = `call_${postCall.callIdentityKey \|\| id}` → resolves to `call_zoom:<recordingId>` (or `call_title:…`) | `worker/src/routes.ts:2718,2729`; `web/domain/dual-write.js:233,265`; `web/call-identity.js:callIdentityKey:6-22` | CODE-PROVEN |
| E-025 | `activity.public_id` and `post_call.public_id` are **`text UNIQUE NOT NULL`**, while the upserts conflict-target only the *partial* unique index on `idempotency_key` | `janus/schema/02_phase2_activities.sql:11,31,88,90,99` | CODE-PROVEN |
| E-026 | `upsertReturningId` runs the INSERT with **no unique-violation handling** | `worker/src/data/persistence/id-registry.ts:74-94` | CODE-PROVEN |
| E-027 | `withSessionContext` wraps the whole domain write in ONE transaction: ROLLBACK + rethrow on any error | `worker/src/data/persistence/session-context.ts:327-355` | CODE-PROVEN |
| E-028 | `trySqlDomainWrite` has **no try/catch** around `withSessionContext`; the error escapes to the global handler → 500 "Internal error." | `worker/src/routes.ts:1918-2790`; `worker/src/index.ts:148-159` | CODE-PROVEN |
| E-029 | The browser swallows that 500: `console.warn("Lifecycle dual-write (post-call) failed:", err)` and continues to a normal-looking UI | `web/app.js:3229-3234` | CODE-PROVEN |
| E-030 | `upsertPostCall` `ON CONFLICT … DO UPDATE SET detail = EXCLUDED.detail, pipeline_state = EXCLUDED.pipeline_state` — a destructive whole-column replace | `worker/src/data/persistence/postgres-repository.ts:upsertPostCall:416-441` | CODE-PROVEN |
| E-031 | The history writer passes `detail: null` **explicitly** and `validateJsonbShape("post_call.detail", null)` | `worker/src/routes.ts:2996,2969` | CODE-PROVEN |
| E-032 | A safe, non-destructive alternative already exists in the same file: `UPDATE post_call SET analysis = COALESCE($2::jsonb, analysis), detail = COALESCE($3::jsonb, detail)` for `upsertPostCall`/`upsertCallSummary` | `worker/src/routes.ts:2400-2409` | CODE-PROVEN |
| E-033 | `pipeline_state` has exactly **two** writers, both hardcoding `'analysis_done'`. `detail_done`, `scoring_done`, `signals_done`, `failed` are never written by application code | `worker/src/routes.ts:2734,3000`; exhaustive grep of `worker/src`, `janus/`, `web/` for `pipeline_state`/`pipelineState` | CODE-PROVEN |
| E-034 | Consequence of E-033: `provisional` is derived as `pipeline_state !== 'signals_done' && !== 'scoring_done'` → **every** SQL-read call summary is permanently `provisional: true` | `worker/src/data/persistence/read-repository.ts:155` | CODE-PROVEN |
| E-035 | `POST /api/history` always returns 200; a failed `tryHistoryPostCallSqlWrite` only logs `[history][dual-write-DROPPED]` | `worker/src/routes.ts:handleHistoryPost:1390-1410` | CODE-PROVEN |
| E-036 | `tryHistoryPostCallSqlWrite` silently returns (no error, no fallback-log) when port/PG-not-ready, no uid, **no `accountId`**, no `analysis`, no SQL session, or no owner/org row | `worker/src/routes.ts:2921-2952` | CODE-PROVEN |
| E-037 | The `body.entries` bulk branch of `handleHistoryPost` returns **before** `tryHistoryPostCallSqlWrite` — bulk sync/recovery never projects to SQL | `worker/src/routes.ts:1382-1385` | CODE-PROVEN |
| E-038 | Idempotency-key **prefix mismatch**: writers store `'call_' + key`; readers compare the raw key → `findPostCallByIdentity` can never match a row this app wrote | write `routes.ts:2718,2729,2976`; read `read-repository.ts:140,757`, `web/domain/api-store.js:472-477` | CODE-PROVEN |
| E-039 | Consequence of E-038: `attachPostCall`'s re-analysis dedupe branch is unreachable on the SQL read path | `web/domain/lifecycle-service.js:attachPostCall:186-188` | CODE-PROVEN |
| E-040 | `post_call.detail` is never populated by the main flow: `postCallDraft` has no `detail` key, so the domain writer sends `detail = null` too | `web/domain/dual-write.js:255-272`; `worker/src/routes.ts:2682,2733` | CODE-PROVEN |
| E-041 | `/api/postcall/cache/prepare` never existed; the browser comment states the Gemini context-cache step is a permanent no-op (`cacheFields = {}`) | `web/postcall.js:4414-4422` | CODE-PROVEN |
| E-042 | Route table is an exact-match two-level object; no trailing-slash tolerance, no prefix match | `worker/src/routes.ts:routes:3298-3340`; `worker/src/index.ts:110-115` | CODE-PROVEN |
| E-043 | `/api/health`, `/api/health/live`, `/api/health/ready` handlers exist but `healthRoutes` is imported by **nothing** → all 404 | `worker/src/routes/health.ts:79,89,129,138`; negative proof: `grep -rn 'healthRoutes\|handleHealth' worker/src` returns only definitions | CODE-PROVEN |
| E-044 | `/api/read-models/schedule` is called by the browser but is **not registered** → 404; read-model scheduling never happens | caller `web/domain/read-models-service.js:76`; handler `worker/src/routes/read-models.ts:33`; absent from `routes.ts:3298-3340` | CODE-PROVEN |
| E-045 | `/api/internal/batch/enqueue` and `/api/internal/read-models/nightly-rebuild` are invoked by an **active** cron script but are not registered → 404 nightly | `deploy/vps/cron-batch.sh:37-38`; `worker/src/routes/internal-batch.ts:96,204`; absent from route map | CODE-PROVEN |
| E-046 | `POST /api/search/rag` has **no authentication of any kind** and spends embedding-API tokens | `worker/src/routes.ts:handleSearchRag:1414-1428` | CODE-PROVEN |
| E-047 | `GET /api/feedback?global=1` returns every user's feedback and short-circuits **before** any auth resolution | `worker/src/routes.ts:handleFeedbackGet:949-952` | CODE-PROVEN |
| E-048 | `POST /api/calls/:id/offload-payload` calls `authContext` but **never** `assertCanReadResource` — its GET sibling does → any authenticated user can overwrite any call's offloaded payload | `worker/src/routes/domain-reads.ts:133-151` vs `:153-170` | CODE-PROVEN |
| E-049 | `PERSISTENCE_MODE` defaults to `"sql"` on Node (`node-server.ts:101`) but is **unset** on Cloudflare; `resolvePersistenceMode` separately defaults to `"sql"` | `worker/src/node-server.ts:101`; `worker/src/data/persistence/types.ts:resolvePersistenceMode:34-42` | CODE-PROVEN |
| E-050 | `HISTORY_BACKEND`/`TASKS_BACKEND` are injected **only** in `node-server.ts` → every history/tasks/feedback/recovery route can 503 on Cloudflare | `worker/src/node-server.ts:161-176`; `worker/src/history.ts:resolveBackend:34-38` | CODE-PROVEN |
| E-051 | All four production boot guards (Firebase project, auth enforcement, PG SSL, wildcard CORS) exist only on the Node path | `worker/src/node-server.ts:110-158` | CODE-PROVEN |
| E-052 | `34_usage_and_leaderboard_views.sql` is in `init_all.sql:56` but absent from the hardcoded `PHASE_FILES` array, which ends at `33_user_usage.sql` | `janus/schema/init_all.sql:56`; `worker/scripts/apply-janus-schema.mjs:24-63` | CODE-PROVEN |
| E-053 | `19_history_tasks_feedback.sql` is byte-identical to `20_history_tasks_feedback.sql` and referenced by nothing (orphan from a renumbering) | `diff janus/schema/19_history_tasks_feedback.sql janus/schema/20_history_tasks_feedback.sql` | CODE-PROVEN |
| E-054 | No test anywhere compares `init_all.sql`'s `\ir` list to `PHASE_FILES`; `worker/scripts/test-schema-drift.ts` is about **Gemini output fields**, not SQL | `worker/scripts/test-schema-drift.ts:23-43`; `.github/workflows/ci.yml` has zero `schema`/`.sql`/`migration` matches | CODE-PROVEN |
| E-055 | The repo's own migration comment independently corroborates the P0: "`v_scorecard_rankable` has rows for exactly 2 calls … because `linkPostCallToLifecycle` (web/domain/dual-write.js) **has been failing silently for every user**" | `janus/schema/34_usage_and_leaderboard_views.sql:15-21` | DOC-CLAIM ONLY (corroborates E-023→E-029) |
| E-056 | `savePostCallHistory` (→ history SQL) is awaited **before** `onAnalysisSaved` (→ domain SQL), fixing the writer order in the existing-account flow | `web/postcall.js:4622-4642` | CODE-PROVEN |
| E-057 | New-account flow sends `accountId: undefined`, so the first history SQL write is skipped by E-036; the account id is only stamped onto history later by the dealId write-back | `web/postcall.js:4600-4607`; `web/app.js:3238-3252` | CODE-PROVEN |
| E-058 | `video-pass` is the only route with a genuine per-target fork: Node intercepts it before the router; Cloudflare cannot run ffmpeg | `worker/src/node-server.ts:228-273`; `worker/src/routes.ts:394` | CODE-PROVEN |
| E-059 | Every `routes/domain-reads.ts` and `routes/read-models.ts` route 503s on Cloudflare via an `isNodeRuntime()` guard | `worker/src/routes/domain-reads.ts:49-56`; `worker/src/routes/read-models.ts:24-31` | CODE-PROVEN |
| E-060 | `renderCrmMatchesPanel` replaces whole panels with `innerHTML` and re-wires them on every invocation | `web/postcall.js:1082-1200` | CODE-PROVEN |
| E-061 | `wireCallLinks` binds BOTH `click` and `fwClick` to the same handler with no per-event dedupe (only a re-wiring guard) → double call-open navigation | `web/crayons-ui.js:wireCallLinks:244-267` | CODE-PROVEN |
| E-062 | Hydration's gaps/timeline/deferred-commit steps read `pipelineState.resolve.transcript` from module memory — unrecoverable after reload | `web/postcall.js:4820,4864,4949,4996` | CODE-PROVEN |
| E-063 | `void runPostcallParallelHydration(...)` is detached and fired after `navigateToCallRecord`; there is no unload handler, no resume, no server-side job | `web/postcall.js:4655-4672` | CODE-PROVEN |
| E-064 | Video pass is called with a throwaway `callId: \`call_pending_${Date.now()}\`` — telemetry for the slowest LLM step cannot be attributed to the final call | `web/postcall.js:4520` | CODE-PROVEN |


## E — Code evidence (continued): render lifecycle, LLM pipeline, Zoom

| ID | Claim | Location (file:symbol:line) | Level |
|---|---|---|---|
| E-065 | `buildSubscribeRemoteCallDetail` returns an **`async` arrow**, so the value stored in `container._callDetailUnsub` is a **Promise, never a function** — and both teardown sites test `typeof === "function"`, so the unsubscribe is never invoked | `web/app.js:811-819`; teardowns `web/call-view.js:3378-3381`, `web/app.js:922-930` | CODE-PROVEN |
| E-066 | `resolveReadMode` returns `"api"` for every host and role by default; `fbReadyResolve` is only called when `readMode === "firestore"`, so `await fbReadyPromise` never returns in the default mode and the realtime call-detail subscription never attaches | `web/domain/store.js:resolveReadMode:68`, `initDomainStore:265-268`; consumer `web/app.js:814` | CODE-PROVEN |
| E-067 | `setCallRecordProgress(recordId, "")` — the call that clears the inline progress banner when hydration completes — is a **no-op** because of the `!message` early return | guard `web/postcall.js:3147`; the dead call `web/postcall.js:5029` | CODE-PROVEN |
| E-068 | `scheduleCallRecordPanelRefresh` has four early-return branches that set `callRecordRefreshTargetId` and return **without arming a timer**; nothing else reads that variable, so those refresh requests are dropped permanently | `web/app.js:1636-1674` | CODE-PROVEN |
| E-069 | `callRecordRefreshTimer` is a single module global, so `clearTimeout` in one call cancels a pending refresh for a **different** call id | `web/app.js:226,1660` | CODE-PROVEN |
| E-070 | One cold saved-call open performs **six** full `innerHTML` replacements of `#call-panel` (2 loading shells, 1 more shell, local paint, technical-commit paint, enriched paint), each discarding scroll, open `<details>`, tab state and restarting KPI animations | `web/app.js:1709`; `web/call-view.js:3399,3442,3450,3502,3525`; `paintCallRecord:3342-3350` | CODE-PROVEN |
| E-071 | `safeEnrich` has no token, no generation, no `AbortSignal` and no timeout; it swallows every failure into `null`/`[]`, making a failed read indistinguishable from genuine absence | `web/call-view.js:safeEnrich:2688-2700` | CODE-PROVEN |
| E-072 | `loadCallBundle`'s enrichment is 18 `safeEnrich` sites wrapping ~22 store operations behind **8 sequential await barriers**; only three groups are parallel | `web/call-view.js:2742-3011` | CODE-PROVEN |
| E-073 | `resolveMergedTechnicalCommit` is invoked **three times** per open with identical arguments (once in `loadCallBundle`, once as the first-load TC enrich, once per realtime snapshot) | `web/call-view.js:713,723,3494,3513` | CODE-PROVEN |
| E-074 | `getPostCallAnalysis`/`listPostCallAnalyses` re-parse and re-sort the **entire** localStorage history array on every call, and are called ≥12 times per saved-call open | `web/history.js:readAll:79-93`, `listPostCallAnalyses:412-421`; callers `web/call-view.js:614,693,1077,1086,3025,3398,3426,3516` | CODE-PROVEN |
| E-075 | Seven independent deciders compute call-view loading/empty/error state, and `pending` is derived three separate times from three separate record reads | `web/app.js:1707-1717,1636-1657`; `web/call-view.js:3386-3393,3432-3435,595-608,633-664`, plus per-section predicates | CODE-PROVEN |
| E-076 | `showPostCallPipeline` decides its own visibility by **reading another panel's DOM `hidden` attribute** — the clearest symptom of the missing state machine | `web/postcall.js:3185-3190` | CODE-PROVEN |
| E-077 | `#postcall-loading` is never shown by any code path — only ever hidden, at six separate sites | `web/postcall.js:2957,4048,4685,5196,5348,5540`; declared `web/index.html:781` | CODE-PROVEN |
| E-078 | `#call-mom-save` is an `<fw-button>` with BOTH `fwClick` and native `click` bound to the same handler and no `bindActionOnce` → one click issues **two** `POST /api/history` read-modify-writes | `web/call-view.js:2592,3286-3287`; the available fix `web/crayons-ui.js:bindActionOnce:221-236` | CODE-PROVEN |
| E-079 | `bindActionOnce` is used at only **3 sites** repo-wide against 99 `addEventListener("fw…"` registrations | `web/postcall.js:4052-4053`, `web/app.js:2741` | CODE-PROVEN |
| E-080 | `wireCallRecordBack`'s idempotence guard writes `dataset.wiredBack` on a node that every repaint recreates, so the guard never trips | `web/call-view.js:3189-3196` | CODE-PROVEN |
| E-081 | `mergeHistoryLists(local, remote)` resolves collisions by **argument order** (remote last wins) with no `updatedAt` comparison; the `.sort()` only orders the list | `web/history.js:mergeHistoryLists:134-144`, called `:302` | CODE-PROVEN |
| E-082 | Local-vs-remote precedence is **inverted** between the awaited path (local wins) and the realtime path, which rebuilds from the pre-hydration `resolvedRecord` snapshot | local-wins `web/domain/se-access-service.js:78-81`, `web/call-view.js:3424-3429,3024-3032`; remote-over-stale `web/call-view.js:3459-3465` | CODE-PROVEN |
| E-083 | Nine call-view empty states assert absence without consulting `pending`, and render on the local-bundle paint **before** any store read has been issued | `web/call-view.js:2303,2384,2540,2117,1922,2617,1765,1791`; `web/domain/se-access-service.js:82-97` | CODE-PROVEN |
| E-084 | `renderTechnicalCommitTab` and several sibling tabs never receive `pending`/`errors`, and tell the user to "re-run post-call analysis" for a pipeline that already succeeded | `web/call-view.js:2303-2308`, call site `:2628` | CODE-PROVEN |
| E-085 | Telemetry choke point is `wrapWithUsageRecording`; HTTP choke point is `fetchGemini`. Four families of call bypass the HTTP choke point entirely | `worker/src/providers/index.ts:46`; `worker/src/providers/gemini.ts:370`; bypasses `video/transcript-infer.ts:341,464`, `embeddings.ts:58`, `providers/gemini-batch.ts:79`, `providers/gemini-cache.ts:100,134,162` | CODE-PROVEN |
| E-086 | `runPostCallSummarise` makes **three** parallel provider calls (MoM draft is its own call), not one | `worker/src/postcall/summarise.ts:453-478` via `generateJson:422` | CODE-PROVEN |
| E-087 | `runPostCallScorecard` makes exactly **one** provider call — there is no per-theme or per-parameter loop | `worker/src/postcall/scorecard.ts:runPostCallScorecard:905` | CODE-PROVEN |
| E-088 | The vision pass batches **all sampled frames into one request**, capped at 10 | `worker/src/video/vision.ts:callGeminiJson:111`, `buildImageParts:78`; cap `video/facts.ts:10` | CODE-PROVEN |
| E-089 | `timeline.ts` is fully deterministic — no provider import, no fetch | `worker/src/postcall/timeline.ts:13` + absence of any provider import | CODE-PROVEN |
| E-090 | One normal post-call issues **15–18 `generateContent` calls plus up to 12 `embedContent` calls** (~27–30 provider HTTP invocations): 6–7 on the user-visible critical path, 9–11 in background hydration | aggregated from `generate.ts:141-236`, `web/postcall.js:4438-4540,4821+`, `gaps.ts:370` | CODE-PROVEN |
| E-091 | `effort` is **inert on the default Gemini path**: `buildRequestBody` never reads `req.effort`, and any Gemini-3 model is pinned to `thinkingLevel: "minimal"`. `POSTCALL_EFFORT` therefore changes nothing | `worker/src/providers/gemini.ts:buildRequestBody:214-244`, `buildThinkingConfig:172-187`; honoured only by `anthropic.ts:40` | CODE-PROVEN |
| E-092 | `ai_run` has **no `call_id` column** — only `activity_id bigint REFERENCES activity(id)`. The `callId` string is resolved to an internal id at write time and otherwise discarded | `janus/schema/03_phase3_ai_pipeline.sql:59-77`; `worker/src/data/persistence/ai-run.ts:resolveActivityId:119-132`, insert `:204-226` | CODE-PROVEN |
| E-093 | `ai_run` is append-only (`REVOKE UPDATE, DELETE … FROM janus_app`), so a row written with `activity_id = NULL` can never be backfilled | `janus/schema/16_ai_run_telemetry.sql:36` | CODE-PROVEN |
| E-094 | **No post-call route injects the authenticated identity.** `requireUser`'s return value is discarded at every post-call handler; `userId` and `callId` are entirely client-supplied body fields | `worker/src/routes.ts:525,557,578,619,641,663,705,727,808` | CODE-PROVEN |
| E-095 | The critical-path passes send **no `callId` at all** (`generateBody`, `qualifyBody`, `summariseBody`, gaps body have no such key), so their `ai_run` rows land with `activity_id = NULL` | `web/postcall.js:4542-4582,4426-4436,4821-4832` | CODE-PROVEN |
| E-096 | `summaries.ts` is **structurally unattributable**: `PostCallSummariesInput` has no `userId`/`callId` field, and `generateSummaryJson` passes neither | `worker/src/postcall/summaries.ts:54-57,195-204` | CODE-PROVEN |
| E-097 | `insertAiRun` is fire-and-forget (`void aiRunRepository.insert(...)`) and resolves the activity at write time, so it can lose the race against the client-driven creation of `act_<id>` | `worker/src/data/llm-usage.ts:61` | CODE-PROVEN |
| E-098 | The daily token budget is a **no-op whenever `userId` is absent**, and `transcript-infer.ts` / `embeddings.ts` / `gemini-batch.ts` never call `reserveDailyTokenBudget` at all | `worker/src/data/token-budget.ts:74-76`; only reservers are `providers/index.ts:49`, `video/vision.ts:109` | CODE-PROVEN |
| E-099 | Three provider calls on the live post-call path have **no timeout, no AbortController and no retry**: the two `transcript-infer` calls and `embedVerbatim` (up to 12 concurrent) | `worker/src/video/transcript-infer.ts:341,464`; `worker/src/embeddings.ts:58`; negative proof: no `AbortController`/`signal` token in either file | CODE-PROVEN |
| E-100 | `POSTCALL_PASS_NAMES` omits `scorecard-verify`, `scorecard-calibrate`, `deck-validate`, `speaker-attribution`, `linkedin-identity`, so they silently get the 45 s `extraction` budget despite sitting on the critical path with 8000 maxTokens | `worker/src/providers/gemini-retry.ts:10-20,22-34,40-50` | CODE-PROVEN |
| E-101 | Application-level retries produce **extra `ai_run` rows** tagged with the same `pass_name`, distinguishable only by `error_code`/`retry_count`; provider-level HTTP retries do not, and undercount tokens for retried attempts | retries `scorecard-verify.ts:530`, `scorecard-calibrate.ts:315`, `commit.ts:411,429`, `gaps.ts:410`, `providers/index.ts:73`; HTTP retry `gemini-retry.ts:127-160` folds into one row via `gemini.ts:312` | CODE-PROVEN |
| E-102 | Zoom acquisition is **pull-only, synchronous, single-attempt**. There is no `scheduled()` handler, no webhook receiver, no cron discovery, and no transcript-readiness polling | negative proof: `grep -n 'scheduled' worker/src/index.ts` → no match; route map `routes.ts:3298-3340` contains no Zoom webhook path | CODE-PROVEN |
| E-103 | The working Zoom connector is Server-to-Server OAuth (`account_credentials`), matching `/v2/accounts/me/recordings` by the share link's `?startTime=` within ±5 min over a ±1-day window | `worker/src/zoom-api.ts:getZoomApiToken:41-95`, `findRecordingByStartTime:165-200`, `extractShareStartTimeMs:118-138`, constants `:17-18` | CODE-PROVEN |
| E-104 | A share link **without `?startTime=`** cannot be resolved through the API at all — the share id is never sent to Zoom; the epoch-ms is the sole join key | `worker/src/zoom-api.ts:280-288` | CODE-PROVEN |
| E-105 | The user-OAuth path is scaffolding: an authorize URL exists but there is **no callback route**, no code exchange, no token storage, and `fetchMeetingTranscript`/`listPastMeetings` are never called | `worker/src/zoom.ts:26-28`; `routes.ts:188-197` (`/api/zoom/auth`); negative proof: no `/api/zoom/callback` in the route map | CODE-PROVEN |
| E-106 | `/api/config` and `/api/zoom/status` report `zoomConfigured` (the **dead** user-OAuth triple) rather than `zoomApiConfigured` (the working S2S triple), so the UI can show Zoom as configured while fetch is impossible, and vice versa | `worker/src/routes.ts:78,122,153`; predicates `worker/src/zoom.ts:16-18,21-23` | CODE-PROVEN |
| E-107 | A **still-processing** transcript has no branch: `completedFiles` filters it out and the user is told the recording "has no transcript", with no retry affordance | `worker/src/zoom-api.ts:completedFiles:212-216`, message `:304-310` | CODE-PROVEN |
| E-108 | There is **no speech-to-text anywhere**. `worker/src/video/` runs ffmpeg with `-vf fps=…,scale=640:-2 -q:v 5` to JPEG only; no `-vn`, no audio codec, no `.wav`/`.mp3`/`.m4a` path | `worker/src/video/ffmpeg.ts:134-176,239-274`; negative proof: repo-wide grep for whisper/STT/deepgram/assemblyai and for `-vn\|acodec\|ar 16000` → 0 relevant hits | CODE-PROVEN |
| E-109 | `VideoFactsDraft` has **no transcript/utterance/dialogue field**; the closest datum is an aggregate `talkPct` per attendee, and a transcript-derived spine is explicitly marked display-only | `worker/src/domain-model/video-facts.ts:74-120`, note `:15-16` | CODE-PROVEN |
| E-110 | Zoom's `?pwd=` is the only URL-borne unlock secret; the `.token` path suffix is deliberately excluded (it triggers CAPTCHA) and the extracted `pathToken` is never consumed by production code | `worker/src/zoomShare.ts:extractZoomEmbeddedPasscode:160-189`; negative proof: `grep -rn pathToken` → definition plus one test assertion only | CODE-PROVEN |
| E-111 | CAPTCHA is detected in two places and never solved or bypassed; the account API exists specifically because share-link scraping cannot pass it | `worker/src/zoomShare.ts:404,379-393`, message `:21-24`; rationale `worker/src/zoom-api.ts:3-6` | CODE-PROVEN |
| E-112 | Five committed files contain a real Freshworks Zoom cloud-recording share URL **and its plaintext recording passcode** as top-level constants; they are dead code, in no manifest, and unreferenced | `worker/scripts/debug-zoom.mjs:2-4`, `debug-zoom2.mjs:1-3`, `debug-zoom3.mjs:1-3`, `debug-zoom4.mjs:4-6`, `debug-zoom5.mjs:1-3` (values deliberately not reproduced in this audit) | CODE-PROVEN |
| E-113 | `worker/zoom-app.js` is 82,638 bytes of vendored minified Zoom web-player output with **zero** references from `worker/src`, `worker/scripts`, `package.json` or `wrangler.toml` | negative proof: `grep -rn 'zoom-app' worker/src worker/scripts worker/package.json worker/wrangler.toml` → no match | CODE-PROVEN |
| E-114 | `worker/src/postcall.ts` is a dead duplicate of `postcall/analyze.ts` — nothing imports `"./postcall"`; the copy lacks the `temperature: 0` determinism pin and passes no `userId`/`callId` | `worker/src/postcall.ts:130-162` vs `worker/src/postcall/analyze.ts:144,167,179`; `postcall/index.ts:11` re-exports from `./analyze` | CODE-PROVEN |
| E-115 | `isFirestoreStoreReady()` tests `fbReadyResolve` **twice** and returns true when the store is *not* ready. It has zero callers (dead code) | `web/domain/store.js:283-285`; negative proof: `grep -rn isFirestoreStoreReady web/` → definition only | CODE-PROVEN |
| E-116 | `deploy/vps/docker-compose.yml` pins `PERSISTENCE_MODE: "${PERSISTENCE_MODE:-firestore}"`, so the shipped VPS default attempts **no SQL write at all** (`resolvePersistencePort` returns `null` in firestore mode) | `deploy/vps/docker-compose.yml:28`; `worker/src/data/persistence/dual-write-repository.ts:353-360` | CODE-PROVEN |
| E-117 | `postgresReady()` returns `false` unconditionally when not running on Node, so **PostgreSQL persistence is structurally impossible on Cloudflare Workers** | `worker/src/data/persistence/postgres-pool.ts:28-32` | CODE-PROVEN |
| E-118 | `PERSISTENCE_MODE` is read three ways with three defaults in one request: `resolvePersistenceMode` → `"sql"` (used only by the fallback logger), `resolvePersistencePort` → `"sql"`, `handleDomainWrite` → `""`. The 501 "mode guard" is therefore inert unless an operator sets the variable explicitly | `types.ts:34-42`; `dual-write-repository.ts:357`; `routes.ts:1652,1684-1699`; sole canonical caller `fallback-log.ts:80` | CODE-PROVEN |
| E-119 | `/api/config` reports nothing about `PERSISTENCE_MODE`, `PERSISTENCE_READ_MODE` or `postgresReady`, so SQL-only mode is **not observable from the browser** | `worker/src/routes.ts:handleConfig:125-186` | CODE-PROVEN |
| E-120 | `janus/tests/ai_run_insert.harness.ts` uses top-level `await` in a `.ts` file that `tsx` resolves as CJS, so it fails to load and `insertAiRun` has no working test | `janus/tests/ai_run_insert.harness.ts:12,28`; observed at runtime, see `R-007` | RUNTIME-VERIFIED |
| E-121 | The persistence barrel re-exports only the **deprecated** alias `withSystemContext`, so the M3 rename to `withUnrestrictedSystemContext` never reached the public surface and no call site makes the RLS bypass explicit | `worker/src/data/persistence/index.ts:10` vs `session-context.ts:362-383` | RUNTIME-VERIFIED |
| E-122 | `web/scripts/test-adr008-read-contract.mjs` is permanently dead: its guard greps `worker/src/routes.ts` for `PERSISTENCE_READ_MODE`, which appears there **0 times**, so it exits 0 before its three assertions | `web/scripts/test-adr008-read-contract.mjs:9-12`; `grep -c PERSISTENCE_READ_MODE worker/src/routes.ts` → 0 | CODE-PROVEN |
| E-123 | 13 test files exist on disk in no manifest; 5 of the 8 worker orphans are the entire ADR-008 / Postgres persistence lane, including `test-postcall-update-idempotency-conflict.ts` | reconciliation of `web/scripts/test-manifest.mjs` + `worker/scripts/test-manifest.mjs` against `find` | CODE-PROVEN |
| E-124 | `test-postcall-update-idempotency-conflict.ts`'s "same public ID, different idempotency keys" case applies the divergent keys **only to `activity`** — `postCallIdempotencyKey` is identical in both `upsertPostCall` calls, so the production F-001 scenario is not covered | `worker/scripts/test-postcall-update-idempotency-conflict.ts:178-257` (esp. `:193,232`) | CODE-PROVEN |
| E-125 | `web/scripts/run-tests.mjs` silently drops all 14 shared-e2e tests whenever any unit test fails — no message, and the final `N/M passed` line shows a shrunken denominator | `web/scripts/run-tests.mjs:123` | CODE-PROVEN |
| E-126 | `tsc --noEmit` is reachable only inside `test:sql-gates`, which no workflow calls — **TypeScript is never type-checked in CI**. Thirteen npm test scripts have zero workflow references | `worker/package.json` scripts vs `.github/workflows/*.yml` | CODE-PROVEN |
| E-127 | Three `janus/tests` gates (`grants_smoke`, `rls_fails_closed`, `ai_run_insert`) silently `return` and exit 0 when `DATABASE_URL` is unset; only `view_rls.test.mjs:21-24` hard-fails | `grants_smoke.test.mjs:44-47`, `rls_fails_closed.test.mjs:44-47`, `ai_run_insert.test.mjs:51-54` | CODE-PROVEN |
| E-128 | `promotion-gate.yml` runs `firebase emulators:exec` and `npm run test:rules` with **no `setup-java` step**, which `ci.yml:19-23` documents as required (JDK 21) | `.github/workflows/promotion-gate.yml:50-56` vs `.github/workflows/ci.yml:19-23,53-58` | CODE-PROVEN |
| E-129 | `test-batched-hydration.ts`'s CI-visible assertion is near-tautological — both "serial" and "batched" paths feed identical in-memory fixtures to the same function and perform no reads | `worker/scripts/test-batched-hydration.ts:125-176` | CODE-PROVEN |
| E-130 | Two `live-api` tests hardcode absolute paths under another developer's home directory and can never pass on any other machine | `worker/scripts/test-disc-dos-donts-pipeline.ts:53-54`; `worker/scripts/test-e2e-http-prep-donts.mjs:39` | CODE-PROVEN |

## F — Findings (continued)

| ID | Priority | Title | Hypothesis | Evidence |
|---|---|---|---|---|
| F-023 | **P1** | `ai_run` telemetry is ~0% attributable to a user-visible post-call, and its only test cannot run | H16 | E-092→E-097, E-120, R-007 |
| F-024 | P3 | Persistence barrel re-exports only the deprecated `withSystemContext` alias | Phase 10 | E-121, R-008 |
| F-025 | **P0** | Five committed files expose a real Zoom recording share URL and its plaintext passcode | Phase 10 | E-112 |
| F-026 | **P1** | Zoom transcript acquisition has no durable ingestion boundary: no webhook, no scheduled discovery, no readiness polling, single attempt | H19, H21 | E-102→E-107 |
| F-027 | **P1** | Three provider calls on the live post-call path have no timeout and no retry; five passes are silently misclassified into the 45 s budget | H19, Phase 10 | E-099, E-100 |
| F-028 | **P1** | The daily token budget is bypassed by essentially the whole post-call pipeline | Phase 8 | E-098, E-094 |
| F-029 | **P2** | Saved-call view: six full `innerHTML` repaints, 8 serial barriers, ≥12 history parses, one duplicated query, ≥10 network requests per open | H20 | E-070→E-074 |
| F-030 | **P2** | Seven competing state deciders; `pending` derived three times; one decider reads the DOM to decide its own state | H20 | E-075, E-076, E-077 |
| F-031 | **P2** | Realtime call-detail subscription never unsubscribes (Promise vs function) and never attaches in the default read mode | H20 | E-065, E-066 |
| F-032 | **P2** | Nine empty states assert absence before any authoritative read, and a failed read is indistinguishable from empty | H20, H15 | E-071, E-083, E-084 |
| F-033 | **P2** | Local-vs-remote precedence is inverted between the awaited and realtime paths; `mergeHistoryLists` is age-blind | H8, H20 | E-081, E-082 |
| F-034 | **P2** | `#call-mom-save` issues two `POST /api/history` read-modify-writes per click | H20 | E-078, E-079 |
| F-035 | **P2** | Hydration-complete progress clear is a no-op; four refresh-request branches are dropped permanently; one global timer cancels other calls' refreshes | H20 | E-067, E-068, E-069 |
| F-036 | P3 | `effort` is inert on the default Gemini path — `POSTCALL_EFFORT` has no effect | Phase 9 | E-091 |
| F-037 | P3 | Dead code: `worker/src/postcall.ts`, `worker/zoom-app.js`, `isFirestoreStoreReady`, `#postcall-loading`, `19_history_tasks_feedback.sql` | Phase 10 | E-114, E-113, E-115, E-077, E-053 |
| F-038 | **P1** | CI runs no PostgreSQL, never type-checks, and three SQL gates exit 0 on missing `DATABASE_URL`; the promotion gate lacks the JDK its emulator legs need | Phase 11 | E-126, E-127, E-128, E-122, E-123 |
| F-039 | **P2** | `/api/config` cannot report persistence mode, and reports the wrong Zoom predicate | H12, H15 | E-119, E-106 |

## R — Runtime observations (continued)

| ID | Observation | Status |
|---|---|---|
| R-003 | Migration 34 absent after running the only automated installer against an empty DB | RUNTIME-VERIFIED |
| R-004 | F-001 reproduced: `23505` on `post_call_public_id_key` | TEST-REPRODUCED |
| R-005 | F-005 reproduced: one history patch erases `detail`, `transcript_ref`, `detail_shape_version` and regresses `pipeline_state` | TEST-REPRODUCED |
| R-006 | `grants_smoke` 18/18, `rls_fails_closed` 8/8, `view_rls` 4/4 — the RLS/grants layer genuinely works | RUNTIME-VERIFIED |
| R-007 | `ai_run_insert` fails: harness cannot load (top-level await under CJS) | RUNTIME-VERIFIED |
| R-008 | `withUnrestrictedSystemContext` is not importable from the persistence barrel | RUNTIME-VERIFIED |

## F — Findings (see `06-bugs-and-risks.md` for full detail)

| ID | Priority | Title | Hypothesis | Evidence |
|---|---|---|---|---|
| F-001 | **P0** | Dual-writer idempotency-key collision aborts the entire post-call domain write | H2 | E-022→E-029, E-055, E-056 |
| F-002 | **P0** | Every hydrated post-call artifact is absent from relational SQL | H4 | E-013→E-017, F-001 |
| F-003 | **P0** | Pass 8 (deal traction) and Pass 9 (deal/account summaries) compute from empty current-call evidence | H5, H6 | E-013, E-018, E-019 |
| F-004 | **P0** | `POST /api/calls/:id/offload-payload` is an unauthorised cross-tenant write (IDOR) | Phase 10 | E-048 |
| F-005 | **P1** | Destructive `detail = EXCLUDED.detail` UPSERT — latent erasure, currently masked by F-001 | H1 | E-030, E-031, E-032, E-040 |
| F-006 | **P1** | `pipeline_state` never advances past `analysis_done`; 4 of 6 enum values are dead; all SQL reads are permanently `provisional` | H3 | E-033, E-034 |
| F-007 | **P1** | Concurrent history patches lose updates at the server (whole-blob read-modify-write, no lock) | H9 | E-020, E-021 |
| F-008 | **P1** | Browser is the only post-call job runner; a reload strands the pipeline permanently | H10 | E-062, E-063, E-017 |
| F-009 | **P1** | Pass 3 (QIP scorecard) never sees the current call's video facts, and is never rescored after they arrive | H7 | E-012, E-013 |
| F-010 | **P1** | `GET /api/feedback?global=1` leaks all users' feedback unauthenticated | Phase 10 | E-047 |
| F-011 | **P1** | `POST /api/search/rag` is unauthenticated and bills embedding tokens | Phase 10 | E-046 |
| F-012 | **P1** | Health endpoints 404 → Cloud Run/VPS probes cannot work | Phase 10 | E-043 |
| F-013 | **P1** | Nightly batch + read-model rebuild crons hit unregistered routes (404); Pass 9 batch path is dead | H6, Phase 10 | E-045, E-044 |
| F-014 | **P1** | Bulk history sync/recovery bypasses SQL projection entirely | H11 | E-037 |
| F-015 | **P1** | Idempotency-key prefix mismatch makes re-analysis dedupe unreachable | H2 | E-038, E-039 |
| F-016 | **P2** | Post-call intake requires a network CRM round-trip before the Analyse button can ever enable, and resets on every keystroke | H17 | E-003, E-004, E-060 |
| F-017 | **P2** | Every intake input handler and the submit path are double-bound (`fw*` + native) | H17, H20 | E-005, E-006, E-007, E-008, E-061 |
| F-018 | **P2** | Pass 0 is fully serial and classification blocks the confirmation gate | H18 | E-009, E-010, E-011 |
| F-019 | **P2** | Cloudflare and Node targets diverge in persistence default, history backend, boot guards, CORS, and ~15 routes | H12 | E-049→E-051, E-058, E-059, E-002 |
| F-020 | **P2** | Migration 34 is applied by no automated path; three hand-maintained schema lists have diverged; no drift test exists | H13 | E-052, E-053, E-054 |
| F-021 | **P3** | Dead Gemini context-cache step retained as a permanent no-op | H18 | E-041 |
| F-022 | **P2** | LLM telemetry for the video pass is attributed to a throwaway `call_pending_*` id | H16 | E-064 |

## R — Runtime observations

| ID | Observation | Status |
|---|---|---|
| R-001 | No database was classified or contacted during this audit. No SQL was executed. | BLOCKED — see `05-runtime-sql-verification.md` |
| R-002 | No live Zoom, Gemini, Anthropic, Freshdesk, email, or enrichment API was called. | BLOCKED by scope (cost authorisation not given) |
