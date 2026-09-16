# Review Round 2 — Targeted P0 Fix Report (2026-08-06)

> **Scope:** Consensus P0 fixes from `ULTRA_REVIEW_A.md` + `ULTRA_REVIEW_B.md`  
> **Build:** 2.1.26  
> **Method:** Targeted patches only (not a full 119-item pass)

---

## What was fixed (problem IDs)

| ID | Fix |
|----|-----|
| **ORG-001** | `linkTaskToLifecycle` now uses `resolveActingWriteContext` for `ownerId`/`teamId`/`orgId`; supports proxy via `task.proxySeUserId` or `task.ownerId`. |
| **ORG-014** | Removed hard `!session?.teamId` guard on task import. `resolveActingWriteContext` no longer falls back to manager `session.teamId` when proxying — resolves from SE user doc or org team membership; throws if unresolvable. |
| **DEAL-011** | Deal `allow update` in `firestore.rules` now uses `canWriteDealResource(resource.data)` — parity with read path and `dealContacts` writes. |
| **RBAC-009** | Same deal write parity — secondary SE on account `seTeam` can update deals (MEDDPICC, post-call counters). |
| **JOIN-001** | `call-view.js` loads deal-scoped contacts via `listContactsByDeal` + account hydration when `dealId` known. |
| **CONT-008** | Same call-view path — stakeholder enrichment no longer account-wide when deal context exists. |
| **CONT-002** | Name-only post-call branch uses `findContactByAccountName`; returns null on duplicate names (skip merge). |
| **ACC-010** | Account `allow create` tightened via `canCreateAccount()` — requires admin, manager+org, or SE with org+team membership. |
| **RBAC-001** | Partial — account create no longer `isSignedIn()` wide open; update rules unchanged this round. |
| **ACC-002** | `manage_account_team` in `types.js` aligned with `read_account` — requires `onSeTeamMemberTeam` or segment scope, not bare non-empty `seTeam`. |
| **TEST-002** | Added `test-cross-team-proxy.mjs` — Preethi→Digital IC cross-team write context + `linkTaskToLifecycle` proxy. |
| **TEST-004** | Added `test-firestore-rules-smoke.mjs` — structural rules validation; documents emulator gap. |

**Portal build:** `web/index.html` → **2.1.26**

---

## Test results

All runs from validation loop (iteration 1 — no retries needed):

| Script | Result |
|--------|--------|
| `test-account-deal-fixes.mjs` | **3/3 PASS** |
| `test-deal-motion-nb-expansion.mjs` | **13/13 PASS** |
| `test-activity-deal-association.mjs` | **4/4 PASS** |
| `test-contact-deal-mapping.mjs` | **14/14 PASS** (+ CONT-002 ambiguous name) |
| `test-org-service.mjs` | **43/43 PASS** |
| `test-acting-owner.mjs` | PASS |
| `test-deal-domain.mjs` | PASS |
| `test-deal-e2e.mjs` | PASS |
| `test-firestore-rules-smoke.mjs` (new) | **6/6 PASS** |
| `test-cross-team-proxy.mjs` (new) | **4/4 PASS** |

**Note:** `[dual-write] summaries regenerate failed: fetch failed` is expected in sandbox (no worker).

---

## Remaining P0/P1 deferred (with reason)

| ID | Severity | Reason deferred |
|----|----------|-----------------|
| **DEAL-001** | P1 | Deal `ownerId` vs lifecycle `ownerId` split — product/attribution decision; not a rules bug |
| **DEAL-003** | P1 | Account-scoped `findActiveDeal` — requires parallel-deal product rule |
| **DEAL-008** | P1 | Sync `resolveEngagementDealInput` still defaults `prepType` without `explicitDealType` on direct callers |
| **DEAL-012** | P1 | Manager lifecycle/artifact update rules still owner-only (deals fixed this round) |
| **JOIN-003** | P1 | Dual primary representation across writers — needs transactional constraint |
| **MOT-003 / MOT-005** | P1 | Day-91 `programPhase` flip — needs cron/SF webhook |
| **ORG-004 / ORG-007** | P1 | Deal owner stays primary SE; org-leader blanket account read in rules |
| **ORG-005** | P1 | History email fallback for proxy resolution |
| **TEST-003** | P1 | deal-view UI rendering test not scoped |
| **TEST-004** (residual) | P0 | Firebase rules **emulator** deny/allow matrix still not in CI — structural smoke only |
| **ACC-010** (residual) | P1 | Account **update** still permissive for seTeam/manager paths; create tightened only |
| **RBAC-001** (residual) | P1 | Org-leader read without account guard; contact create still broad |
| **DW-008** | P2 | Non-atomic dual-write ordering |
| **SF-001–SF-013** | — | No Salesforce API integration |

---

## Verdict: ready for manual QA?

**Yes — with emulator caveat.**

The overstated Round 1 claims are addressed for the targeted P0 set. Automated coverage now includes cross-team proxy write context, task import proxy path, deal write/read rules parity (structural), call-view deal-scoped contacts, and ambiguous name-only contact matching.

**Before prod deploy:** run Firebase rules emulator against segment-leader proxy and secondary-SE deal update scenarios (TEST-004 residual). Manual QA rows for Preethi proxy, Vipin task import, and secondary SE post-call deal update are the highest-value checks.
