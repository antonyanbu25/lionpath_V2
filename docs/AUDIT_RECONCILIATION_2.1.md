# Audit reconciliation — branch 2.1

Ground-truth reconciliation of the co-developer audit (119 IDs) plus **ORG-015** and **NEW-001..006**, verified against the `2.1` tree on 2026-08-06. Line numbers below refer to this tree at reconciliation time.

**Legend:** CONFIRMED = reproducible defect; FIXED = already remediated; STALE-REF = real concern, wrong file/line in audit; NOT-APPLICABLE = subsystem absent on 2.1; BY-DESIGN = intentional.

---

## ID inventory (126 rows)

| ID | Bucket | File:line | Note |
|----|--------|-----------|------|
| ACC-001 | CONFIRMED | `firestore.rules:124` | Any signed-in user can read/create/update every account |
| ACC-002 | CONFIRMED | `web/domain/types.js:197` | `read_account`: manager with any non-empty seTeam reads all accounts |
| ACC-003 | NOT-APPLICABLE | — | Requires org-segment model; no `segmentId` / `getSegmentForLeader` on 2.1 |
| ACC-004 | CONFIRMED | `web/domain/account-service.js:321` | `hist_*` / `lc_hist_*` synthetic rows from local history, not Firestore |
| ACC-005 | CONFIRMED | `web/domain/account-service.js` | Domain lookup prefers actor seTeam silently when multiple domain matches |
| ACC-006 | CONFIRMED | — | No `crmAccountId` / SF sync fields (Stage 8) |
| ACC-007 | CONFIRMED | `web/domain/meddpicc-qualify-service.js` | Account-level MEDDPICC fallback conflates parallel deals |
| ACC-008 | CONFIRMED | `firestore.rules:132` | Any signed-in user reads/creates/updates all contacts (PII) |
| ACC-009 | CONFIRMED | `web/domain/dual-write.js:139` | Explicit `accountId` honoured in prep path (partial fix; regression test missing) |
| ACC-010 | CONFIRMED | `firestore.rules:124-126` | `metadata.engagementOverride` unprotected at rules layer |
| ACC-011 | CONFIRMED | `web/domain/deal-service.js:648` | `programPhase: expansion` only via manual `handoffToExpansion`; no 90-day sweep |
| ACC-012 | CONFIRMED | — | IC team moves leave historical `teamId`; manager queries hide legacy (Stage 7) |
| DEAL-001 | CONFIRMED | `web/domain/deal-motion.js:164` | Deal owner = `account.primarySeUserId \|\| actorId` |
| DEAL-002 | CONFIRMED | `web/domain/account-service.js:699` | `listDealsByAccount` filtered by owner, not seTeam |
| DEAL-003 | CONFIRMED | `web/domain/deal-service.js` | No account-level `activeDealByType` pointer for multi-SE convergence |
| DEAL-004 | CONFIRMED | `worker/src/prep/index.ts:344` | `prepType === expansion` throws 501 |
| DEAL-005 | CONFIRMED | — | No SF `wonAt` inbound; portal never stamps `wonAt` (Stage 3/8) |
| DEAL-006 | CONFIRMED | `web/domain/deal-service.js:444` | `archiveDeal` sets status/stage only; no `wonAt` |
| DEAL-007 | CONFIRMED | `web/domain/deal-service.js` | `findActiveDeal` excludes grace-period won NB deals |
| DEAL-008 | CONFIRMED | `web/domain/deal-motion.js:82` | Pinned `explicitDealId` guesses prepType without loading deal |
| DEAL-009 | CONFIRMED | `web/domain/deal-service.js` | Single active expansion deal reused; no parallel deals |
| DEAL-010 | CONFIRMED | `web/domain/deal-service.js:679` | Handoff archives NB immediately; no grace timer |
| DEAL-011 | CONFIRMED | `firestore.rules:145` | Secondary SE cannot read primary-owned deal (no seTeam on deal) |
| DEAL-012 | CONFIRMED | `web/domain/types.js:204` | Managers cannot update deals via client `can()` |
| DEAL-013 | STALE-REF | — | Audit "Tier-3 recovery" in `call-view.js` not present on 2.1 |
| DEAL-014 | CONFIRMED | `web/domain/lifecycle-service.js` | `createNewDeal` branch ordering fragile vs lifecycle reuse |
| DEAL-015 | NOT-APPLICABLE | — | Audit cites segment-scoped deal queries; no segment model on 2.1 |
| DEAL-016 | CONFIRMED | `web/domain/deal-service.js:679` | Handoff must not reparent artifact dealIds (invariant) |
| DEAL-017 | CONFIRMED | — | No SF stage mapping config (Stage 8) |
| DEAL-018 | CONFIRMED | `web/domain/dual-write.js:173` | Prep/post asymmetry on teamId stamping |
| ORG-001 | CONFIRMED | `web/domain/dual-write.js:173` vs `:234` | Prep uses session teamId; post-call uses owner profile |
| ORG-002 | NOT-APPLICABLE | — | Segment-based org visibility never built |
| ORG-003 | NOT-APPLICABLE | — | Segment proxy model never built |
| ORG-004 | BY-DESIGN | `web/domain/deal-motion.js:164` | Shared-account deals owned by primary SE; secondary via lifecycle |
| ORG-005 | CONFIRMED | `web/domain/dual-write.js:768` | Task link still stamps `session.teamId` |
| ORG-006 | CONFIRMED | — | Director without org leader flag gets team scope only |
| ORG-007 | NOT-APPLICABLE | — | Segment leader scope never built |
| ORG-008 | NOT-APPLICABLE | — | Segment routing never built |
| ORG-009 | CONFIRMED | `web/domain/org-service.js:99` | Non-leader manager falls through to `{ type: "team" }` |
| ORG-010 | STALE-REF | — | No `acting-owner.js` or `create_on_behalf`; proxy never half-built |
| ORG-011 | NOT-APPLICABLE | — | Segment assignment never built |
| ORG-012 | BY-DESIGN | `web/domain/deal-motion.js:164` | `primarySeUserId` as deal owner is intentional shared-account model |
| ORG-013 | STALE-REF | — | Audit line refs obsolete; no Tier-3 recovery path |
| ORG-014 | CONFIRMED | `web/domain/dual-write.js:127` | Prep aborts when `!session.teamId` even if owner has teamId |
| ORG-015 | CONFIRMED | `web/domain/org-service.js:99` | Manager not on `seniorLeaderIds` silently downgraded to empty team scope |
| JOIN-001 | CONFIRMED | `web/domain/firestore-store.js:422` | `listContactsByDeal` returns join rows; unused by UI |
| JOIN-002 | CONFIRMED | `firestore.rules` (no match) + `deal-service.js:195` | No rules for `dealContacts`; silent catch on write |
| JOIN-003 | CONFIRMED | `web/domain/deal-service.js:177` | Primary pointer and join rows not atomic |
| JOIN-004 | CONFIRMED | `web/domain/deal-service.js:187` | No validation that contact.accountId === deal.accountId |
| JOIN-005 | CONFIRMED | `web/deal-view.js` | Join role/isPrimary not rendered in contact panel |
| JOIN-006 | CONFIRMED | `worker/src/data/repositories/deals.ts` | Worker repos read-only; browser sole CRM writer |
| RBAC-001 | CONFIRMED | `firestore.rules:124` | Accounts open to all authenticated users |
| RBAC-002 | STALE-REF | — | Audit framed as UI-allows/rules-reject proxy; proxy never existed |
| RBAC-003 | STALE-REF | — | Same as RBAC-002; no manager create_on_behalf |
| RBAC-004 | CONFIRMED | `web/domain/types.js:197` | Manager read_account too broad vs rules intent |
| RBAC-005 | CONFIRMED | `deal-service.js:195` | Join writes fail silently under default-deny rules |
| RBAC-006 | CONFIRMED | `web/domain/dual-write.js:173` | Write scope from session not owner profile |
| RBAC-007 | CONFIRMED | `web/domain/types.js:204` | UI `can()` denies manager writes (consistent; no proxy) |
| RBAC-008 | CONFIRMED | `web/domain/types.js:204` | Manager deal stage changes blocked client-side |
| RBAC-009 | CONFIRMED | `firestore.rules:145` | Deal read requires owner/team match; blocks secondary SE |
| RBAC-010 | CONFIRMED | `firestore.rules:137` | Contact events readable org-wide |
| MOT-001 | STALE-REF | — | Audit cites `test-deal-motion-nb-expansion.mjs` which does not exist |
| MOT-002 | STALE-REF | — | Same phantom test file |
| MOT-003 | CONFIRMED | `web/domain/deal-service.js:648` | No automatic programPhase transition after closed-won |
| MOT-004 | STALE-REF | — | Phantom test guardrail absent |
| MOT-005 | CONFIRMED | `web/domain/deal-motion.js:133` | Actor-team routing for NB teams |
| MOT-006 | CONFIRMED | `web/domain/deal-motion.js:32` | Allowlist fetch failure cached as empty for session |
| MOT-007 | CONFIRMED | `docs/adr/003-account-deal-engagement.md` | ADR order drift vs `resolveEngagementDealInput` |
| MOT-008 | CONFIRMED | `web/account-view.js` | Engagement override lacks "future only" UI copy |
| MOT-009 | CONFIRMED | `web/domain/deal-motion.js:125` | programPhase check precedes allowlist (order issue) |
| MOT-010 | CONFIRMED | `worker/src/prep/index.ts:344` | Expansion prep blocked at worker |
| MOT-011 | CONFIRMED | — | No SF webhook for wonAt (Stage 8 inbound seam) |
| MOT-012 | CONFIRMED | `web/domain/deal-motion.js` | No grace-period source in DealMotionSource union |
| DW-001 | CONFIRMED | `web/domain/dual-write.js` | Client-owned spine; no transactional commit |
| DW-002 | CONFIRMED | `web/domain/dual-write.js:260` | Post-call without company returns null (silent skip) |
| DW-003 | CONFIRMED | `firestore.rules` | Legacy uid-scoped prep/post collections |
| DW-004 | CONFIRMED | `web/domain/dual-write.js` | Three parallel history stores (localStorage/KV/Firestore) |
| DW-005 | CONFIRMED | `worker/src/prep` | Pass 0 resolve outcome not fed back as telemetry |
| DW-006 | CONFIRMED | `worker/src/data/repositories/accounts.ts` | No server write path for accounts |
| DW-007 | CONFIRMED | `web/domain/account-service.js:321` | Synthetic hist_* rows indistinguishable in UI |
| DW-008 | CONFIRMED | `web/domain/dual-write.js` | Dual-write ordering non-atomic |
| DW-009 | CONFIRMED | `worker/src/data/repositories/` | Browser sole writer of CRM entities |
| LC-001 | CONFIRMED | `web/domain/lifecycle-service.js` | Lifecycle uniqueness (ownerId, accountId) by design; convergence gap |
| LC-002 | CONFIRMED | `web/domain/lifecycle-service.js` | Legacy lifecycles missing dealId backfill |
| LC-003 | CONFIRMED | — | scorecards/videoFacts lack dealId (Stage 7) |
| LC-004 | CONFIRMED | — | timelineSegments lack dealId (Stage 7) |
| LC-005 | CONFIRMED | — | momDrafts lack dealId (Stage 7) |
| LC-006 | CONFIRMED | `web/domain/account-service.js:1514` | N+1 technicalCommit fetch per deal |
| LC-007 | CONFIRMED | `web/domain/account-service.js:1536` | N+1 deal signal fetch per deal |
| LC-008 | CONFIRMED | — | Invariant: never mutate artifact dealId on motion |
| LC-009 | CONFIRMED | `web/domain/lifecycle-service.js` | findActiveLifecycle fallback wrong deal lens |
| LC-010 | CONFIRMED | — | dealId not required on new lifecycles |
| LC-011 | CONFIRMED | `web/domain/lifecycle-service.js` | Multi-SE same dealId convergence missing |
| CONT-001 | CONFIRMED | — | One human at two accounts; no persons collection (Stage 7) |
| CONT-002 | CONFIRMED | `web/domain/contact-service.js:613` | Name-only dedupe |
| CONT-003 | CONFIRMED | `web/precall.js` | Prep primary = first email; post-call uses participants |
| CONT-004 | CONFIRMED | — | No crmContactId (Stage 8) |
| CONT-005 | CONFIRMED | `web/domain/contact-service.js` | Free-mail domain gating partial; bad domain values persist |
| CONT-006 | CONFIRMED | — | Duplicate contacts across accounts (Stage 7 persons) |
| CONT-007 | CONFIRMED | `firestore.rules:132` | Contacts org-wide readable |
| CONT-008 | CONFIRMED | `web/deal-view.js` | Deal panel uses account-wide contacts |
| SF-001 | CONFIRMED | — | No CRM sync layer (Stage 8) |
| SF-002 | CONFIRMED | — | No external id fields |
| SF-003 | CONFIRMED | — | No crmOutbox |
| SF-004 | CONFIRMED | — | No PrepBrief→Task mapper |
| SF-005 | CONFIRMED | `worker/src/prep/index.ts` | No crm_sync_candidate structured log |
| SF-006 | CONFIRMED | — | No PostCall→Event mapper |
| SF-007 | CONFIRMED | — | No inbound webhook |
| SF-008 | CONFIRMED | — | No dealContacts→OCR mapper |
| SF-009 | CONFIRMED | — | No MeddpiccDelta→Opp mapper |
| SF-010 | CONFIRMED | — | Artifacts lack dealId for SF linkage |
| SF-011 | CONFIRMED | — | No outbox dequeue |
| SF-012 | CONFIRMED | `web/domain/field-masks.ts` | arrActual write guard incomplete |
| SF-013 | CONFIRMED | `worker/src/prep` | Pass 0 lacks crm id fields |
| SF-014 | CONFIRMED | `worker/src/prep/index.ts:344` | Expansion prep 501 |
| TEST-001 | STALE-REF | — | Audit cites phantom `test-deal-motion-nb-expansion.mjs` |
| TEST-002 | CONFIRMED | — | No proxy E2E (descope → negative test in Stage 2) |
| TEST-003 | CONFIRMED | `web/scripts/test-deal-view.mjs` | No two-deals disjoint contact panel test |
| TEST-004 | CONFIRMED | `firebase.json:1` | No emulators; no rules unit tests |
| TEST-005 | CONFIRMED | — | No SF mapping golden fixtures |
| NEW-001 | CONFIRMED | `web/domain/seed-dev.js:502` + imports in `dual-write.js:226` | Dev seed in production import graph |
| NEW-002 | CONFIRMED | `web/package.json:9` | ~45 orphan test scripts not in npm test chain |
| NEW-003 | CONFIRMED | `web/package.json:9` | Single && chain hides downstream failures |
| NEW-004 | CONFIRMED | `firestore.rules:18-39` | Rules evaluate authIndex→users→orgs (3 extra reads) |
| NEW-005 | CONFIRMED | `firestore-store.js:402` | getDoc before every createDealContact |
| NEW-006 | CONFIRMED | `org-service.js:121` | Sequential getTeam/getUser loops for org scope |

