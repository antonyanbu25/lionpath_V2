# ADR 007 — SQL schema gaps between Janus v9.3 DDL and the live Firestore model

| Status | Accepted |
|--------|----------|
| Date | 2026-08-20 |
| Context | Janus Data Model v9.3 (`janus/schema/00`–`06`) defines 38 PostgreSQL tables, but the running app writes ~40 Firestore collections. Several live collections have no v9.3 target, and several v9.3 capabilities (RLS coverage, shape versioning) are incomplete. |
| Related | [adr/003-account-deal-engagement.md](./003-account-deal-engagement.md), [adr/006-product-insight.md](./006-product-insight.md), [ENTITY_CATALOG.md](../ENTITY_CATALOG.md), [RBAC.md](../RBAC.md), [BUILD_ALIGNMENT.md](../BUILD_ALIGNMENT.md) §6 |

---

## Context

The v9.3 DDL was written from the product spec, not from the running codebase. Before repository code is written against it, the gaps must be decided explicitly — otherwise each engineer invents a local answer and the migration drifts.

Verified gaps (checked against `janus/schema/*.sql` and `worker/src/routes.ts` / `web/domain/*`):

1. **`dealContacts` has no table.** Live behavior: `createDealContact`, `setPrimaryDealContact` (isPrimary promotion), `removeDealContact` in `worker/src/routes.ts`, plus UI in `web/domain/local-store.js` and `firestore-store.js`. This is the Salesforce OpportunityContactRole equivalent — not deferrable.
2. **`lifecycleEvents` has no target.** `addLifecycleEvent` writes an append-only event stream per lifecycle; `web/domain/lifecycle-service.js` calls it on stage changes, prep, post-call, and task events.
3. **RLS covers 8 of 38 tables.** `deal`, `activity`, `scorecard`, `scorecard_line`, `product_signal`, `coaching_focus`, `coaching_reflection`, `coaching_recommendation` have policies. `account`, `contact`, `pre_call`, `post_call`, `task`, `notification` do not.
4. **No `shape_version` on JSONB columns.** `post_call.analysis`, `post_call.detail`, `pre_call.research_brief` are untyped JSONB with no version marker and no writer-side contract.
5. **Read models** (`teamMetrics`, `orgMetrics`, `dealTraction`, `accountRollup`, `seLaunchpad`) are write-time Firestore rollups with no SQL equivalent.
6. **`priceBooks`, `addonPriceBooks`, `arrLines`, `arrOverrides`** feed ARR compute and have no v9.3 tables.
7. **Video/timeline collections** (`videoFacts`, `timelineSegments`, `timelineMarkers`) and call-artifact collections (`momDrafts`, `followUps`, `objections`, `meddpiccDeltas`, `tcDeltas`, `dealSignals`, `dealSummaries`, `accountSummaries`) have no first-class tables.

---

## Decision

### 1. `deal_contact` — new junction table (Phase B blocker)

```sql
CREATE TABLE IF NOT EXISTS deal_contact (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    deal_id bigint NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
    contact_id bigint NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
    role text,                    -- champion | economic_buyer | influencer | ...
    is_primary boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_deal_contact UNIQUE (deal_id, contact_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_contact_primary
    ON deal_contact(deal_id) WHERE is_primary;
```

`setPrimaryDealContact` becomes a transaction: `UPDATE deal_contact SET is_primary = false WHERE deal_id = $1; UPDATE deal_contact SET is_primary = true WHERE deal_id = $1 AND contact_id = $2;` — the partial unique index enforces one primary per deal.

### 2. `lifecycleEvents` — fold into `deal_stage_history` + `activity`

- Stage transitions are already captured automatically by the `trg_deal_stage_history` trigger on `deal` — the manual event stream is redundant for that case.
- Non-stage events (prep created, post-call analyzed, task completed) map to `activity` rows with `activity_type` and a JSONB `description`; the UI timeline reads `activity` + `deal_stage_history` unioned by `occurred_at`/`changed_at`.
- No new table. Migration script maps each `lifecycleEvents` doc to one of the two targets by `event.type`.

### 3. Authorization split — RLS where it exists, app-layer where it does not

Postgres RLS does **not** replace `firestore.rules` (561 lines) in v9.3. The split:

| Layer | Tables | Enforcement |
|-------|--------|-------------|
| Postgres RLS | deal, activity, scorecard, scorecard_line, product_signal, coaching_* | Session vars (`app.user_id`, `app.org_unit_path`, `app.is_admin`) + policies |
| Worker app-layer | account, contact, pre_call, post_call, task, notification | `worker/src/data/scope.ts` request-context checks, same as today's read API |

`post_call` and `task` carry per-user data and currently rely entirely on the worker. Adding RLS policies for them is queued for v9.4; until then every access path must go through the scoped read API — no direct table reads from ad-hoc code.

### 4. JSONB shape contracts — `shape_version` columns (Phase A, done)

`10_shape_version.sql` adds `analysis_shape_version`, `detail_shape_version` to `post_call` and `research_brief_shape_version`, `input_snapshot_shape_version` to `pre_call`, plus `jsonb_typeof = 'object'` CHECK constraints. The worker validator rejects unknown top-level keys per declared version before write.

### 5. Read models — SQL views / materialized views (Phase D)

`teamMetrics`, `orgMetrics`, `dealTraction`, `accountRollup`, `seLaunchpad` become SQL views (or materialized views with scheduled refresh) over `deal`, `activity`, `scorecard`, `product_signal`. Write-time rollup rebuilds (`worker/src/data/read-models/`) are retired at cutover.

### 6. Price book / ARR — Phase B extension tables

`price_book`, `addon_price_book` become plain tables (they are reference data, naturally relational). `arrLines` / `arrOverrides` stay as JSONB on `post_call.detail` until ARR reporting requirements stabilize; `deal.amount*` columns carry the current snapshot.

### 7. Video/timeline and call artifacts — JSONB in `post_call.detail` for now

`videoFacts`, `timelineSegments`, `timelineMarkers`, `momDrafts`, `followUps`, `objections`, `meddpiccDeltas`, `tcDeltas`, `dealSignals`, `dealSummaries`, `accountSummaries` remain inside versioned `post_call.detail` / `post_call.analysis` JSONB. Promotion to tables happens only when a query pattern demands it (per [ENTITY_CATALOG.md](../ENTITY_CATALOG.md) decision rule: own ID iff referenced by FK, queried directly, independently mutated, or separately RBAC-scoped).

---

## Consequences

- Phase B cannot start without the `deal_contact` DDL (shipped in `11_deal_contact.sql`).
- The worker's scoped read API (`worker/src/data/scope.ts`) remains a hard security boundary for un-RLS'd tables; any new direct-SQL path must be reviewed against this ADR.
- JSONB writers must set shape versions; the worker validator is the enforcement point.
- v9.4 schema work is explicitly queued: RLS for `post_call`/`task`/`notification`, plus any JSONB-to-table promotions.
