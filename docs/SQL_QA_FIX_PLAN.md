# SQL QA Fix Plan — Kimi K3

Branch: **`feat/sql-foundation`** (continue here or `fix/sql-qa-blockers`)

References: [SQL_BUILD_PLAN.md](./SQL_BUILD_PLAN.md) · [CUTOVER_SQL.md](./CUTOVER_SQL.md) · [CLOUDSQL_SECURITY.md](./CLOUDSQL_SECURITY.md)

---

## Kimi K3 mandatory workflow

```
Phase 0  Validate all QA claims (read-only) → docs/SQL_QA_VALIDATION.md
Phase 1  P0 blockers (#1, #3, #4) — fresh install must pass
Phase 2  Security (#2, #16, LIKE paths)
Phase 3  Dual-mode correctness (#5–#7, #12–#14) — before PERSISTENCE_MODE=dual
Phase 4  Outbox reliability (#8–#11)
Phase 5  Cutover gaps (#15, migration hardening)
Phase 6  Smaller items + full gate re-run
```

**Do not write fix code until Phase 0 validation matrix is complete.** Each item must be marked **CONFIRMED / PARTIAL / REJECTED** with `file:line` evidence.

---

## Phase 0 — Validate all QA claims (read-only)

Create **`docs/SQL_QA_VALIDATION.md`** with this matrix filled in:

| # | Claim | Verify at | Pre-check status |
|---|-------|-----------|------------------|
| 1 | Fresh install fails on `11_deal_contact.sql` enum txn | `janus/schema/11_deal_contact.sql:75-87`, `worker/scripts/apply-janus-schema.mjs` | **CONFIRMED** — ADD VALUE + INSERT in one implicit transaction |
| 2 | Read-model views bypass RLS | `janus/schema/12_read_model_views.sql` — no `security_invoker` | **CONFIRMED** |
| 3 | `upsertOrgUnit` poisons transaction | `postgres-repository.ts:322`, `09_id_registry.sql:15` | **CONFIRMED** — `registerId(..., 0)` |
| 4 | Only one scorecard per activity | `04_phase4_scoring_rubrics.sql:70`, `upsertScorecard` | **CONFIRMED** — no `is_current` demotion |
| 5 | deal_contact outbox wrong Firestore doc id | `dual-write-repository.ts:83-97` vs `:71-79` | **CONFIRMED** — `${deal}:${contact}` vs `dealContactId()` |
| 6 | Partial account update destructive | `routes.ts:1652-1665`, `upsertAccount` | **CONFIRMED** |
| 7 | Legacy `applyDomainWrite` bypassed | `routes.ts:1618-1620` | **CONFIRMED** |
| 8 | Outbox rows stranded in `processing` | `claim_outbox_batch` pending-only, `outbox.ts` | **CONFIRMED** |
| 9 | Double-counted outbox attempts | `outbox.ts:88`, `claim_outbox_batch:163` | **CONFIRMED** |
| 10 | `validateJsonbShape` hard-fails → 500 | `routes.ts:1742-1775` | **CONFIRMED** |
| 11 | Unique-index collisions on upserts | activity/pre_call/post_call/deal_contact | **CONFIRMED** |
| 12 | No `app_role` / `user_role` seed | `grep janus/schema` | **CONFIRMED** |
| 13 | No `rubric` seed — scorecard FK fails | scorecard.rubric_id NOT NULL | **CONFIRMED** |
| 14 | `user_identity` only when authUid | `migrate-firestore-to-sql.mjs:151` | **CONFIRMED** |
| 15 | `sql` mode still requires Firestore | `routes.ts:1607` | **CONFIRMED** |
| 16 | account/contact/post_call have no RLS | grep `ENABLE ROW LEVEL SECURITY` | **CONFIRMED** — 7 tables only |

**Also validate:**