---

## Descoped (NOT-APPLICABLE)

| ID | Reason |
|----|--------|
| ACC-003 | Requires org-segment model (`segmentId`, `getSegmentForLeader`) — never built on 2.1 |
| ORG-002 | Segment-based visibility |
| ORG-003 | Segment proxy |
| ORG-007 | Segment leader scope |
| ORG-008 | Segment routing |
| ORG-011 | Segment assignment |
| RBAC-002 | Audit assumes half-built proxy UI; feature never existed |
| DEAL-015 | Audit cites segment-scoped deal query; no segments on 2.1 (query perf tracked as LC-006/007 in Stage 6) |

**STALE-REF (not descoped, but audit pointer wrong):** ORG-010, ORG-013, RBAC-003, MOT-001, MOT-002, MOT-004, TEST-001, DEAL-013.

---

## Revised priority ordering

### P0 — security + data integrity (Stages 1–2)
1. JOIN-002 / RBAC-005 — dealContacts rules + stop silent join failures
2. ACC-001, ACC-008, ACC-010, CONT-007, RBAC-001, RBAC-004, RBAC-010 — scoped Firestore reads
3. ORG-001 / DEAL-018 / RBAC-006 — unified `resolveWriteScope`
4. NEW-001 — remove dev seed from production bundle
5. ORG-015 — explicit `{ type: "none" }` for misconfigured managers

