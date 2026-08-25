# ADR 008 — Firestore → PostgreSQL (Cloud SQL) as system of record

| Status | Proposed |
|--------|----------|
| Date | 2026-08-20 |
| Context | [FULLSTACK_REVIEW_BRIEF.md](../FULLSTACK_REVIEW_BRIEF.md) §5.10 rejects Cloud SQL: "the domain is doc-shaped (Lifecycle as aggregate root with linked artifacts), Firestore already fits and is already built against." The Janus Data Model v9.3 (`janus/schema/`) now exists as a complete relational alternative, and this migration retires the Lifecycle aggregate in favour of a deal-centric relational model. |
| Supersedes | FULLSTACK_REVIEW_BRIEF §5.10 ("Cloud SQL / any relational DB — not needed") |
| Related | [adr/003-account-deal-engagement.md](./003-account-deal-engagement.md), [adr/007-sql-schema-gaps.md](./007-sql-schema-gaps.md), [DOMAIN_MODEL.md](../DOMAIN_MODEL.md) |

---

## Context

The review brief's rejection of a relational DB rests on one premise: **the domain is doc-shaped because Lifecycle is the aggregate root.** That premise no longer holds:

1. **ADR-003 already moved the model to deal-centric.** Lifecycle was kept as a migration bridge ("near term: keep `lifecycles/{id}`; target: fold into Deal"). The SQL model completes ADR-003 rather than contradicting it.
2. **The heaviest data is relational, not document-shaped.** MEDDPICC fields on deal (typed columns with generated `*_surfaced` booleans), scorecard lines with immutable weight snapshots, deal stage history, product signals clustered across deals, ARR lines per call — all are queried by field, joined across entities, and aggregated for dashboards. Firestore answers these with denormalized write-time rollups (`worker/src/data/read-models/`) that must be maintained by hand.
3. **The dual-store status quo is the worst of both.** Legacy localStorage/KV/file history plus Firestore plus read-models means three write paths and no single source of truth. The brief itself calls finishing the cutover "the highest-value Firestore work" — the cutover target is what changed, not the need.
4. **Integrations need transactional outbox semantics.** Salesforce/ChurnZero sync (`sync_outbox` + `claim_outbox_batch()` with SKIP LOCKED) requires transactional enqueue-with-write, which Firestore cannot provide across collections.

## Decision

Adopt **PostgreSQL on Cloud SQL as the system of record**, schema per Janus v9.3 + Phase A extensions (`07`–`11`). Firestore is retained during the dual-write window as a read projection for legacy clients, then deprecated.

### What relational buys

- MEDDPICC/scorecard/stage-history as typed, queryable columns instead of blob extraction
- Joins for manager dashboards replace hand-maintained read-model rebuilds
- `deal_stage_history` trigger gives audit for free (immutable, REVOKEd from app role)
- Transactional outbox for CRM sync; idempotency keys for pipeline re-runs
- RLS at the database layer for the 8 most sensitive tables (deal, activity, scorecard*, product_signal, coaching_*), enforced independent of API bugs

### What we give up (accepted costs)

- **Client-side `onSnapshot` real-time.** Managers lose live listeners; the app shell moves to polling/refresh (SSE or Postgres LISTEN/NOTIFY is a later option). This touches `web/app.js`, not just the store module.
- **Schemaless nested artifacts.** Mitigated by keeping genuinely doc-shaped payloads (`post_call.analysis`, `post_call.detail`, `pre_call.research_brief`) as **versioned JSONB** with writer-side shape contracts (ADR-007 §4).
- **Firestore security-rules coverage for un-RLS'd tables.** `post_call`, `task`, `account`, `contact` are app-layer scoped via `worker/src/data/scope.ts` until v9.4 adds policies (ADR-007 §3).

### What does not change

- Firebase Auth (Google SSO, `@freshworks.com` restriction, worker-side token verification)
- GCS for large call payloads (>200KB) with URI references in SQL
- Worker API shape — web clients keep calling the same endpoints; only the backing store changes

## Migration posture

SQL-primary writes with transactional outbox projection to Firestore during the transition (no independent dual writes). Read flag `PERSISTENCE_MODE=firestore|dual|sql` controls the cutover. Details in the Phase A–E plan; blockers and gates are in `janus/schema/07`–`10` and `janus/tests/`.

## Consequences

- [`FULLSTACK_REVIEW_BRIEF.md`](../FULLSTACK_REVIEW_BRIEF.md) §5.10 is superseded; the brief remains accurate for Auth/Cloud Run/Secret Manager recommendations.
- [`DOMAIN_MODEL.md`](../DOMAIN_MODEL.md) migration runbook now targets SQL as the end state, not Firestore.
- Production deploy anchor `2.1` is untouched until staging cutover is proven (per [BRANCHING.md](../BRANCHING.md)).
