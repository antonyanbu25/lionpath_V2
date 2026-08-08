# Data Retention Policy — SE Singha Paathai

**Status:** DRAFT — requires legal/team sign-off before any retention code ships.
**Date:** 2026-08-08
**Owner:** Security architect

## Purpose

No retention or deletion policy exists today. All data written to Firestore
(transcripts, contact PII, call analyses, account/deal records) persists
indefinitely with no automated expiry. This document proposes a retention
schedule and the safe implementation path.

IMPORTANT: No data will be deleted until this policy is signed off and
implemented as a separate, tested task. This document is the FIRST step only.

## Data categories and proposed retention

| Data category | Firestore location | Proposed retention | Rationale | Deletion trigger |
|---|---|---|---|---|
| Call transcripts (raw) | postCalls/{id}.transcript | 24 months from call date | Transcripts contain customer PII; 24mo covers coaching cycle + deal cycle. | TTL on createdAt field. |
| Call analysis artifacts (scorecards, summaries, gaps) | postCalls/{id} sub-fields | 24 months from call date | Derivative of transcript — same lifecycle. | Same TTL as parent postCalls doc. |
| Contact PII (name, email, phone, LinkedIn) | contacts/{id} | Tied to account lifecycle | Contacts exist in context of an account/deal; expire with account, not independently. | Cascade delete when account archived + retention period expires. |
| Account records | accounts/{id} | Life of account + 90 days after archival | Active accounts retained indefinitely. Archived accounts kept 90 days for recovery, then soft-deleted. | Manual archive → 90-day retention → delete. |
| Deal records (MEDDPICC, stage, ARR) | deals/{id} | Life of account + 90 days | Deal data is tied to account lifecycle. | Cascade with account. |
| Lifecycle events | lifecycles/{id}/events | Life of account + 90 days | Activity timeline — part of account record. | Cascade with account. |
| Prep briefs | prepBriefs/{id} | 24 months from creation | Derivative research; may contain prospect PII. | TTL on createdAt field. |
| Tasks | tasks/{id} | Life of account + 90 days | Actionable items tied to lifecycle. | Cascade with account. |
| User records | users/{id} | Indefinite (employee data) | Employee directory — managed by admin, not auto-deleted. | Manual admin deletion only. |
| Team/org structure | teams/{id}, orgs/{id} | Indefinite | Org structure — managed by admin. | Manual admin deletion only. |
| Feedback entries | feedback/{id} | 12 months | Internal feedback; contains SE email. | TTL on createdAt field. |
| Legacy history (file-based on VPS) | /var/lib/se-paathai/history/*.json | As above (match new policy) | Legacy storage — migrate to Firestore, then apply same TTLs. | Migration task (separate). |

## Implementation path (phased — NOT this session)

### Phase 1 (this session): policy document + sign-off
- This document.
- Required sign-offs: team lead, legal/compliance (if applicable).

### Phase 2 (after sign-off): Firestore TTL policies
- Firestore native TTL: add a TTL field (e.g. `retentionExpiresAt`) to documents that
  should auto-expire.
- Set TTL policy via Firebase Console or gcloud:
  `gcloud firestore fields ttl update retentionExpiresAt --collection-group postCalls`
- TTL fires after the timestamp passes — documents are permanently deleted.
- CRITICAL: test on a STAGING project first. Verify no premature deletion.

### Phase 3 (after sign-off): scheduled deletion job for account-cascade
- Accounts don't auto-expire independently — they cascade.
- Implement a Cloud Run Job (not Cloud Function) that:
  1. Finds accounts archived > 90 days ago.
  2. Deletes dependent contacts, deals, lifecycles, events, tasks.
  3. Soft-deletes the account doc.
- Run weekly via Cloud Scheduler.
- CRITICAL: dry-run mode for the first 30 days (log what WOULD be deleted, delete nothing).

### Phase 4 (after sign-off): legacy history migration
- Migrate /var/lib/se-paathai/history/*.json to Firestore.
- Apply same TTLs to migrated data.
- Decommission file-based history (remove HISTORY_FILE_DIR from VPS docker-compose).

## What NOT to do

- Do NOT add TTL policies without sign-off. Premature deletion of call transcripts or
  contact PII is an unrecoverable data-loss event.
- Do NOT delete legacy history files — they are the only copy of some older call data.
- Do NOT auto-delete user records — employees may still be active even if their calls
  are old.

## Sign-off

| Role | Name | Date | Status |
|------|------|------|--------|
| Team lead | ____ | ____ | PENDING |
| Legal/compliance | ____ | ____ | PENDING |
| Security architect | ____ | ____ | PENDING |

## Reference

- docs/adr/006-product-insight.md §"Active retention" — proposes 24-month retention for
  product gaps/verbatims, "Legal review required before verbatim export and retention
  defaults ship."
- docs/FULLSTACK_REVIEW_BRIEF.md §2.3 — data layer parallel stores (legacy + Firestore).
