# 04 — PostgreSQL wiring matrix

**Evidence classes:** **VERIFIED** = I read the source or ran the query. **DELEGATED** =
produced by a read-only static inventory and not independently re-read. I verified the two
configuration defaults that govern every row, the read-path gate, and every live row count.

---

## 0. The two defaults that govern everything below

**VERIFIED:**

| Setting | Default | Declared at |
|---|---|---|
| `PERSISTENCE_MODE` | **`sql`** | `data/persistence/types.ts:37` |
| `PERSISTENCE_READ_MODE` | **`firestore`** | `data/persistence/read-repository.ts:896` |

`persistenceReadReady()` is true only for exactly `"pg"` (`:897`), and every domain read
handler gates on it via `pgReadRepositoryFor` → `null` (`routes/domain-reads.ts:70`).

**Consequence: with shipped defaults PostgreSQL is WRITE-ONLY.** See **J-028**. Every
"LIVE-READ-WRITE" classification below therefore means *"reads are wired and would work if
`PERSISTENCE_READ_MODE=pg`"* — not that they are serving traffic today.

**Second, independent gate:** `authContext()` calls `ensureNodeFirestore(env)`, which
throws 503 when Firestore admin is unavailable. So `/api/calls`, `/api/accounts`,
`/api/deals`, `/api/briefs`, `/api/contacts` need Firestore credentials **even in `pg`
read mode**. Only `/api/users/me` is Firestore-free.

---

## 1. Classification summary, reconciled against live row counts

The classification a code reading produces, cross-checked against what the database
actually holds. **The row counts are VERIFIED; the classifications are DELEGATED.**

| Classification | Tables | Live rows |
|---|---|---|
| **LIVE-READ-WRITE** | `account` 124, `activity` 437, `contact` 35, `deal` 522, `deal_contact` 7, `id_registry` 1959, `post_call` 345, `pre_call` 92, `scorecard` 62, `user_identity` 13, `user_kv` 39 | all populated |
| **LIVE-WRITE-ONLY** (written, never read by product code) | `ai_run` 2816, `scorecard_line` 3900, `scorecard_theme` 841, `scorecard_deal_risk` 69, `call_participant` 41, `contact_event` 18, `product_signal` 313, `audit_log` 167, `user_usage_logins` 172, `sql_fallback_log` 1341, `account_se_team` 50, `deal_stage_history` 523 (trigger-fed), `clustering_state` 1 | **9,662 rows written and never read** |
| **LIVE-WRITE-ONLY, and empty** | `technical_commit` 0, `arr_override` 0, `signal_cluster` 0 | writers exist, have never produced a row |
| **ORPHAN-CANDIDATE, confirmed empty** | `account_summary`, `deal_summary`, `score_override`, `feature_flag`, `notification`, `prompt_template`, `price_book`, `addon_price_book`, `assumptions_book`, `app_user_avatar`, `integration_token`, `sync_conflict`, `sync_error`, `sync_job`, `webhook_event`, `coaching_focus`, `coaching_recommendation`, `coaching_reflection`, `contact_merge_log` | **0 rows each** |
| **LIVE-READ-ONLY** (writer is a migration/ops script) | `app_user` 37, `org_unit` 10, `app_role` 4, `user_role` 38, `rubric` 19, `rubric_theme` 270, `rubric_parameter` 1350, `integration` 1, `task` 2 | populated by scripts |
| **MIGRATION-ONLY** | `org_unit_leader` 3 | |
| **UNREACHABLE at default mode** | `sync_outbox` 287 | enqueued only in `dual` mode |

**The headline number: ~9,662 rows across twelve tables are written by live code and read
by nothing in the product.** That is not dead code — it is live code producing data with no
consumer, which is a more expensive failure because it costs on every request.

---

## 2. Where the pipeline actually breaks

**VERIFIED** (measured), tracing one post-call through the stores:

```
user completes a post-call
   │
   ├─► POST /api/history ─────────► user_kv.history        39 rows   ← the UI reads THIS
   │                              └► activity + post_call  437/345   ← best-effort, 200 either way
   │
   ├─► POST /api/domain-write ────► scorecard               62        ← 283 calls never get one
   │                              └► scorecard_theme/line   841/3900 ← never read back
   │
   ├─► LLM passes ───────────────► ai_run                  2816      ← 4 joinable to a call
   │
   └─► sync_outbox ───────────────► 287 rows, 236 pending             ← projector not running
```

Every arrow that lands in PostgreSQL is a write with no read. The one store the UI reads —
`user_kv.history` — is the one the mandate says must **not** be authoritative.

---

## 3. The targeted hunts

The mandate asks for eleven specific things. Status of each:

