# 03 — POST-CALL WRITE LEDGER

**Snapshot:** `SE-Labs` @ `c58eac93`, `VERSION` 2.1.30, 2026-09-08.
**Related:** [02-postcall-dag](02-postcall-dag.md) · [04-sql-persistence-map](04-sql-persistence-map.md) · [05-runtime-sql-verification](05-runtime-sql-verification.md) · [06-bugs-and-risks](06-bugs-and-risks.md)

Traced from the Confirm click to the last possible write, through every proxy layer. Order is relative wall-clock order for the **existing-account** scenario.

---

## 1. The ledger

`Await?` = did the browser await it. `2xx after failure?` = can the user see success while this write failed.

| # | t | Writer (caller → callee) | Transport | Statement | Object IDs | Idempotency key / conflict target | Fields sent | Fields omitted | Txn | RLS | Await? | Failure surfaced? | 2xx after failure? | Can a later write erase it? | Actual destination |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| W1 | t0 | `confirmAndGenerate` → `ensureCustomerContact` → `store.createContact`/`updateContact` → `api-store.js` → `POST /api/domain-write` → `trySqlDomainWrite` → `port.upsertContact` | HTTP | `INSERT … ON CONFLICT (public_id) DO UPDATE` | `cnt_*` | `public_id` | name, email, title | role, framework | one per contact | `withSessionContext` | **yes, serially — blocks the whole pipeline** | no — `try/catch` warn per contact | **yes** | yes, by later `updateContact` | `contact` ✅ |
| W2 | t1 | `savePostCallAnalysis` → `writeAll` | — | `localStorage.setItem` | `pc_*` | none | whole record | `detail`, `callIdentityKey` | none | none | yes | verified by read-back; on failure → `sessionStorage` stash | n/a | **yes** — 100-record cap and 4 MB trim drop the oldest | `localStorage se-singha-history:<email>` |
| W3 | t1 | `savePostCallAnalysis` → `pushRemoteEntry` → `POST /api/history` → `saveHistoryEntry` | HTTP | load-whole-blob → `unshift` → **put-whole-blob** | `pc_*` | none — **no CAS, no lock** | whole record | `detail` | **none** | n/a | yes | `try/catch` warn, local copy kept | **yes** | **yes — concurrent PUT lost update** `E-021` | KV / flat file / Firestore / `user_kv` |
| **W4** | t1+ | `handleHistoryPost` → `tryHistoryPostCallSqlWrite` → `port.upsertActivity` | in-process | CTE: resolve on `public_id OR idempotency_key` → UPDATE, else INSERT | `act_pc_*` | `call_<pc_id>` / prefers `public_id` | dealRef, account, owner, org, `activity_type='call'`, subject, `occurred_at` | description, duration, external_ref | **one txn with W5** | `app.user_id` etc. | no — best-effort | **no** | **yes** `E-035` | UPDATE never rewrites `idempotency_key`, so the **first** writer's key sticks forever | `activity` ✅ |
| **W5** | t1+ | …→ `port.upsertPostCall` | in-process | `INSERT … ON CONFLICT (idempotency_key) WHERE NOT NULL DO UPDATE SET … detail = EXCLUDED.detail, pipeline_state = EXCLUDED.pipeline_state` | `pc_*` | **`call_<pc_id>`** (because the record has no `callIdentityKey`, `E-022`) / target `idempotency_key` | `analysis`, `pipeline_state='analysis_done'`, shape versions, `se_motion` | **`detail: null` explicitly** `E-031`; `transcript_ref` usually null | same txn | yes | no | **no** | **yes** | **yes — destructively.** `R-005` proves one patch nulls `detail`, `transcript_ref`, rolls back `detail_shape_version`, regresses `pipeline_state` | `post_call` ✅ but hollow |
| W6 | t2 | `onAnalysisSaved` → `linkPostCallToLifecycle` → `resolveEngagementEntities` → account + contacts | HTTP → SQL | `upsertAccount` (slug-aware), `upsertContact` | `acc_*`, `cnt_*` | `public_id`, slug dedupe | name, domain, industry | — | per call | yes | yes | **no** — `console.warn` only `E-029` | **yes** | yes | `account`, `contact` ✅ |
| W7 | t2 | → `getOrCreateLifecycle` → deal | HTTP → SQL | `upsertDeal` / `applyLifecycleEvent` | `dl_*` | `public_id` | title, stage, account, owner | — | per call | yes | yes | no | **yes** | yes | `deal`, `lifecycle_event` ✅ |
| **W8** | t2 | → `attachPostCall` → `store.upsertPostCallWithSummary` → `POST /api/domain-write` → `trySqlDomainWrite` case `upsertPostCallWithSummary` → `port.upsertActivity` then `port.upsertPostCall` | HTTP → SQL | same two statements as W4/W5 | **same `pc_*` and `act_pc_*` as W4/W5** | **`call_zoom:<recordingId>`** — *different from W5* `E-024` | analysis, `detail` (usually null, `E-040`), `pipeline_state='analysis_done'`, `se_motion` | — | **one txn covering W8–W20** | yes | yes | **NO** | **yes** | — | ❌ **`23505` on `post_call_public_id_key` → ROLLBACK → HTTP 500 → `console.warn`.** `R-004` |
| W9–W20 | t2 | everything sequenced after `attachPostCall`: `replaceCallParticipants`, `persistScorecardDraft`, `persistVideoFactsDraft`, `persistCallTimelineDraft`, `persistFollowUpsDraft`, `persistObjectionsDraft`, `persistMomDraft`, `applyQualificationToDeal`, `applyTechnicalCommitToDeal`, **`rollupDealTractionAfterPostCall` (Pass 8)**, `persistArrAfterPostCall`, `persistPass6ProductGaps`, `maybeRunGapClusteringAfterPass6`, **`regenerateSummariesAfterPostCall` (Pass 9)**, `applyPostCallContactFrameworks`, `linkContactsToDeal`, `stampCallIdentities` | — | — | — | — | — | — | — | — | — | — | — | ❌ **NEVER EXECUTE.** W8 threw. And even without W8, `data.summarise` / `data.qualification` / `data.technicalCommit` / `data.arrCompute` / `data.pass6` / `data.timeline` are all `undefined` at this point (`E-013`), so most would have been no-ops anyway | ❌ nothing |
| W21 | t3 | `app.js` dealId write-back → `updatePostCallAnalysis` | local + HTTP | RMW + whole-record POST | `pc_*` | none | `dealId`, `accountId`, `scorecard`, `result.confirmed` | — | none | n/a | yes | warn | yes | yes | localStorage + history blob → re-triggers W4/W5 |
| W22 | t4 | `handleQualify` → `updatePostCallAnalysis` | local + HTTP | RMW + whole-record POST | `pc_*` | none | `result.qualification`, `result.framework`, hydration | — | none | n/a | yes (inside hydration) | no | yes | **yes — races W23/W24** `E-020` | history blob only |
| W23 | t4 | `handleSummarise` → `updatePostCallAnalysis` | local + HTTP | RMW + whole-record POST | `pc_*` | none | `analysis.callNotes`, `result.summarise` | — | none | n/a | yes | no | yes | **yes — races W22/W24** | history blob; `callNotes` reaches `post_call.analysis` via W5 |
| W24 | t4′ | detached `void videoP.then` → `updatePostCallAnalysis` | local + HTTP | RMW + whole-record POST | `pc_*` | none | `result.videoFacts` | **does not call `patchHydration`** | none | n/a | **no — fully detached** | no | yes | **yes** | history blob only |
| W25 | t5 | commit result → `updatePostCallAnalysis` | local + HTTP | RMW | `pc_*` | none | `result.technicalCommit`, `result.tcDeltas` | — | none | n/a | yes | no | yes | yes | history blob only |
| W26 | t6 | ARR result → `updatePostCallAnalysis` | local + HTTP | RMW | `pc_*` | none | `result.arrInputs`, `result.arrCompute` | — | none | n/a | yes | no | yes | yes | history blob only |
| W27 | t7 | Pass 6 + timeline → `updatePostCallAnalysis` | local + HTTP | RMW | `pc_*` | none | `pass6`, `result.timeline`, `dealId`, `accountId`, `result.confirmed`, `pending: []` | — | none | n/a | yes | no | yes | yes | history blob only |
| W28 | t8 | `onCallRecordHydrated` | — | **no write** | — | — | — | — | — | — | — | — | — | — | ❌ UI repaint only `E-016` |
| W29 | any | `call-view.js` MoM save → `updatePostCallAnalysis` | local + HTTP | RMW ×**2** per click | `pc_*` | none | `result.momDraft` | — | none | n/a | yes | `flashSaveStatus` | yes | yes | history blob; **two concurrent RMWs per click** `E-078` |