| Item | Location | Status |
|------|----------|--------|
| LIKE `_` wildcard in org paths | `08_rls_hardening.sql` | **CONFIRMED** |
| Migration script skips SSL | `migrate-firestore-to-sql.mjs:88` | **CONFIRMED** |
| Unvalidated enum in migration | deal status/stage passthrough | **CONFIRMED** |
| Hardcoded IP SSL trigger | `postgres-pool.ts:56` | **CONFIRMED** |
| RLS test brittle admin count | `rls_fails_closed.test.mjs:126` | **CONFIRMED** |
| `readdirSync` unused | `apply-janus-schema.mjs:13` | **CONFIRMED** |
| store.js API read switch | `web/domain/store.js` | **Not SQL** — separate QA track |

**Phase 0 repro (required):** Drop/recreate empty `janus` DB → run `apply-janus-schema.mjs` → confirm #1 fails **before** fix, passes **after**.

---

## Phase 1 — P0 blockers (install + runtime)

### #1 Enum transaction split

**Problem:** Postgres forbids using a new enum value in the same transaction that added it.

**Fix (preferred):**
- New file `janus/schema/10b_integration_enum.sql` containing only:
  ```sql
  ALTER TYPE integration_provider_enum ADD VALUE IF NOT EXISTS 'firestore_projection';
  ```
- Insert into `PHASE_FILES` in `apply-janus-schema.mjs` **before** `11_deal_contact.sql`
- Run as **separate** `client.query()` call (already one file = one query)
- Remove `ALTER TYPE` from `11_deal_contact.sql` (keep INSERT only)

**Gate:** Fresh DB — first `apply-janus-schema.mjs` run exits 0.

### #3 Remove `registerId` from `upsertOrgUnit`

**Fix:** Delete `registerId(client, "org_unit", row.id, 0)` in `postgres-repository.ts:322`. Org units use text PK; id_registry is not used for org_unit resolution.

**Gate:** Two org units in one transaction succeed.

### #4 Scorecard `is_current` demotion

**Fix:** In `upsertScorecard`, before INSERT:
```sql
UPDATE scorecard SET is_current = false WHERE activity_id = $1 AND is_current = true
```
Explicitly set `is_current = true` on the new row.

**Gate:** Two scorecards (different `rubric_id`) on same activity succeed.

---

## Phase 2 — Security

### #2 View RLS — `security_invoker`

**Fix:** Recreate all five views in `12_read_model_views.sql`:
```sql
CREATE OR REPLACE VIEW v_deal_traction
WITH (security_invoker = true) AS ...
```

**Gate:** New test `janus/tests/view_rls.test.mjs` — `janus_app` with no session vars → `SELECT count(*) FROM v_deal_traction` = 0.

### #16 Missing RLS on sensitive tables

**Decision (document in ADR-007):**
- **Minimum for dual:** Add RLS to `post_call` (transcripts/MEDDPICC)
- **Full:** account, contact, pre_call, task, call_participant

**Gate:** Document decision; if RLS added, extend `rls_fails_closed.test.mjs`.

### LIKE → `starts_with`

**Fix:** Replace `ou.path LIKE current_org_path() || '%'` with `starts_with(ou.path, current_org_path())` in `08_rls_hardening.sql` and all RLS policy files.

---

## Phase 3 — Dual-mode correctness (before `PERSISTENCE_MODE=dual`)

### #5 deal_contact outbox entityId

**Fix in `dual-write-repository.ts`:**
- Import/share `dealContactId(dealId, contactId)` from routes or `worker/src/data/persistence/utils.ts`
- Use for **all** outbox `entityId` values
- `setPrimaryDealContact`: enqueue UPDATE for every contact on deal (demoted rows get `isPrimary: false`)
- `removeDealContact`: delete correct doc id

**Gate:** Unit test — SQL + projected Firestore doc ids match.

### #6 Partial account update

**Fix (pick one):**
- SQL: `ON CONFLICT DO UPDATE SET col = COALESCE(EXCLUDED.col, account.col)` for nullable fields
- Routes: reject partial updates (missing `name`) → `{ handled: false }` Firestore fallback

### #7 Outbox payload parity with legacy Firestore

