# Data Retention Policy — SE Singha Paathai

**Status:** ✅ SIGNED OFF — 190-day retention approved (2026-08-08)
**Date:** 2026-08-08
**Owner:** Security architect
**Approved by:** Team lead (Kuttan) — 2026-08-08

## Purpose

No retention or deletion policy existed before this document. All data written to
Firestore (transcripts, contact PII, call analyses, account/deal records) persisted
indefinitely with no automated expiry. This policy sets a **190-day** retention
schedule and the safe implementation path.

IMPORTANT: No data will be deleted until the retention implementation (Phase 2+) is
built and tested. This document is the approved policy; implementation is a separate,
tested task.

## Data categories and retention (190 days)

| Data category | Firestore location | Retention | Deletion trigger |
|---|---|---|---|
| Call transcripts (raw) | postCalls/{id}.transcript | 190 days from call date | TTL on createdAt field. |
| Call analysis artifacts (scorecards, summaries, gaps) | postCalls/{id} sub-fields | 190 days from call date | Same TTL as parent postCalls doc. |
| Contact PII (name, email, phone, LinkedIn) | contacts/{id} | 190 days from last activity | TTL on updatedAt field. |
| Account records | accounts/{id} | 190 days from last activity | TTL on updatedAt field. |
| Deal records (MEDDPICC, stage, ARR) | deals/{id} | 190 days from last activity | TTL on updatedAt field. |
| Lifecycle events | lifecycles/{id}/events | 190 days from last activity | TTL on updatedAt field. |
| Prep briefs | prepBriefs/{id} | 190 days from creation | TTL on createdAt field. |
| Tasks | tasks/{id} | 190 days from last activity | TTL on updatedAt field. |
| User records | users/{id} | Indefinite (employee data) | Manual admin deletion only. |
| Team/org structure | teams/{id}, orgs/{id} | Indefinite | Manual admin deletion only. |
| Feedback entries | feedback/{id} | 190 days | TTL on createdAt field. |
| Legacy history (file-based on VPS) | /var/lib/se-paathai/history/*.json | 190 days (match new policy) | Migration task (separate). |

## Implementation path (phased)

### Phase 1 (DONE): policy document + sign-off
- This document, approved 2026-08-08.

### Phase 2 (next): Firestore TTL policies
- Firestore native TTL: add a TTL field (e.g. `retentionExpiresAt`) to documents that
  should auto-expire.
- Set TTL policy via Firebase Console or gcloud:
  `gcloud firestore fields ttl update retentionExpiresAt --collection-group postCalls`
- TTL fires after the timestamp passes — documents are permanently deleted.
- CRITICAL: test on a STAGING project first. Verify no premature deletion.

### Phase 3 (next): scheduled deletion job for account-cascade
- Accounts don't auto-expire independently — they cascade.
- Implement a Cloud Run Job (not Cloud Function) that:
  1. Finds accounts archived > 190 days ago.
  2. Deletes dependent contacts, deals, lifecycles, events, tasks.
  3. Soft-deletes the account doc.
- Run weekly via Cloud Scheduler.
- CRITICAL: dry-run mode for the first 30 days (log what WOULD be deleted, delete nothing).

### Phase 4 (next): legacy history migration
- Migrate /var/lib/se-paathai/history/*.json to Firestore.
- Apply same TTLs to migrated data.
- Decommission file-based history (remove HISTORY_FILE_DIR from VPS docker-compose).

## What NOT to do

- Do NOT add TTL policies without testing on staging first. Premature deletion of call
  transcripts or contact PII is an unrecoverable data-loss event.
- Do NOT delete legacy history files — they are the only copy of some older call data.
- Do NOT auto-delete user records — employees may still be active even if their calls
  are old.

## Sign-off

| Role | Name | Date | Status |
|------|------|------|--------|
| Team lead | Kuttan | 2026-08-08 | ✅ APPROVED |
| Legal/compliance | (internal tool, no external PII retention requirement) | 2026-08-08 | ✅ N/A |
| Security architect | Gideon | 2026-08-08 | ✅ APPROVED |

## Reference

- docs/adr/006-product-insight.md §"Active retention" — proposes retention for
  product gaps/verbatims.
- docs/FULLSTACK_REVIEW_BRIEF.md §2.3 — data layer parallel stores (legacy + Firestore).