## 2. What that means, per artefact

| Artefact | Generated | Available at the one lifecycle link? | Local history | Remote history | `post_call.analysis` | `post_call.detail` | Normalized SQL | Later writer? | UI reads from | Proven? |
|---|---|---|---|---|---|---|---|---|---|---|
Narrative analysis | generate | **yes** | ✅ | ✅ | ✅ | — | — | — | history blob | CODE-PROVEN |
Quality coach | generate (in analysis) | yes | ✅ | ✅ | ✅ | — | — | — | history blob | CODE-PROVEN |
QIP scorecard + lines + themes | generate | **yes** | ✅ | ✅ | — | — | ❌ **W8 rollback** | none | history blob | **TEST-REPRODUCED** `R-004` |
Deal risks | scorecard | yes | ✅ | ✅ | — | — | ❌ | none | history blob | CODE-PROVEN |
Video facts | `videoP` (hydration) | **no** | ✅ (W24) | ✅ | — | ❌ | ❌ | none | history blob | CODE-PROVEN |
Timeline segments + markers | hydration (deterministic) | **no** | ✅ (W27) | ✅ | — | ❌ | ❌ | none | history blob | CODE-PROVEN |
Follow-ups | summarise (hydration) | **no** | ✅ (W23) | ✅ | — | ❌ | ❌ | none | history blob | CODE-PROVEN |
Objections | summarise | **no** | ✅ | ✅ | — | ❌ | ❌ | none | history blob | CODE-PROVEN |
MoM draft | summarise | **no** | ✅ | ✅ | — | ❌ | ❌ | W29 (blob only) | history blob | CODE-PROVEN |
Call notes | summarise | **no** | ✅ | ✅ | ✅ **via W5** | — | — | — | blob + SQL | CODE-PROVEN |
MEDDPICC qualification + deltas | qualify | **no** | ✅ | ✅ | — | ❌ | ❌ | none | history blob | CODE-PROVEN |
Technical commit + TC deltas | commit | **no** | ✅ | ✅ | — | ❌ | ❌ | none | history blob | CODE-PROVEN |
ARR inputs / compute / lines | arr-inputs + arr-compute | **no** | ✅ | ✅ | — | ❌ | ❌ | none | history blob | CODE-PROVEN |
Product gaps / what worked | gaps | **no** | ✅ | ✅ | — | ❌ | ❌ | none | history blob | CODE-PROVEN |
**Deal traction (Pass 8)** | inside the lifecycle link | n/a — computed there | — | — | — | — | ❌ **rollback, and would have used empty evidence** | none | deal health tab | `R-004` + `E-018` |
**Deal summary (Pass 9)** | inside the lifecycle link | n/a | — | — | — | — | ❌ | none | deal view | `R-004` + `E-019` |
**Account summary (Pass 9)** | inside the lifecycle link | n/a | — | — | — | — | ❌ | none | account view | same |
Contact / framework enrichment | inside the lifecycle link | n/a | — | — | — | — | ❌ | none | contact tiles | `R-004` |
Call participants / identities | `stampCallIdentities` | n/a | ✅ (`confirmedIdentities`) | ✅ | — | — | ❌ | none | stakeholders | `R-004` |
Account / deal / contacts | `resolveEngagementEntities` | yes | — | — | — | — | ✅ **these DO land** (W6/W7 precede W8) | yes | CRM views | CODE-PROVEN |

