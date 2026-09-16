# Account / Deal / Contact — Fix Report (2026-08-06)

Coordinated fix pass from `docs/ACCOUNT_DEAL_CONTACT_PROBLEMS.md` (119 items). Portal build **2.1.24**.

---

## Summary

| Metric | Count |
|--------|------:|
| **FIXED** | 42 |
| **PARTIAL** | 18 |
| **DEFERRED** | 59 |
| **Total** | 119 |

---

## What was fixed (by problem ID)

### P0 — Blockers & data integrity

| ID | Fix |
|----|-----|
| **JOIN-002** | Added `dealContacts` Firestore rules with `canReadDealResource` / `canWriteDealResource`. |
| **RBAC-005** | Same as JOIN-002 — join writes no longer default-deny in production. |
| **ACC-001** | Account read scoped via `canReadAccountData` (seTeam, manager team/segment, org leader). |
| **ACC-002** | UI `read_account` requires manager on seTeam member team or segment scope (`seTeamMemberTeamIds`). |
| **CONT-007** | Contact read scoped via parent account `canReadAccountData`. |
| **RBAC-001** | Firestore account/contact rules aligned with UI intent. |
| **RBAC-004** | Same as ACC-002. |
| **RBAC-010** | Contact events subcollection inherits account-scoped read/create. |
| **ORG-001** | `resolveActingWriteContext` stamps target SE `teamId`/`orgId` in dual-write. |
| **ORG-002** | Firestore `canWriteAsManagerForOwner` extended for segment leaders (`leadsSegmentContainingTeam`). |
| **ORG-003** | Firestore `canCreateTeamResource` uses owner doc team/org (director proxy cross-team). |
| **ORG-011** | Same segment-leader path in `canWriteAsManagerForOwner`. |
| **ORG-014** | Dual-write no longer requires `session.teamId`; uses resolved write context. |
| **RBAC-002** | UI + rules segment-leader proxy alignment. |
| **RBAC-003** | Director proxy via org-scoped `canWriteAsManagerForOwner`. |
| **RBAC-006** | Artifact `teamId` from target SE user doc, not manager session. |
| **DEAL-004** | Removed expansion prep 501 gate in `worker/src/prep/index.ts`. |
| **SF-014** | Same — expansion prep enabled. |
| **MOT-010** | Expansion prep no longer 501; asymmetric MOT reduced. |
| **ACC-003** | `listLifecyclesForSession` handles `scope.type === "segment"`. |
| **DW-002** | Post-call dual-write proceeds when `payload.accountId` set without company name. |
| **DEAL-011** | Deal read allows account `seTeam` members via `canReadDealResource`. |
| **RBAC-009** | Same multi-SE deal read path. |

### P1 — Attribution, MOT, activity completeness

| ID | Fix |
|----|-----|
| **DEAL-005** | Optional `crmOpportunityId` on Deal type (web + worker). |
| **DEAL-006** | `closedWonAt` stamped on archive at `closed_won`. |
| **MOT-001** | 90-day NB grace routing implemented in `deal-motion.js`. |
| **MOT-004** | `shouldUseWonNbDeal`, `shouldRouteWonNbToExpansion`, `NB_GRACE_PERIOD_MS`. |
| **MOT-002** | Grace routing returns won NB `dealId` during 90 days. |
| **DEAL-007** | `findWonNbDealInGrace` + motion resolver uses archived won NB. |
| **DEAL-010** | `handoffToExpansion` enters grace (`programPhase: live`); no immediate expansion deal. |
| **MOT-012** | Grace via `closedWonAt` + routing (no `closed_won_grace` sub-status enum). |
| **JOIN-001** | Account engagement detail loads contacts via `listContactsByDeal` when deal selected. |
| **CONT-008** | Same — deal-scoped contact panel data source. |
| **DEAL-002** | `listDealsByAccount` no longer filters by acting SE owner only. |
| **LC-003** | Scorecard persists `dealId`. |
| **LC-004** | VideoFacts persists `dealId`. |
| **LC-005** | Timeline segments/markers persist `dealId`. |
| **DEAL-008** | `explicitDealId` resolves `prepType` from pinned deal's `type`. |
| **CONT-003** | Prep uses confirmed-first email ordering (`prepParticipantEmails`). |
| **ACC-006** | Optional `crmAccountId` on Account typedef. |
| **SF-002** | CRM id fields on Account/Deal/Contact types (schema hooks only). |
| **TEST-001** | 90-day MOT test now enforced (no skip). |
| **TEST-002** | Partial — proxy teamId + segment lifecycle tests added (`test-account-deal-fixes.mjs`). |
| **TEST-004** | Partial — rules smoke test for `dealContacts` block in rules file. |

