# SQL QA Validation Matrix

Phase 0 of [SQL_QA_FIX_PLAN.md](./SQL_QA_FIX_PLAN.md). Every QA claim validated against the codebase with file:line evidence before fixes.

**Legend:** CONFIRMED (bug present as described) · PARTIAL (present but scope differs) · REJECTED (not reproducible / incorrect)

---

## Blockers

### #1 Fresh schema install fails on `11_deal_contact.sql` — **CONFIRMED**

- **Evidence:** `janus/schema/11_deal_contact.sql:75` has `ALTER TYPE integration_provider_enum ADD VALUE IF NOT EXISTS 'firestore_projection'` followed at `:78` by `INSERT INTO integration (... 'firestore_projection' ...)`. `worker/scripts/apply-janus-schema.mjs` sends each file as one `client.query(sql)` — an implicit transaction. Postgres rejects using a new enum value in the transaction that added it.
- **Reproduced:** `worker/scripts/repro-empty-db.mjs` on empty `janus_repro` DB → `11_deal_contact.sql ... FAIL — unsafe use of new value "firestore_projection" of enum type integration_provider_enum`. Passes on re-run (ADD VALUE becomes no-op), matching QA's "worked on my machine" note.

### #2 Read-model views bypass RLS — **CONFIRMED**

- **Evidence:** `janus/schema/12_read_model_views.sql` creates `v_team_metrics`, `v_org_metrics`, `v_deal_traction`, `v_account_rollup`, `v_se_launchpad` with plain `CREATE OR REPLACE VIEW` (no `WITH (security_invoker = true)`). Views are owned by the migration superuser (`DATABASE_URL_MIGRATIONS` = postgres). Postgres default is `security_definer` semantics — RLS on base tables is evaluated as the view owner, not the querying `janus_app` session. The comment at `:104` ("RLS on base tables still applies per-user") is incorrect.

### #3 `upsertOrgUnit` poisons the transaction — **CONFIRMED**

- **Evidence:** `worker/src/data/persistence/postgres-repository.ts:322` calls `registerId(client, "org_unit", row.id, 0)`. `janus/schema/09_id_registry.sql:15` has `CONSTRAINT uq_id_registry_internal UNIQUE (entity_type, internal_id)`, so the second org unit (both with `internal_id = 0`) raises a unique violation. The `.catch(() => undefined)` swallows it in JS but the Postgres transaction is aborted; subsequent statements fail with "current transaction is aborted". Org units use text PK `org_unit.id` and are never resolved through id_registry — the mapping is meaningless.

### #4 Only one scorecard per activity is storable — **CONFIRMED**

- **Evidence:** `janus/schema/04_phase4_scoring_rubrics.sql:58` (`is_current boolean NOT NULL DEFAULT true`) + `:70` (`CREATE UNIQUE INDEX idx_scorecard_activity_current ON scorecard(activity_id) WHERE is_current = true`). `upsertScorecard` (`postgres-repository.ts:207`) inserts without setting `is_current` and never demotes the prior row, so a second rubric on the same call violates the partial unique index.

---

## Correctness bugs

### #5 deal_contact outbox projects to the wrong Firestore doc — **CONFIRMED**

- **Evidence:** `dual-write-repository.ts:71-79` (`upsertDealContact`) enqueues `entityId: row.publicId` (= `dealContactId(deal, contact)`), but `setPrimaryDealContact` (`:83-89`) and `removeDealContact` (`:91-97`) enqueue `entityId: \`${dealPublicId}:${contactPublicId}\``. The projector writes `db.collection('dealContacts').doc(entity_id)` (`outbox.ts:54`), so primary flips create orphan docs and deletes target non-existent docs. Also, demoted contacts get no outbox rows, leaving multiple `isPrimary: true` in Firestore.

### #6 `updateAccount` is destructive in dual/sql mode — **CONFIRMED**

- **Evidence:** `routes.ts:1652-1665` requires only `doc.id`, then `upsertAccount` with `name: stringField(doc.name) || "Unknown"` and `nullableString(doc.domain)` etc. The SQL `ON CONFLICT DO UPDATE` sets every column from EXCLUDED — a partial patch `{id, industry}` nulls domain/slug/health/externalRef and overwrites the name with "Unknown".

### #7 Legacy write logic bypassed, not mirrored — **CONFIRMED**

- **Evidence:** `routes.ts:1618-1621` returns early when `sqlResult.handled`, never calling `applyDomainWrite`. Outbox payloads in `dual-write-repository.ts` are hand-written subsets (account: 6 fields; deal renames `name`→`title`). Derived fields/timestamps/denormalizations from the legacy path are silently dropped from Firestore during dual-write.

### #8 Outbox rows stranded in `processing` — **CONFIRMED**

- **Evidence:** `claim_outbox_batch` (`06_phase6_outbox_integrations_pii.sql:155`) claims only `status = 'pending'`. A worker crash mid-batch leaves rows `processing` forever — no reaper exists. The comment in `outbox.ts:10-12` describes the intent but no code implements it.

### #9 Double-counted outbox attempts — **CONFIRMED**

- **Evidence:** `claim_outbox_batch` (`:163`) does `attempts = sob.attempts + 1` and returns the post-increment value; `outbox.ts:88` computes `const attempts = claim.attempts + 1` again. Retry ceiling is one short of MAX_ATTEMPTS and backoff is one step too long.