### P1 — deal motion correctness (Stage 3)
6. DEAL-006, DEAL-010, MOT-003, ACC-011 — wonAt + 90-day grace + sweep job
7. DEAL-008, MOT-006, MOT-007, MOT-012 — motion resolution honesty
8. LC-008 / DEAL-016 — never mutate artifact dealIds

### P2 — product gaps (Stages 4–5)
9. DEAL-004, SF-014, MOT-010 — expansion prep
10. JOIN-001, CONT-008, JOIN-005 — deal-scoped contact hydration
11. DEAL-009, ACC-007 — parallel expansion deals + per-deal MEDDPICC

### P3 — performance (Stage 6)
12. NEW-006, LC-006, LC-007, ACC-004, DW-007 — fan-out elimination + load budget
13. NEW-004 — custom claims for rules (with get() fallback)

### Deferred (Stages 7–9)
- Server-side CRM spine (DW-*, JOIN-006, DEAL-011/012, LC-002–005, CONT-001/006)
- Salesforce scaffold (SF-*, ACC-006, DEAL-017)
- Test suite consolidation (NEW-002, NEW-003, TEST-002)

---

## Contradictions vs audit prompt

| Topic | Prompt said | Code reality |
|-------|-------------|--------------|
| ORG-015 in Stage 3 | Handle ORG-015 in Stage 3 | Stage 2 coverage map lists ORG-015; fixed in write-scope stage |
| DEAL-015 | Descoped (segments) vs Stage 6 (query) | Segment query N/A; perf N+1s tracked under LC-006/007 |
| `canCreateTeamResource` | Referenced in audit | Never existed; use `canReadTeamResource` / `canWriteOwnResource` |
| Manager proxy | Half-built | Never built; Stage 2 Option A descopes |
| `test-deal-motion-nb-expansion.mjs` | Skipped 90-day test | File does not exist; replaced by `test-deal-motion-grace.mjs` in Stage 3 |

---

## Stage closure map

| Stage | IDs closed |
|-------|------------|
| 1 | JOIN-002, RBAC-005, ACC-001, ACC-002, ACC-008, ACC-010, CONT-007, RBAC-001, RBAC-004, RBAC-010, TEST-004 |
| 2 | ORG-001, ORG-005, ORG-006, ORG-009, ORG-012, ORG-013, ORG-014, ORG-015, RBAC-006, RBAC-007, DEAL-018, NEW-001 |
| 3 | DEAL-005, DEAL-006, DEAL-007, DEAL-008, DEAL-010, DEAL-016, ACC-011, MOT-001..008, MOT-011, MOT-012, LC-008, TEST-001 |
| 4 | DEAL-004, DEAL-009, SF-014, MOT-010, ACC-007, MOT-009 |
| 5 | JOIN-001, JOIN-003, JOIN-004, JOIN-005, CONT-002, CONT-003, CONT-008, TEST-003, NEW-005 |
| 6 | NEW-004, NEW-006, ACC-004, DW-007, LC-006, LC-007 |