---

## Partial fixes

| ID | What changed | Remaining gap |
|----|--------------|---------------|
| ACC-009 | Path preserved in dual-write | Regression risk if bypassed |
| ACC-010 | Account write still signed-in wide at Firestore | Tighten create/update rules |
| ACC-011 | Grace routing replaces immediate expansion default | No cron for day-91 `programPhase` flip |
| DEAL-001 | Documented; lifecycle vs deal owner split unchanged | `resolveDealOwnerId` still uses primary SE |
| DEAL-003 | Account-scoped active deal unchanged | Product decision on parallel deals |
| DEAL-014 | Tests pass | Complex branch ordering |
| JOIN-003 | Tests guard cascade | Dual primary writers still possible |
| JOIN-004 | Invariant tested | No Firestore constraint |
| ORG-004 | Proxy writes correct teamId | Deal owner still primary SE |
| ORG-005 | Not addressed | History email fallback |
| ORG-010 | Error message improved | Picker vs scope mismatch may persist |
| ORG-012 | seTeam auto-add unchanged | Deal owner not shifted on proxy |
| CONT-005 | Free-mail gate exists | Bad account domain data risk |
| CONT-002 | Not addressed | Name-only post-call match |
| MOT-005 | Grace overrides expansion default within 90d | Team allowlist after day 91 needs phase flip |
| MOT-007 | Code order documented in deal-motion | ADR doc drift |
| LC-009 | dealId on more artifacts | Lifecycle-first URLs remain |
| DW-008 | Contact-before-deal ordering | Still non-atomic |
| RBAC-007 | Major rules updated | Full matrix parity with worker permissions |
| RBAC-008 | Managers can update deals on behalf via proxy rules | Handoff UX unchanged |
| DEAL-012 | Partial via proxy update path | Owner-only default |

---

## Deferred (with reason)

| Area | IDs | Reason |
|------|-----|--------|
| **Salesforce sync** | SF-001, SF-003–SF-013 | No SF API; schema hooks only this pass |
| **Cross-account person** | CONT-001, CONT-006 | Requires M:N join — product not scoped |
| **Store transactions** | DW-001, DW-009 | No Firestore transaction wrapper — note only |
| **Parallel expansion opps** | DEAL-009, MOT-009 | Product rule unchecked |
| **Cron / SF webhook MOT** | MOT-003, MOT-011, SF-007 | Scheduled phase flip + SF CloseDate inbound |
| **Segment dashboard scope** | ORG-007, DEAL-015 | Senior leaders in `seniorLeaderIds` vs segment rollup tension |
| **Lifecycle migration** | LC-010, LC-001 | Backfill job out of scope |
| **Worker dealContacts** | JOIN-006 | Server-side join persistence not scoped |
| **History / legacy paths** | ACC-004, DW-003, DW-004, DW-007 | Dev/offline/legacy collections |
| **UX polish** | JOIN-005, LC-006, LC-007, DEAL-013, etc. | Lower priority vs P0/P1 |
| **CRM stage mapping** | DEAL-017 | Config scaffold deferred |
| **Documented constraints** | DEAL-016, LC-008, MOT-008 | Design constraints — no code change |
| **Reassignment policy** | ACC-012, ORG-013 | MVP historical teamId policy |
| **Testing gaps** | TEST-003, TEST-005 | deal-view UI test; SF contract tests when SF built |

