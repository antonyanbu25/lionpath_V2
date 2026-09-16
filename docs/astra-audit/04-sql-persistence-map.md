# 04 — SQL Persistence Map (write and read parity)

**Snapshot:** `SE-Labs` @ `c58eac93`, `VERSION` 2.1.30, 2026-09-08.
**Related:** [03-postcall-write-ledger](03-postcall-write-ledger.md) · [05-runtime-sql-verification](05-runtime-sql-verification.md) · [06-bugs-and-risks](06-bugs-and-risks.md)

---

## 1. The write chain, and the three places it forks

```
store.<method>                       web/domain/store.js — createSplitStore(read, write, readMode, writeMode)
  → api-store.js | firestore-store.js | local-store.js       (chosen by resolveWriteMode)
  → POST /api/domain-write  { method, args }
  → handleDomainWrite            routes.ts:1646
      ├─ mode !== "sql" && !firestoreAdminReady  → 503
      ├─ trySqlDomainWrite         routes.ts:1767
      │    ├─ !port || !postgresReady            → fallback(reason:"postgres_not_configured") → not handled
      │    ├─ authz per method                   → fallback(reason:"not_authorized")
      │    └─ withSessionContext(BEGIN … COMMIT)
      │         └─ 60-case switch → port.<repo method> → SQL
      ├─ handled → 200
      ├─ mode === "sql"  → 501  (THE MODE GUARD — inert when the var is unset, E-118)
      └─ applyDomainWrite → FIRESTORE
```

Three forks decide whether a write reaches PostgreSQL at all:

| Fork | Condition | Effect |
|---|---|---|
1 | `postgresReady(env)` — requires Node **and** `DATABASE_URL` | **false on Cloudflare always** (`E-117`) |
2 | `resolvePersistencePort` — `null` in `firestore` mode | the shipped VPS default (`E-116`) → no SQL attempted |
3 | `handleDomainWrite`'s `mode` — `""` when unset | the 501 guard never fires; unwired methods silently go to Firestore (`E-118`) |

## 2. SQL writes that do NOT enter through `/api/domain-write`

| Entry | Symbol | Tables touched | Best-effort? |
|---|---|---|---|
`POST /api/history` | `tryHistoryPostCallSqlWrite` `routes.ts:2915` | `activity`, `post_call` (+ `account` auto-provision, `deal` ref) | **yes** — never changes the 200 |
`POST /api/prep/synthesize` | `tryPrepSynthesizeSqlWrite` `routes.ts:3032` | `activity`, `pre_call` (+ provisioning) | **yes** |
`POST /api/internal/outbox/project` | `projectOutboxBatch` | `sync_outbox` | no — but **no scheduler calls it** |
`POST /api/tasks`, `PATCH/DELETE /api/tasks/:id` | tasks backend | `task` | only when `HISTORY_BACKEND_MODE=pg`, which no deploy file sets |
`POST /api/postcall/commit` | `runPostCallCommit` | `technical_commit` | — |
`POST /api/product-signal/cluster` | `runGapClustering` | `signal_cluster`, `clustering_state` | — |
`POST /api/recovery/upload` | `mergePostCalls`, `saveSidecar`, `saveTasks`, `appendFeedback` | history/tasks backends only | — |
LLM telemetry | `insertAiRun` `ai-run.ts:204` | `ai_run` | **fire-and-forget `void`** (`E-097`) |
Fallback telemetry | `logFallback` → `sql_fallback_log` | `sql_fallback_log` | — |
`POST /api/deals` | `handleDealsCreate` `routes.ts:3181` | **Firestore only** — no SQL path | — |
`PATCH /api/org/structure` | `handleOrgStructurePatch` | **Firestore only** | — |
Scripts | `apply-janus-schema.mjs`, `dual-write-soak.ts`, `verify-call-storage.mjs` | various | operator-run |

## 3. Post-call write classification