| # | Hunt | Result |
|---|---|---|
| 1 | Firestore reads/writes of **application** data | **FOUND, extensively.** `data/scope.ts` reads Firestore `authIndex`, `users` and `orgs` — **every authorization decision is made from Firestore**. `org-structure.ts` writes `users.managerId/teamId` and `teams.memberIds`. `routes.ts` writes the Firestore `deals` collection and `callSummaries`. `read-models/write.ts` writes all five read models to Firestore. The entire default read path is Firestore repositories |
| 2 | `applyDomainWrite` fallback | **FOUND.** Invoked whenever `trySqlDomainWrite` returns `{handled:false}` **and** mode ≠ `sql`. **26+ fallback sites** |
| 3 | localhost/dev override bypassing PostgreSQL | **FOUND.** When `!firebaseAuthEnforced`, an **`X-Dev-User-Email` header is accepted as identity**. Also `?storeMode=` and `localStorage["lionpath.readVia"]` force the client's read path |
| 4 | localStorage / blob as authority | **FOUND, and it is the product's real store of record.** `user_kv.history` is written *first* and the SQL write is explicitly "layered on top". Tasks, score overrides, disputes, prep briefs and feedback are all localStorage- or blob-authoritative. `score_override` has **0 rows** while `localStorage se-score-overrides` holds the data |
| 5 | HTTP 2xx while SQL did not commit | **FOUND, eight sites.** Most consequential: `POST /api/history` returns 200 unconditionally; `POST /api/prep/synthesize` swallows failures to a `console.warn` with **no fallback-log row** (asymmetric with the history path, so that path is invisible to telemetry); and `updateDeal`/`updateAccount` with only unmapped fields **echo the patch back as applied without executing an UPDATE** |
| 6 | SQL write with no product read | **FOUND, 18 tables.** Root cause for the scoring family: `scorecardDoc` projects only 9 columns, so every per-theme grade, verdict, coaching note, confidence and `se_motion_source` written is unreadable through the PG path |
| 7 | product read with no SQL writer | **FOUND.** `deal.tc_detail`, `deal.closed_won_at`, `deal.champion_contact_id`, `product_signal.post_call_id`/`deal_id` are all read and never written. The seven MEDDPICC `*_value` columns have zero writers, and the `*_surfaced` columns are GENERATED from them — so **they are permanently `false`** |
| 8 | names imply parity, semantics differ | **FOUND, ten pairs.** Sharpest: `listProductSignalsByDeal` filters on `ps.deal_id`, which `upsertProductSignal` never writes, so it **always returns zero rows** — making `dealSignals` and `productGaps` permanently empty on the PG path. And `getDealDetail`'s PG version returns `summary: null`, `technicalCommit: null`, `arrLines: []` where the Firestore version returns real data: same interface, strictly less data, no error |
| 9 | whole-object JSONB replacement | **FOUND.** See **J-026** for the measured impact — mechanism confirmed, 21/345 rows NULL, 15 of 62 scored calls without `detail` |
| 10 | enum/text mismatch, silent defaults | **FOUND.** `deal.status` is written `"archived"` and `"closed_won_grace"`, **neither of which is in `deal_status_enum`** — an invalid enum aborts the whole transaction. `activity_type` is hardcoded `'task'` for every non-stage lifecycle event. `product_signal.signal_type` is hardcoded `'product_gap'`, so `upsertProductGap` can never produce `feature_request` — which `getDealDetail` queries for |
| 11 | joins bypassing `activity` | **FOUND, systemic.** `scorecard.owner_user_id` and `activity.owner_user_id` are set independently and **nothing enforces agreement**. Owner/org are resolved from `app_user` by `session.userId`, never from the call's `activity` row — so **a manager-proxy write attributes the call to the actor, not the owner** |

Item 11's last point is the same class of defect as **J-025**: identity is taken from
whoever is making the request rather than from the call's canonical owner.

---

## 4. What this means for the mandate's settled decisions

| Settled decision | Reality |
|---|---|
| "PostgreSQL is the **only** authoritative application-data store" | **False today.** It is write-only by default; Firestore serves reads and holds authorization data |
| "Firebase remains **only** for user authentication" | **False.** Firestore holds `users.role/teamId/orgId` — the basis of every authorization decision — plus the org tree, read models, `llmUsage`, `callSummaries` and the `deals` written by `POST /api/deals` |
| "Firestore must not be a primary, fallback, mirror, recovery, analytics, history, or hidden write target" | It is currently **all seven** |
| "A UI cache may exist, but localStorage / a JSON blob must not be the sole durable source for any user-visible artefact" | **Violated.** Score overrides live only in localStorage (`score_override` = 0 rows); history is blob-first by explicit design |

**None of this is a regression introduced by this branch.** It is the as-built state, and
the gap between it and the settled decisions is the real size of the remaining cutover.

---

## 5. Coverage boundary

The full forward matrix (48 features, each with UI entry → client method → route → handler
→ repository → SQL target → transaction boundary → idempotency key → owner derivation →
failure behaviour) and the full reverse matrix (all 58 declared tables with writers,
readers, views and triggers) exist as **DELEGATED** inventories. I verified the
configuration defaults, the read gate, and all 64 live row counts; I did **not** re-read
all 48 forward traces.

**What would raise the rest to VERIFIED:** the single highest-value action is reading the
deployed `PERSISTENCE_READ_MODE`. If it is unset or `firestore`, then every
"LIVE-READ-WRITE" row above is really LIVE-WRITE-ONLY, and the matrix collapses to a much
simpler and much worse picture: **PostgreSQL is an expensive write-only log.**