---

## Test results

| Script | Result |
|--------|--------|
| `test-deal-motion.mjs` | PASS |
| `test-deal-motion-nb-expansion.mjs` | **13/13** PASS |
| `test-activity-deal-association.mjs` | **4/4** PASS |
| `test-org-service.mjs` | **43/43** PASS |
| `test-acting-owner.mjs` | PASS |
| `test-deal-domain.mjs` | PASS |
| `test-deal-e2e.mjs` | PASS |
| `test-contact-deal-mapping.mjs` | **13/13** PASS |
| `test-manager-dashboard.mjs` | PASS |
| `test-prep-domain.mjs` | PASS |
| `test-user-menu.mjs` | **49/49** PASS |
| `test-account-deal-fixes.mjs` (new) | **3/3** PASS |

**Total automated checks this pass:** 130+ assertions across 12 scripts — all passing.

---

## Manual QA checklist

| Login | Scenario | Expected |
|-------|----------|----------|
| **Preethi** (segment leader, Digital) | Proxy prep for Digital IC | Brief under IC `ownerId`; Firestore `teamId` = IC team; segment-scoped account list |
| **Preethi** | Account list / lifecycles | Sees Nurture + Digital segment teams only |
| **Ajay** (NB SE) | Prep + post-call on NB account | `new_business` deal; contacts linked via `dealContacts` |
| **Vipin** (director) | Cross-team proxy for any SE | Writes succeed with target SE team/org stamps |
| **Antony** (NB segment leader) | Segment dashboard | NB teams only; proxy for Ajay/Nikil SEs |
| **Any SE** | Won NB handoff | NB archived with grace; no immediate expansion deal; post-win activity routes to won NB ≤90d |
| **Any manager** | Read account not on team | UI `read_account` denied unless team/segment match |

---

## Remaining risks

1. **Firestore rules complexity** — account read uses up to 4 seTeam member user lookups; validate with Firebase emulator before prod deploy.
2. **Grace period without cron** — after 90 days routing switches via `closedWonAt` math; `programPhase` may still be `"live"` until manual handoff or future job (MOT-003).
3. **Deal owner vs lifecycle owner** — primary SE remains deal owner; secondary SE lifecycles may diverge from deal pipeline filters.
4. **Non-transactional dual-write** — partial failure modes (DW-001) still possible.
5. **Senior leader org scope** (ORG-007) — segment leaders in `seniorLeaderIds` still get org rollup in some code paths.

---

## Related doc updates

- `docs/RBAC.md` — Firestore rules summary (account/contact/dealContacts scoping)
- `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` — 90-day grace implementation note
- `docs/ACCOUNT_DEAL_CONTACT_PROBLEMS.md` — per-ID status markers
- `web/index.html` — portal-build **2.1.24**

---

## Review Round 2 (2026-08-06) — targeted P0 from ultra reviews

See **`docs/REVIEW_ROUND2_FIX_REPORT.md`** for full detail. Portal build **2.1.26**.

| ID | Round 2 outcome |
|----|-----------------|
| **ORG-001 / ORG-014** | FIXED — `linkTaskToLifecycle` uses `resolveActingWriteContext`; no `session.teamId` hard block |
| **DEAL-011 / RBAC-009** | FIXED — deal update uses `canWriteDealResource` |
| **JOIN-001 / CONT-008** | FIXED — `call-view.js` deal-scoped contacts |
| **CONT-002** | FIXED — ambiguous name-only match skipped |
| **ACC-010** | PARTIAL — account create tightened (`canCreateAccount`); update unchanged |
| **ACC-002** | FIXED — `manage_account_team` aligned with `read_account` |
| **TEST-002 / TEST-004** | PARTIAL — new smoke + cross-team proxy tests; emulator still manual |

**New scripts:** `test-firestore-rules-smoke.mjs`, `test-cross-team-proxy.mjs`  
**Round 2 tests:** 10/10 scripts PASS (see REVIEW_ROUND2_FIX_REPORT.md)