| Artefact / method | Classification | Evidence |
|---|---|---|
`createAccount` / `updateAccount` | **proven normalized SQL** | W6, `routes.ts:1923,1947` |
`createContact` / `updateContact` | **proven normalized SQL** | W1, W6 |
`createDeal` / `updateDeal` / lifecycle events | **proven normalized SQL** | W7 |
`upsertPostCallWithSummary` (the call itself + children) | **SQL but unreachable in the common flow** — `23505` rollback | `R-004` |
history-path `post_call` | **proven JSONB SQL, but lossy**: `analysis` only, `detail` forced to NULL, `pipeline_state` frozen | `R-005`, `E-031`, `E-033` |
`upsertScorecard` / `upsertScorecardTheme` / scorecard lines | **unhandled in practice** — only writer is the rolled-back branch | `R-004`, `E-055` |
`upsertDetailItem` (12 detail collections) | **SQL exists and is correct, but has no live caller** in the post-call flow | `routes.ts:2265-2313`; callers are the rolled-back `persist*Draft` helpers |
`upsertTechnicalCommit` | **SQL exists**; reached only via `/api/postcall/commit`, not via hydration | `routes.ts:2565` |
`upsertDealSummary` / `upsertAccountSummary` (Pass 9) | **unhandled in practice** | `R-004` |
`upsertProductSignal` / `upsertSignalCluster` (Pass 6) | **unhandled in practice** | `R-004` |
`replaceCallParticipants` | **unhandled in practice** (SAVEPOINT-guarded inside the rolled-back txn) | `R-004` |
`addArrOverride` | SQL exists; ARR from hydration never gets there | `routes.ts:2580` |
qualification → deal | `applyQualificationToDeal` → `patchDeal`; **unreached** | `R-004` |
deal traction (Pass 8) | **unreached, and computed from empty evidence** | `E-018` |
history blob (whole record) | **history/KV/file/Firestore intentional** | `E-021` |
`localStorage` history | **local-only intentional** (but the source of truth in practice) | `E-074` |
`user_kv` | **fallback-dependent** — only with `HISTORY_BACKEND_MODE=pg` | `node-server.ts:164` |
`POST /api/deals`, `PATCH /api/org/structure` | **Firestore intentional** — no SQL path | `routes.ts:3271` |
`/api/read-models/schedule` | **dead** — 404 | `E-044` |
`/api/internal/batch/*`, nightly rebuild | **dead** — 404 | `E-045` |
`worker/src/postcall.ts` | **dead/historical** duplicate | `E-114` |

## 4. Read parity

| UI surface | Store read | API route | Read repository | Firestore fallback | SQL source | Cache | Notes |
|---|---|---|---|---|---|---|---|
Calls list | `listPostCallsByOwner` | `GET /api/calls` | `read-repository` | yes | `post_call` + `activity` | 30 s | 503 on Cloudflare (`E-059`) |
Call detail | `getCall` / `getPostCall` | `GET /api/calls/:id` | `getPostCallDetail` | yes | `post_call`, `scorecard*` | 30 s LRU 64 | `provisional` always true (`E-034`) |
Accounts | `listAccounts` / `getAccount` | `GET /api/accounts[/:id]` | yes | yes | `account` | list 30 s; **`getAccount` uncached** | one request per open |
Deals | `listDealsByOwner` / `getDeal` | `GET /api/deals[/:id]` | yes | yes | `deal` | 30 s | |
Contacts | `listContactsByAccount` | `GET /api/accounts/:id/contacts` | `pgContactsRepositoryFor` | **none** | `contact` | **uncached** | **bypasses `PERSISTENCE_READ_MODE`** — reads PG whenever `postgresReady`, by deliberate design (`domain-reads.ts:76-90`) |
`listContactsByDeal` | — | — | — | — | — | — | `api-store.js:645` returns a hardcoded `[]` |
Product gaps / what worked by post-call | delegate | — | — | **Firestore query** | — | **never** | ADR-008 says direct browser Firestore reads are retired; these are not |
Technical commit by deal/account | delegate | — | — | **Firestore query** | — | **never** | issued **3×** per call-view open (`E-073`) |
Scorecard lines by call | delegate | — | — | **Firestore query** | — | **never** | |
Gap clusters | delegate | — | — | **Firestore doc** | — | **never** | |
Read models | — | `GET /api/read-models/:collection/:id` | `read-models.ts` | — | views | — | 503 on Cloudflare |
History | `fetchHistoryFromWorker` | `GET /api/history` | history backend | — | `user_kv` (pg mode only) | 30 s in-flight | the real source of truth for post-call output |

