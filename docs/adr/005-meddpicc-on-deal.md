# ADR 005 — MEDDPICC on Deal (Opportunity)

| Status | Accepted |
|--------|----------|
| Date | 2026-07-23 |
| Context | ADR 003 left MEDDPICC scope open; UI labeled “Deal qualification” but stored on Account |

## Decision

- **Canonical storage:** `Deal.metadata.meddpicc` (same eight field slots + `lastUpdatedAt`, `completionScore` as Account had).
- **Writes:** Prep and post-call merge signals onto the **deal** referenced by `lifecycle.dealId` / engagement context.
- **Reads:** Account detail uses **selected deal**; dual-read from `Account.metadata.meddpicc` when deal slot empty (`MEDDPICC_ACCOUNT_FALLBACK`) until cleanup.
- **Migration:** One-time copy of account rollup → active **new_business** deal per account; expansion deals start empty; idempotent via `metadata.meddpiccMigratedAt` on account.

## Consequences

- NB and expansion can hold separate qualification; champion `contactId` still references account contacts.
- `Account.metadata.meddpicc` deprecated (fallback only).
- Handoff to expansion does not copy NB MEDDPICC to expansion deal.

## Appendix — manual check (Firestore)

Create `deals/{id}` with `metadata.meddpicc.champion.value` → account detail with that deal selected shows champion in MEDDPICC card.