**Fix:**
- Extract legacy shape builders from `applyDomainWrite` paths
- Use for outbox payloads OR document diff in `docs/SQL_OUTBOX_PARITY.md`
- Minimum: account (all fields), deal (`title` not `name`), timestamps, teamId

### #12 Seed roles

**New:** `janus/schema/13_seed_roles.sql`
- Insert `app_role` rows: admin, pm, se, manager
- Migration + login path assign `user_role`
- Wire `resolveSqlSession().isAdmin` via role join

### #13 Seed rubrics

**New:** `janus/schema/14_seed_rubrics.sql` or SQL export from `worker/scripts/seed-rubrics.mjs`

**Update:** `docs/CUTOVER_SQL.md` prerequisites.

### #14 user_identity coverage

- Migration: backfill identity when only email known (lookup or manual step)
- `verify-db-env.mjs`: warn if `user_identity` count = 0
- `upsertAppUser`: always write identity on verified login

---

## Phase 4 — Outbox reliability

### #8 Stale processing sweep

```sql
UPDATE sync_outbox SET status = 'pending', next_retry_at = now()
WHERE status = 'processing'
  AND last_attempted_at < now() - interval '10 minutes';
```

Run from outbox projector start or partition cron.

### #9 Attempt counter

**Fix:** `outbox.ts:88` — use `claim.attempts` directly (already incremented in SQL). Add comment.

### #10 Shape validation fallback

**Fix:** Catch `ShapeValidationError` → log + return `{ handled: false }`. Audit `shapes.ts` against real analysis/detail JSON.

### #11 Upsert conflict targets

| Method | Fix |
|--------|-----|
| `upsertActivity` | Handle `idempotency_key` unique index |
| `upsertPreCall` / `upsertPostCall` | `ON CONFLICT (activity_id)` |
| `upsertDealContact` | Don't register conflicting public_id on (deal_id, contact_id) hit |

---

## Phase 5 — Cutover

### #15 sql mode without Firestore

**Fix:** `handleDomainWrite` — when `PERSISTENCE_MODE=sql`, require `postgresReady` not `firestoreAdminReady`.

### Migration hardening

- `migrate-firestore-to-sql.mjs`: use `pgClientConfig()`
- Map/validate Firestore status/stage enums before INSERT
- Replace hardcoded IP SSL with `PG_SSL=true` env flag

---

## Phase 6 — Smaller items

- RLS test: scope admin count to `__rls_*` fixtures only
- Cache `resolveSqlSession` on request context
- Remove unused `readdirSync` import
- Comment `rejectUnauthorized: false` — QA public IP only
- **store.js** API read switch: separate verification (not blocking SQL schema)

---

## Final gates (run after all phases)

```bash
node worker/scripts/apply-janus-schema.mjs          # empty DB first run
cd worker && npm run test:janus-smoke
node janus/scripts/manage-partitions.mjs --check
cd worker && npx tsc --noEmit && npm run test:fast
cd worker && npm run test:dual-soak
```

**New tests to add:**
- `janus/tests/view_rls.test.mjs`
- `worker/tests/outbox-deal-contact.test.ts`
- `worker/tests/scorecard-is-current.test.ts`

---

## Suggested commits

1. `fix(janus): schema install enum split + org_unit + scorecard blockers`
2. `fix(janus): security_invoker views + starts_with RLS paths`
3. `fix(worker): deal_contact outbox + account patch + payload parity`
4. `feat(janus): seed roles, rubrics, user_identity gates`
5. `fix(worker): outbox stale sweep, attempts, shape fallback, upsert conflicts`
6. `docs: SQL QA validation matrix + cutover prerequisites`

---

## Kimi K3 handoff prompt

> Read [docs/SQL_QA_FIX_PLAN.md](./SQL_QA_FIX_PLAN.md). Phase 0 first: create [docs/SQL_QA_VALIDATION.md](./SQL_QA_VALIDATION.md) with CONFIRMED/PARTIAL/REJECTED for every item. Reproduce #1 on empty DB. Then fix Phases 1→6 in order; gate each phase before proceeding. Do not commit secrets. Branch: `feat/sql-foundation`.