**Read-mode default is `firestore`** (`persistenceReadReady` → `env.PERSISTENCE_READ_MODE || "firestore"`, `read-repository.ts:881`), so unless an operator sets `PERSISTENCE_READ_MODE=pg`, every domain read comes from Firestore — **except contacts**, which read PostgreSQL unconditionally. That is a deliberate, documented exception, and it is also the only read path that can observe the SQL writes at all.

## 5. Bidirectional gap analysis

### 5.1 Writes with no corresponding read
- `post_call.detail` items: `upsertDetailItem` writes 12 collections; the call view reads them from `detail` via `detailArray()` — but since `detail` is NULL (`E-040`, `R-005`), the read always falls back to the history blob. The SQL round-trip is unexercised.
- `ai_run`: written (unattributably); **the only reader route, `GET /api/admin/llm-usage`, is unregistered** (`E-043`-class).
- `sync_outbox`: written by dual mode; **the projector has no scheduler**.
- `v_se_score_leaderboard`: created by migration 34, which no automated path applies (`R-003`), and read by nothing.

### 5.2 Reads with no corresponding SQL write
- `scorecard`, `scorecard_line`, `scorecard_theme` — read by the QIP tab and `v_scorecard_rankable`; written only by the rolled-back branch. This is precisely what `janus/schema/34…sql:15-21` observed in production.
- `deal_summary`, `account_summary` — read by account/deal views; written only by the rolled-back branch.
- `product_signal`, `signal_cluster` — same.
- `call_participant` — same.
- `deal_traction` — same.

### 5.3 Methods exposed by a store but absent from `ADMIN_WRITE_METHODS`
`api-store.js` maintains three lists (`:110`, `:166`, `:203-211`). The `upsertPostCall`/`upsertCallSummary` pair routes to the **safe COALESCE** UPDATE (`routes.ts:2400`), while `upsertPostCallWithSummary` routes to the **destructive** insert. Same conceptual operation, two opposite merge semantics, chosen by which method name the browser happens to call.

## 6. Answers to the primary persistence questions

| Q | Answer |
|---|---|
Which data is written to normalized SQL tables? | `account`, `contact`, `deal`, `activity`, `lifecycle_event`, and (via the history path) a hollow `post_call` row. Nothing else, in the common flow. |
Which data is in `post_call.analysis`? | The narrative analysis object, plus `callNotes` once summarise lands. |
Which data is in `post_call.detail`? | **Nothing.** Both writers send `null` (`E-031`, `E-040`), and the ON CONFLICT branch would erase it anyway (`R-005`). |
Which data exists only outside SQL? | QIP scorecard, video facts, timeline, follow-ups, objections, MoM, MEDDPICC, technical commit, ARR, product gaps, deal traction, deal/account summaries, participants/identities — all in `localStorage` + one history document. |
Can a 200 hide a missing SQL write? | Yes, at ten distinct sites — see [03](03-postcall-write-ledger.md) §4. |
Can one writer erase another's data? | Yes: `detail`/`transcript_ref`/`pipeline_state` via the destructive UPSERT (`R-005`), the whole history document via concurrent PUT (`E-021`), and local records via the 100/4 MB trim. |
Are post-call outputs persisted after hydration, or merely rendered from history? | **Merely rendered from history.** `onCallRecordHydrated` performs no write (`E-016`). |