### #10 `validateJsonbShape` hard-fails the request — **CONFIRMED**

- **Evidence:** `routes.ts:1742-1743, 1774-1775` call `validateJsonbShape` inside `trySqlDomainWrite` with no try/catch; `ShapeValidationError` propagates as a 500 instead of falling through to Firestore. `shapes.ts:17-45` hand-enumerates allowed keys — any new top-level key in analysis/detail breaks every post-call write in dual mode.

### #11 Unique-index collisions on upserts — **CONFIRMED**

- **Evidence:**
  - `upsertActivity` — `ON CONFLICT (public_id)` but `idx_activity_idempotency` is unique on `idempotency_key` (02_phase2_activities.sql).
  - `upsertPreCall` / `upsertPostCall` — `ON CONFLICT (public_id)` but `activity_id` is UNIQUE (03_phase3_ai_pipeline.sql).
  - `upsertDealContact` — `ON CONFLICT (deal_id, contact_id)` but `public_id` is UNIQUE; on conflict the existing row's id is returned while `registerId` maps the *new* public_id to it.

---

## Gaps that make dual/sql mode a silent no-op

### #12 No `app_role` / `user_role` seed — **CONFIRMED**

- **Evidence:** `grep -rn "INSERT INTO app_role\|INSERT INTO user_role" janus/schema/` returns nothing; `migrate-firestore-to-sql.mjs` never inserts them either. `resolveSqlSession().isAdmin` is always false; the `'pm'` branch of `product_signal_read` is dead code. Migration maps Firestore role onto `app_user.job_level` (`migrate-firestore-to-sql.mjs:136` — admin → 'VP'), a different concept.

### #13 `rubric` never seeded — **CONFIRMED**

- **Evidence:** `scorecard.rubric_id text NOT NULL REFERENCES rubric(id)` (`04_phase4_scoring_rubrics.sql:57`); no `INSERT INTO rubric` anywhere in `janus/schema/`. Scorecard path FK-violates until rubrics load out of band. Not mentioned in `docs/CUTOVER_SQL.md`.

### #14 `user_identity` only populated when `authUid` exists — **CONFIRMED**

- **Evidence:** `migrate-firestore-to-sql.mjs:151` — `if (u.authUid)` gates the `user_identity` insert. `resolveSqlSession` joins through `user_identity`, so users without `authUid` in the export never get a SQL session; `trySqlDomainWrite` returns `handled: false` forever with only a console.warn. Dual mode appears healthy while writing nothing to SQL.

### #15 `sql` mode still requires Firestore — **CONFIRMED**

- **Evidence:** `routes.ts:1607` — `handleDomainWrite` returns 503 when `!firestoreAdminReady(env)` before any mode check. `PERSISTENCE_MODE=sql` can never run Firestore-free.

### #16 account, contact, pre_call, post_call, task, call_participant have no RLS — **CONFIRMED**

- **Evidence:** `grep "ENABLE ROW LEVEL SECURITY" janus/schema/` hits only: deal (01), activity (02), scorecard + scorecard_line (04), product_signal + coaching_focus + coaching_reflection + coaching_recommendation (05), deal_contact (11). `post_call.analysis/detail` (transcripts, MEDDPICC, ARR) is readable org-wide by any authenticated session. ADR-007 does not explicitly state this is intentional.

---

## Smaller items

| Item | Status | Evidence |
|------|--------|----------|
| LIKE `_` wildcard in org paths | **CONFIRMED** | `08_rls_hardening.sql:42` etc. — `ou.path LIKE current_org_path() \|\| '%'`; `_` in `/org_1/` is a single-char wildcard |
| Migration script skips SSL | **CONFIRMED** | `migrate-firestore-to-sql.mjs:88` — `new Client({ connectionString })` directly, no `pgClientConfig()` |
| Unvalidated enum passthrough | **CONFIRMED** | Migration inserts `d.status \|\| "active"` into `deal_status_enum`; any other value rolls back the whole export |
| Hardcoded Cloud SQL IP | **CONFIRMED** | `postgres-pool.ts` SSL trigger checks `8.231.110.188`; `.dev.vars.example` too |
| `rejectUnauthorized: false` | **CONFIRMED** | `pg-client-config.mjs` — encryption without authentication; needs topology comment |
| RLS test brittle admin count | **CONFIRMED** | `rls_fails_closed.test.mjs` asserts `admin sees all deals === 2` — passes only on empty DB |
| `resolveSqlSession` per write | **CONFIRMED** | `routes.ts:1643` — extra round-trip on every mutation, outside the transaction |
| `readdirSync` unused import | **CONFIRMED** | `apply-janus-schema.mjs:13` |
| `getStorage()` fix riding along | **Noted** | `call-payload-storage.ts` — real fix, unrelated to SQL; fine to keep |
| `store.js` API read switch | **Noted** | `web/domain/store.js` — product-behaviour change; needs separate verification track |

---

## Summary

**16/16 QA items CONFIRMED.** All smaller items confirmed or noted. No rejections.

**Repro artifact:** `worker/scripts/repro-empty-db.mjs` (creates `janus_repro`, runs apply, demonstrates #1).

**Next:** Phase 1 fixes (#1, #3, #4) → re-run repro to confirm fresh install passes.
