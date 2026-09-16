# 03 — Current as-built architecture

Reconstructed from the current branch, not copied from any prior diagram. Every claim is
either `CODE-PROVEN` (traced in source, file:line) or marked `RUNTIME-BLOCKED` where it
depends on deployed configuration I could not read.

---

## 1. The single most important unresolved fact

**Nobody can say, from this repository, which persistence mode production runs in.**
`PERSISTENCE_MODE` resolves to **three different defaults across five surfaces**:

| Surface | Default | Evidence |
|---|---|---|
| Node / Cloud Run entry point | **`sql`** | `worker/src/node-server.ts:119` |
| Persistence port | **`sql`**, with an invalid value falling back to `firestore` | `worker/src/data/persistence/types.ts:37`, `:41` |
| VPS docker-compose | **`firestore`** | `deploy/vps/docker-compose.yml:29` |
| Cloud Run secret-attach script | **`dual`** | `deploy/cloudrun/setup-sql-secrets.sh:105`, `:110` |
| Cloud SQL README | **`dual`** | `deploy/cloudsql/README.md:44` |
| Local bootstrap | **`firestore`** | `worker/scripts/start-local-postgres.mjs:32` |

`HISTORY_BACKEND_MODE` compounds it: `node-server.ts:179` coalesces
`HISTORY_BACKEND_MODE || PERSISTENCE_READ_MODE || ""`, so the history backend is **not
independent of the read mode**, and `deploy/vps/docker-compose.yml:19` sets
`HISTORY_FILE_DIR` unconditionally — giving VPS a **flat-file** history backend, a third
store beside PostgreSQL and Firestore.