**Summary: of 20 post-call artefacts, exactly 2 reach relational SQL (narrative `analysis`, and `callNotes`), plus the account/deal/contact spine. Everything else lives only in a JSON blob in browser localStorage and one server-side key-value document.**

## 3. Scenario traces

### S1 — Existing account, existing deal (the common path)
W1…W5 succeed → W6, W7 succeed → **W8 fails `23505`** → W9–W20 skipped. Hydration W21–W27 patches the blob. `post_call` exists with `analysis`, `detail = NULL`, `pipeline_state = 'analysis_done'`. `scorecard` empty. UI looks perfect. **TEST-REPRODUCED.**

### S2 — Existing account, newly created deal
Identical, except W7 creates the deal first. Same W8 failure.

### S3 — Brand-new account/deal
`savePayload.accountId` is `undefined` (`E-057`), so **W4/W5 skip entirely** (`E-036`, no `accountId` → silent return). W6/W7 create the account and deal. **W8 then succeeds** — it is the first `post_call` writer, so it inserts with `idempotency_key = call_zoom:<id>` and W9–W20 run. But `data.summarise`/`qualification`/`technicalCommit`/`arrCompute`/`pass6`/`timeline` are still `undefined`, so most child writers are no-ops and **Pass 8/9 compute from nothing**. Then W21's dealId write-back stamps `accountId` onto the record, so the *next* history patch (W22) reaches W4/W5 — which now conflicts on `public_id` with a different key → `23505` → `[history][dual-write-DROPPED]`. **From then on no history patch ever reaches SQL for that call.**
→ New-account calls get child rows (computed from empty evidence); existing-account calls get none. Two different broken shapes.

### S4 — User refreshes immediately after the record appears
`pipelineState` is destroyed. `runPostcallParallelHydration`'s in-flight `postJson` promises reject or resolve into a dead closure. `pipelineState.resolve.transcript` is gone, so gaps, timeline, deferred commit and deferred ARR **can never be produced for that call**. The record keeps `hydration.pending` populated forever. No resume. `E-062`, `E-063`.

### S5 — One hydration pass fails, a later retry succeeds
`retryPostcallHydrationSection` (`web/postcall.js:5038`) requires `pipelineState?.resolve` — so retry works **only in the original tab, before any navigation away**. After a reload the retry button cannot function.

### S6 — Two hydration results finish nearly simultaneously
Local RMW is synchronous per call, so localStorage keeps both. But W22 and W23 each POST the **whole record** as of their own read. HTTP ordering is not guaranteed; if the earlier-read POST lands last, the server blob **regresses**. `saveHistoryEntry` has no CAS. Local and remote then disagree until the next `syncHistoryOnLogin`, which resolves in **remote's** favour (`E-081`) — so the regression wins. `E-020`, `E-021`.

### S7 — Same recording re-analysed
`callIdentityKey` is stable for a Zoom link, but a **new** `pc_*` id is minted every time (`newId("postCall")`). `attachPostCall`'s dedupe calls `findPostCallByIdentity(ownerId, 'zoom:abc')` while the stored key is `'call_zoom:abc'` — the `call_` prefix is never stripped (`E-038`), so dedupe **never matches** and the branch is dead (`E-039`). Result: a second `post_call` row with a different `public_id` but the **same** `idempotency_key` → the partial unique index fires → the second insert **updates the first row in place**, silently overwriting the earlier analysis while the id_registry remaps the new `public_id` onto the old internal id. Two user-visible calls, one SQL row.

### S8–S14 (Zoom and loading scenarios)
See [12-postcall-ux-zoom-and-loading](12-postcall-ux-zoom-and-loading.md).

## 4. Every 2xx-hides-a-failed-write opportunity

| # | Site | Mechanism |
|---|---|---|
1 | `POST /api/history` | `tryHistoryPostCallSqlWrite` wrapped in `try/catch`; comment states the 200 must never change. Logs `[history][dual-write-DROPPED]`. `E-035` |
2 | `tryHistoryPostCallSqlWrite` silent skips | no port / PG not ready / no uid / **no `accountId`** / no `analysis` / no SQL session / no owner-org row / shape-validation failure — six of these log nothing at all. `E-036` |
3 | `POST /api/domain-write` 500 | browser catches and `console.warn`s; the user sees a normal call view. `E-028`, `E-029` |
4 | Every child write in `linkPostCallToLifecycle` | 14 independent `try/catch`-and-warn blocks |
5 | `replaceCallParticipants` | wrapped in a SAVEPOINT so its failure cannot poison the txn — correct, but invisible |
6 | `POST /api/prep/synthesize` | same best-effort contract for `pre_call` |
7 | `updatePostCallAnalysis` | `pushRemoteEntry` failure keeps only the local copy and warns |
8 | `safeEnrich` × 18 | swallows every read error into `null`/`[]`, indistinguishable from empty. `E-071` |
9 | `handleHistoryPost` bulk branch | returns before any SQL projection. `E-037` |
10 | `POST /api/read-models/schedule` | 404, browser ignores it. `E-044` |

## 5. Every destructive whole-object overwrite surface

| Statement | Column(s) replaced outright | Proven consequence |
|---|---|---|
`upsertPostCall` ON CONFLICT | `transcript_ref`, `analysis`, **`detail`**, `pipeline_state`, `analysis_shape_version`, `detail_shape_version`, `se_motion` | `R-005`: `detail` → NULL, `transcript_ref` → NULL, shape 2 → 1, `signals_done` → `analysis_done`, from a single ordinary patch |
`upsertPreCall` ON CONFLICT | `research_brief`, `input_snapshot` | same pattern, unproven at runtime |
`saveHistoryEntry` | the entire per-user history document | concurrent PUT lost update |
`replaceHistory` | the entire per-user history document | bulk sync can revert every record |
`writeAll` (localStorage) | the entire array, **and drops the oldest records** on quota | silent history truncation |
`paintCallRecord` | `#call-panel.innerHTML` | not data loss, but destroys scroll/tab/animation state 6× per open |

**The correct pattern already exists** at `worker/src/routes.ts:2400-2409` (`COALESCE($n::jsonb, existing)`) for the `upsertPostCall`/`upsertCallSummary` domain-write cases. Only the hot path uses the destructive form.