Settling this needs the deployed Cloud Run environment variables. **`RUNTIME-BLOCKED`** —
no `gcloud` on this machine (B-04). Every downstream question ("is Firestore still
authoritative", "are writes landing", "is the cutover done") inherits that block.

What the *data* says, which is the strongest available substitute: `sql_fallback_log`
carries **1015 rows with `persistence_mode = 'sql'`** and 265 with `'dual'`, so **both
modes have been live**, and the `sql` ones are what `v_sql_coverage` defines as lost
writes.

---

## 2. Request path, end to end

```
browser (web/, plain ES modules, no bundler at runtime — dev-server.mjs serves source)
   │  fetch() with a Firebase ID token in Authorization: Bearer
   ▼
worker.fetch                                    worker/src/index.ts:67
   │  correlationIdFromRequest  →  runWithRequestContext   request-context.ts:7, :18
   │  (module-level variable, NOT AsyncLocalStorage — J-018)
   ├─ 1. exact table lookup      routes[path][method]      index.ts:111-115
   │       table declared at                                routes.ts:3444-3511
   ├─ 2. hardcoded special case  POST /api/admin/impersonate-token   index.ts:118-123
   ├─ 3. regex  ^/api/tasks/([^/]+)$  PATCH|DELETE          index.ts:125-139
   ├─ 4. regex dispatchers
   │       dispatchDomainReadById      routes/domain-reads.ts:387-427
   │       dispatchReadModelsById      routes/read-models.ts:92-111
   └─ X-Request-Id set on the response                       index.ts:56
```

**Node-only interception:** `POST /api/video-pass` is handled *before* `worker.fetch` at
`node-server.ts:246`, so the table's `handleVideoPass` (`routes.ts:428`) is **dead on
Cloud Run and VPS** and live only on a Cloudflare deploy. Both paths authenticate, so this
is not an auth gap — but a change to `handleVideoPass` has no effect on Cloud Run.

Both deploy targets run the same Node entry point: `deploy/cloudrun/Dockerfile.api:23` and
`deploy/vps/Dockerfile.worker:29` both exec `npx tsx src/node-server.ts`.

---

## 3. Persistence layer

```
route handler
   │
   ├─ resolveSqlSession(authUid)        session-context.ts:239
   │     Firebase UID → user_identity → app_user → org_unit.path
   │     5s per-process cache (session-context.ts, SESSION_CACHE_TTL_MS)
   │
   ├─ withSessionContext(session, fn)   session-context.ts:327
   │     BEGIN
   │     SET LOCAL app.user_id / app.org_unit_path / app.is_admin   (separate statement)
   │     fn(client)
   │     COMMIT   |   ROLLBACK on throw
   │
   ├─ PostgresRepository                postgres-repository.ts
   ├─ PostgresReadRepository            read-repository.ts
   ├─ FirestoreRepository               firestore-repository.ts
   └─ DualWriteRepository               dual-write-repository.ts
         resolvePersistencePort() picks by PERSISTENCE_MODE
```

RLS reads those three session variables through `current_user_id()`,
`current_org_path()` and `is_admin()` — all declared `STABLE`
(`00_phase0_infra_and_org.sql:75-85`), with `current_org_path()` redefined **fail-closed**
at `08_rls_hardening.sql:18` so an unset variable denies rather than permits.

**Verified fail-closed in practice:** reading `post_call` on staging as `postgres` with no
session context returned **zero rows**, because `13_rls_hardening_round2.sql:174` and
`14_rls_owner_write_calls.sql:10` apply `FORCE ROW LEVEL SECURITY` and Cloud SQL's
`postgres` is not a true superuser (E-032 context).

**23 of 58 tables have RLS.** Notably without it, despite holding sensitive data:
`contact` (customer emails, `01_phase1_crm_core.sql:33`), `audit_log`, `score_override`,
`sync_outbox` (payload jsonb), `contact_merge_log`, and all four of
`deal_summary` / `account_summary` / `technical_commit` / `arr_override`.

---

## 4. Storage topology — there are more stores than the architecture admits

| Store | Role | Status |
|---|---|---|
| **Cloud SQL PostgreSQL 16.14** (`janus-db`) | intended system of record | live; 64 tables, 16 views, 53 policies |
| **Firestore** | intended auth-only | **still an application-data store** — `applyDomainWrite` is reachable whenever mode ≠ `sql`, read-models rebuild re-reads from it (`DATABASE_GUARDRAIL_REPORT.md:40`, `:109`) |
| **`user_kv` table** | per-user history/tasks blob | a **third** store. `RUN_LOG.md:280-282` records that `upsertTask` writes a KV blob, which is why `task` has only 2 rows |
| **Flat files** | VPS history | `HISTORY_FILE_DIR` set unconditionally at `deploy/vps/docker-compose.yml:19` — a **fourth** store on that target |
| **`sync_outbox`** | PostgreSQL → Firestore projection | **stopped.** 236 pending, 51 completed (J-021) |
| **localStorage / sessionStorage** | session + UI cache | session injection at `web/auth.js`; history blobs cached client-side |
| **GCS** | offloaded call payloads | `worker/src/data/call-payload-storage.ts`, via `/api/calls/:id/offload-payload` |

The mandate's settled decision is that PostgreSQL is the only authoritative application
store and Firestore is auth-only. **The as-built system has four durable write targets for
application data**, and which one wins is decided by environment variables whose deployed
values could not be read.

---

## 5. Providers

| Provider | Entry | Timeout after P10 |
|---|---|---|
| Gemini (generation) | `providers/gemini.ts` via `fetchGeminiWithRetry` | per-workload, 45–90s, + bounded retry `gemini-retry.ts:182` |
| Gemini (embeddings) | `embeddings.ts:58` | 30s (added) |
| Gemini (context cache) | `providers/gemini-cache.ts` ×3 | 20s (added) |
| Gemini (batch) | `providers/gemini-batch.ts:79` | 30s (added) |
| Anthropic | `providers/anthropic.ts:53` | 30s (added) |
| Zoom S2S OAuth + recordings | `zoom.ts` ×3 | 20s metadata / 60s download (added) |
| Zoom share scrape | `zoomShare.ts` | pre-existing |
| Transcript inference | `video/transcript-infer.ts` ×2 | 120s (added) |
| Apollo enrichment | `enrichment/apollo.ts:53` | 20s (added) |
| ZoomInfo, DuckDuckGo, company web, citations | `research/providers/*`, `prep/citations.ts` | pre-existing AbortController |
| Freshdesk | `freshdesk.ts` ×3 | 20s (added) |
| Resend email | `notify-email.ts:96` | 10s (added) |
| Firebase JWK | `auth.ts:27` | **10s (added)** — was unbounded on the critical auth path |

31 distinct LLM pass names, all now classified to a timeout workload
(`gemini-retry.ts`, guarded by `worker/scripts/test-provider-timeouts.ts`).

---

## 6. Deployment

| | Cloud Run | VPS | Cloudflare Workers |
|---|---|---|---|
| Entry | `npx tsx src/node-server.ts` (`Dockerfile.api:23`) | same (`Dockerfile.worker:29`) | `src/index.ts` (`wrangler.toml:2`) |
| `PERSISTENCE_MODE` | `dual` if `setup-sql-secrets.sh` ran; else the code default `sql` | `firestore` | unset → `sql` |
| History backend | `PERSISTENCE_READ_MODE`-derived | **flat file** | KV |
| `/api/video-pass` | Node handler | Node handler | table handler |
| Status | intended target | in use | `nodejs_compat` relevance unresolved (A-07), `RUNTIME-BLOCKED` |

CI (`.github/workflows/ci.yml`) now has four jobs: `secrets` (scanner), `sql`
(postgres:16, schema from zero, re-apply, DB gates + `tsc`), and the `test` matrix across
worker / web / rules.

---

## 7. Code that exists but is unreachable in the deployed topology

| Item | Why unreachable | Evidence |
|---|---|---|
| `handleDirectorAnalyticsGet` | registered nowhere, deliberately | `routes.ts:3541-3544`, `routes.ts:95` |
| `handleVideoPass` (table entry) | intercepted by `node-server.ts:246` on both deployed targets | `routes.ts:3474` vs `node-server.ts:246` |
| `v_se_score_leaderboard` | exists on staging, read by **no product code** | E-021, E-087 |
| `janus/schema/19_history_tasks_feedback.sql` | byte-identical duplicate of `20_…`; applied by neither path | E-019 |
| `audit_log` write path | three triggers write it (`25_audit_and_notifications.sql:136`, `:171`, `:201`); **nothing reads it** | `DECISIONS_LOG.md:183-188` |
| `notification` table | no reader; email goes out via Resend without recording | `DECISIONS_LOG.md:11-14` |

A fuller reachability inventory is in `10-dead-code-inventory.md`.

---

## 8. Diagram — the honest version

```
                     ┌─────────────────────────────────────────┐
  browser ──────────►│ worker.fetch (index.ts:67)              │
  Bearer ID token    │  ├ exact table  ├ regex  ├ dispatchers  │
                     └──────────────┬──────────────────────────┘
                                    │  resolvePersistencePort(PERSISTENCE_MODE)
                 ┌──────────────────┼───────────────────┬──────────────────┐
                 ▼                  ▼                   ▼                  ▼
        ┌────────────────┐  ┌───────────────┐  ┌────────────────┐  ┌──────────────┐
        │ PostgreSQL     │  │ Firestore     │  │ user_kv table  │  │ flat files   │
        │ 16.14          │  │ (app data,    │  │ (history/tasks │  │ (VPS only,   │
        │ 64 tables      │  │  NOT auth-    │  │  3rd store)    │  │  4th store)  │
        │ RLS on 23      │  │  only)        │  └────────────────┘  └──────────────┘
        └───────┬────────┘  └───────▲───────┘
                │                   │
                │  sync_outbox      │   236 pending / 51 completed
                └───── projector ───┘   ** NOT RUNNING (J-021) **
                        ▲
                        └─ no scheduler invokes /api/internal/outbox/project
```

The dashed truth: the projector is the mechanism that keeps the two primary stores
consistent, and it is stopped. So `sql` and `dual` mode have diverged by an unknown amount
for an unknown period, and `CUTOVER_SQL.md:48`'s documented rollback path — "`sql` → `dual`
is only safe while the projector kept Firestore in sync" — **is not currently available.**
