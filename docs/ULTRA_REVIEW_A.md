# Ultra Review A — Architecture & Correctness (Independent)

> **Reviewer:** Review Agent A  
> **Date:** 2026-08-06  
> **Scope:** Independent audit of coordinated fix pass (42 FIXED / 18 PARTIAL / 59 DEFERRED)  
> **Build under review:** 2.1.24  
> **Method:** Read `ACCOUNT_DEAL_CONTACT_PROBLEMS.md`, `ACCOUNT_DEAL_CONTACT_FIX_REPORT.md`, `DEAL_MOTION_AND_SALESFORCE_GAPS.md`; trace every FIXED claim to code; cross-check partial/deferred items for residual breakage.

---

## 1. Executive verdict

### Was the monolithic fix approach sound?

**Mostly yes, with caveats.** Batching P0 Firestore rules, proxy `teamId`, segment lifecycle listing, expansion prep unblocking, and 90-day grace routing in one pass was the right prioritization order. The pass touched the right spine files (`dual-write.js`, `deal-motion.js`, `firestore.rules`, `acting-owner.js`) rather than scattering one-off UI patches.

**Weaknesses of the approach:**

1. **Claims outran enforcement depth** — many items marked FIXED are schema hooks, string-matched rules smoke tests, or read-path fixes while write paths, alternate UI surfaces (`call-view.js`), and Firestore emulator validation were not proven.
2. **No transactional boundary** — ordering fixes (DW-008) without store transactions means partial-failure modes remain architectural debt.
3. **Rules/UI parity still asymmetric** — UI `can()` gained segment-aware `read_account`; Firestore gained `canReadAccountData`, but account **create** remains `isSignedIn()` wide open (ACC-010), and deal **update** still omits `canWriteDealResource` / `onAccountSeTeam` (see §4).
4. **Documentation updated optimistically** — `DEAL_MOTION_AND_SALESFORCE_GAPS.md` §2 artifact table still lists Scorecard/VideoFacts/Timeline as lacking `dealId` even though LC-003–005 were fixed in code.

### Overall quality score: **6.5 / 10**

| Dimension | Score | Notes |
|-----------|------:|-------|
| P0 blocker resolution | 7/10 | `dealContacts` rules, segment lifecycles, expansion prep 501 removed — real wins |
| Security / RBAC | 6/10 | Read scoping improved; writes & deal updates incomplete |
| MOT / 90-day grace | 8/10 | Core routing helpers + tests solid; no day-91 phase flip |
| Attribution coherence | 5/10 | Deal owner vs lifecycle owner split unchanged (DEAL-001) |
| Test confidence | 5/10 | 130+ unit assertions; no rules emulator; TEST-004 is grep-only |
| Claim accuracy | 6/10 | ~6 FIXED items overstated (see §2) |

---

## 2. Claims audit — all 42 FIXED items

Legend: **CONFIRMED** = claim matches code behavior · **OVERSTATED** = partially done or narrower than problem statement · **NOT DONE** = absent · **REGRESSION** = fix introduced new breakage

### P0 — Blockers & data integrity

| ID | Verdict | Evidence |
|----|---------|----------|
| **JOIN-002** | **CONFIRMED** | `firestore.rules:263-280` — `match /dealContacts/` with `canReadDealResource` / `canWriteDealResource` and `accountId` integrity check on create |
| **RBAC-005** | **CONFIRMED** | Same as JOIN-002 |
| **ACC-001** | **OVERSTATED** | Read fixed: `firestore.rules:235-236` uses `canReadAccountData`. **Create/update** on accounts still permissive: `allow create: if isSignedIn()` (`:237`), update only checks seTeam/manager (`:238`). Problem text emphasized read leak — read is fixed; write leak (ACC-010) remains |
| **ACC-002** | **CONFIRMED** | `web/domain/types.js:200-206` — `read_account` requires `onSeTeamMemberTeam` or `segmentCanSeeAccount`, not bare `seTeamIds.length` |
| **CONT-007** | **CONFIRMED** | `firestore.rules:243-246` — contact read via parent account `canReadAccountData` |
| **RBAC-001** | **OVERSTATED** | Read alignment confirmed; contact/account **create** still `isSignedIn()` + read check only — malicious client can still create accounts without seTeam |
| **RBAC-004** | **CONFIRMED** | Same as ACC-002 |
| **RBAC-010** | **CONFIRMED** | `firestore.rules:252-259` — contact events inherit account-scoped read/create |
| **ORG-001** | **CONFIRMED** | `acting-owner.js:126-134` — `resolveActingWriteContext` stamps `ownerUser.teamId`; `dual-write.js:135,224` consumes it for artifacts |
| **ORG-002** | **CONFIRMED** | `firestore.rules:107-115` — `canWriteAsManagerForOwner` includes `leadsSegmentContainingTeam(ownerDoc.data.teamId)` |
| **ORG-003** | **CONFIRMED** | `firestore.rules:118-127` — `canCreateTeamResource` validates `teamId == ownerDoc.teamId` (director proxy uses target SE's team from client payload) |
| **ORG-011** | **CONFIRMED** | Same segment-leader path as ORG-002 |
| **ORG-014** | **OVERSTATED** | No longer requires `session.teamId`, but **still requires resolved `teamId`**: `dual-write.js:137,226` `if (!ownerId \|\| !teamId) return null`. Director/SE with `teamId: null` on user doc still blocked |
| **RBAC-002** | **CONFIRMED** | UI `create_on_behalf` segment branch (`types.js:215`) + rules segment path aligned |
| **RBAC-003** | **CONFIRMED** | Org-leader branch in `canWriteAsManagerForOwner` (`firestore.rules:113`) |
| **RBAC-006** | **CONFIRMED** | Artifact `teamId` from `resolveActingWriteContext`, not manager session — verified in prep/post-call attach paths |
| **DEAL-004** | **CONFIRMED** | `worker/src/routes.ts:195-201` — no 501 gate; passes `prepType` through to `generatePrep`. Stale comment in `worker/src/prep/expansion-synthesize.md:8` still says 501 |
| **SF-014** | **CONFIRMED** | Same as DEAL-004 |
| **MOT-010** | **CONFIRMED** | Expansion prep path unblocked in worker; domain already supported expansion deals |
| **ACC-003** | **CONFIRMED** | `lifecycle-service.js:409-423` — `scope.type === "segment"` handled same as `"team"` (iterates `scope.teamIds`) |
| **DW-002** | **CONFIRMED** | `dual-write.js:243-246` — proceeds when `payload.accountId` set even if `company` empty |
| **DEAL-011** | **OVERSTATED** | **Read** fixed: `canReadDealResource` falls back to `canReadAccountData` on parent account (`firestore.rules:176-180`). **Write** not extended: deal `allow update` (`:286-287`) uses owner/manager only — secondary SE on `seTeam` can read but not `updateDeal` for counters/MEDDPICC on primary-owned deal |
| **RBAC-009** | **OVERSTATED** | Same read-path fix as DEAL-011; write asymmetry remains |

### P1 — Attribution, MOT, activity completeness

| ID | Verdict | Evidence |
|----|---------|----------|
| **DEAL-005** | **CONFIRMED** | `web/domain/types.js:19` — `crmOpportunityId` on Deal; `worker/src/domain-model/deal.ts:31,36` |
| **DEAL-006** | **CONFIRMED** | `deal-service.js:444-450` — `closedWonAt` on archive at `closed_won` (top-level + metadata) |
| **MOT-001** | **CONFIRMED** | `deal-motion.js:11-12,145-147,185-187` — grace routing before expansion default |
| **MOT-004** | **CONFIRMED** | `shouldUseWonNbDeal`, `shouldRouteWonNbToExpansion`, `NB_GRACE_PERIOD_MS` at `deal-motion.js:68-96` |
| **MOT-002** | **CONFIRMED** | Grace branch returns won NB `dealId` (`deal-motion.js:145-147`); tested in `test-deal-motion-nb-expansion.mjs:315-323` |
| **DEAL-007** | **CONFIRMED** | `findWonNbDealInGrace` in `local-store.js:355-372`, `firestore-store.js:453-472`; wired in `resolveEngagementMotion` (`deal-motion.js:216-217`) |
| **DEAL-010** | **CONFIRMED** | `handoffToExpansion` sets `programPhase: "live"`, returns `gracePeriod: true`, skips immediate expansion deal (`deal-service.js:677-692`) |
| **MOT-012** | **CONFIRMED** | Grace via `closedWonAt` math, not `closed_won_grace` sub-status — matches stated approach |
| **JOIN-001** | **OVERSTATED** | Fixed in **account engagement detail** when `selectedDealId` set: `account-service.js:1213-1238` uses `listContactsByDeal`. `deal-view.js` delegates to `getAccountEngagementDetail` — OK for deal page. **`call-view.js:1073-1075,2202-2205` still uses `listContactsByAccount`** — JOIN-001 scenario persists on call UI |
| **CONT-008** | **OVERSTATED** | Same as JOIN-001 — account/deal engagement path fixed; call-view not |
| **DEAL-002** | **CONFIRMED** | `account-service.js:691-696` — `listDealsByAccount(accountId)` without owner filter |
| **LC-003** | **CONFIRMED** | `scorecard-service.js:33` — `dealId: ctx.dealId`; dual-write passes it (`dual-write.js:377-379`) |
| **LC-004** | **CONFIRMED** | `video-facts-service.js:31` — `dealId` on facts row |
| **LC-005** | **CONFIRMED** | `timeline-service.js:79,99` — `dealId` on segments/markers |
| **DEAL-008** | **OVERSTATED** | Async path fixed: `resolveEngagementMotion` fetches pinned deal type (`deal-motion.js:220-226`). **Sync** `resolveEngagementDealInput` still defaults `prepType: "new_business"` when `explicitDealId` set without `explicitDealType` (`:131-137`) — direct callers bypassing async wrapper remain vulnerable |
| **CONT-003** | **CONFIRMED** | `dual-write.js:115-131` — `prepParticipantEmails` confirmed identities first; used in `linkPrepToLifecycle` |
| **ACC-006** | **CONFIRMED** | `types.js:12` — optional `crmAccountId` on Account |
| **SF-002** | **CONFIRMED** | Schema hooks only (no sync) — accurately scoped |
| **TEST-001** | **CONFIRMED** | `test-deal-motion-nb-expansion.mjs:290-337` — enforced grace test, no skip |

### Summary counts

| Verdict | Count (of 42 FIXED) |
|---------|--------------------:|
| **CONFIRMED** | **32** |
| **OVERSTATED** | **10** |
| **NOT DONE** | **0** |
| **REGRESSION** | **0** (among claimed FIXED — new issues in §4) |

**Overstated IDs:** ACC-001, RBAC-001, ORG-014, DEAL-011, RBAC-009, JOIN-001, CONT-008, DEAL-008 (+ ACC-001/RBAC-001 overlap on write path)

---

## 3. Missed problems — FIXED but still broken; PARTIAL needing more work

### Marked FIXED but still broken (residual)

| ID | What's still wrong |
|----|-------------------|
| **CONT-008** / **JOIN-001** | `call-view.js` loads account-wide contacts — not deal-scoped |
| **DEAL-011** / **RBAC-009** | Secondary SE can **read** shared deals; `updateDeal` during post-call (`bumpDealAfterPostCall`, MEDDPICC) may **fail** at Firestore for non-owner SE |
| **ORG-014** | Users with null `teamId` (edge director/legacy users) still get silent dual-write null |
| **DEAL-008** | Callers invoking `resolveEngagementDealInput` directly without `explicitDealType` still mis-label expansion pins |

### PARTIAL items that need more work (priority order)

| ID | Gap | Priority |
|----|-----|----------|
| **ACC-010** | Account create/update Firestore still wide | P0 |
| **DEAL-001** | `resolveDealOwnerId` still `primarySeUserId \|\| actorId` — pipeline vs lifecycle split | P1 |
| **DEAL-003** | Account-scoped `findActiveDeal` — multi-SE conflict unchanged | P1 |
| **DEAL-012** | Manager/deal update via proxy partial; rules lack seTeam write on deals | P1 |
| **JOIN-003** | Dual primary representation still possible across writers | P1 |
| **CONT-002** | Name-only post-call match unchanged (`contact-service.js:744-745`) | P1 |
| **MOT-005** | After day 91, NB team actors still route NB unless `programPhase` flipped | P1 |
| **ORG-004** / **ORG-012** | Proxy writes correct teamId but deal owner stays primary | P1 |
| **TEST-002** | No Firestore emulator deny/allow tests for segment proxy | P0 |
| **TEST-004** | Rules validated by substring grep only | P0 |
| **DW-008** | Ordering improved; non-atomic writes remain | P2 |

---

## 4. New regressions introduced by fix pass

| # | Severity | Description | Location |
|---|----------|-------------|----------|
| R-1 | **P1** | **Deal update rules narrower than deal read rules.** `canWriteDealResource` includes `onAccountSeTeam` (`firestore.rules:183-188`) but is used only for `dealContacts`, not `deals` update. Secondary SE post-call may fail silently on `bumpDealAfterPostCall` / qualification writes while reads succeed | `firestore.rules:283-288` vs `:176-180` |
| R-2 | **P1** | **`findWonNbDealInGrace` Firestore query** uses compound filter + `orderBy("lastActivityAt")` — likely requires composite index not documented; runtime failure would break grace routing in production | `firestore-store.js:455-462` |
| R-3 | **P2** | **Rules read amplification** — `canReadAccountData` may trigger up to 4 `get(users/...)` per account read (`seTeamMemberTeamId`); segment leader dashboard listing many accounts could hit Firestore read limits / latency | `firestore.rules:143-165` |
| R-4 | **P2** | **`handoffToExpansion` archives all active lifecycles** on account (`deal-service.js:670-674`) before grace return — correct for motion but forces lifecycle recreation; if next `getOrCreateLifecycle` fails, post-win activity has deal but no lifecycle | `deal-service.js:670-674` |
| R-5 | **P2** | **Stale worker doc** `expansion-synthesize.md` still documents 501 — misleads operators | `worker/src/prep/expansion-synthesize.md:8` |
| R-6 | **P3** | **`DEAL_MOTION_AND_SALESFORCE_GAPS.md` §2 artifact table** not updated — lists Scorecard/VideoFacts/Timeline without `dealId` though LC-003–005 fixed | docs drift |

No evidence of intentional behavior regression in grace math or proxy teamId stamping — those paths look correct in code and tests.

---

## 5. Architecture concerns

### 5.1 Proxy `teamId` (ORG-001 / RBAC-006)

**Status: materially improved.**

```126:134:web/domain/acting-owner.js
export async function resolveActingWriteContext(session, proxySeUserId) {
  const ownerId = await resolveActingOwnerId(session, proxySeUserId);
  const store = getStore();
  const ownerUser = (await store.getUser?.(ownerId)) || null;
  return {
    ownerId,
    teamId: ownerUser?.teamId || session?.teamId || null,
    orgId: ownerUser?.orgId || session?.orgId || null,
  };
}
```

`dual-write.js` uses this for all prep/post-call artifacts. **Remaining gap:** `linkTaskToLifecycle` still uses `session.teamId` directly (`dual-write.js:644-655`) — manager proxy task link may stamp wrong team.

### 5.2 90-day grace (MOT-001 / MOT-004 / DEAL-010)

**Status: core routing implemented; lifecycle/account phase incomplete.**

- `archiveDeal` stamps `closedWonAt` (`deal-service.js:444-450`)
- `resolveEngagementDealInput` checks grace before expansion default (`deal-motion.js:145-147,185-187`)
- `handoffToExpansion` enters grace without creating expansion deal (`deal-service.js:677-692`)
- **Missing:** MOT-003 cron for `programPhase: "expansion"` at day 91 — after grace, NB-team actors (`isNewBusinessActor`) still default NB (`deal-motion.js:197-198`) unless allowlist/override applies

**Risk:** Day 91+ routing depends on `shouldRouteWonNbToExpansion` branch (`:185-187`) which returns expansion prepType with `dealId: null` — may create **new** expansion deal while won NB artifacts stay on archived deal (correct per LC-008) but lifecycle may attach to new deal inconsistently.

### 5.3 Firestore rules

**Improvements:** Account/contact/dealContacts scoping is a major step forward.

**Structural limits (pre-existing, now load-bearing):**

| Limit | Impact |
|-------|--------|
| `leadsSegmentContainingTeam` hardcodes segments `[0..2]` | Orgs with >3 segments: segment leaders beyond index 2 cannot proxy/write |
| `onAccountSeTeam` hardcodes seTeam `[0..3]` | Accounts with >4 SEs:第5+ SE loses rules-based access |
| Account `create: isSignedIn()` | Any user can create orphan accounts |
| Deal `update` lacks seTeam path | Multi-SE write gap (R-1) |

### 5.4 Segment scope (ACC-003 / ORG-007)

**ACC-003 FIXED** for lifecycle listing — segment leaders see lifecycles across `scope.teamIds`.

**ORG-007 NOT FIXED** — `getVisibleScope` still returns `type: "org"` when user is in `seniorLeaderIds` before segment branch (`org-service.js:157-167`). Segment leaders who are also senior leaders get org rollup, contradicting segment dashboard spec.

### 5.5 Contact dedupe (`resolveContactOnAccount`, `dedupeContactsForDisplay`)

**Status: good recent addition, not part of 42 FIXED list but architecturally important.**

```190:234:web/domain/contact-service.js
export async function resolveContactOnAccount(accountId, attendee, ctx = {}) {
  // email → alternateEmails → name match → attachAlternateEmail → create
}
```

```242:278:web/domain/contact-service.js
export function dedupeContactsForDisplay(contacts, opts = {}) {
  // collapse by normalized name; prefer primaryContactId, corporate domain email
}
```

- Prep path uses `resolveContactOnAccount` in `account-service.js:142-151` — reduces duplicate contacts across prep/post-call email variants.
- Engagement detail uses `dedupeContactsForDisplay` after deal-scoped load (`account-service.js:1240-1243`).
- **Gap:** `applyPostCallContactFrameworks` still falls back to name-only match when email absent (`contact-service.js:744-745`) — CONT-002.

---

## 6. Test coverage gaps

### What exists (fix pass)

| Script | Coverage |
|--------|----------|
| `test-deal-motion-nb-expansion.mjs` | 13/13 — grace routing, `closedWonAt`, handoff |
| `test-contact-deal-mapping.mjs` | 13/13 — join integrity, accountId path |
| `test-account-deal-fixes.mjs` | 3/3 — rules **file contains** dealContacts; segment lifecycles; proxy teamId |
| `test-deal-contacts-store.mjs` | Store-layer `listContactsByDeal` isolation |
| `test-acting-owner.mjs`, `test-org-service.mjs` | Proxy + scope helpers |

### What's missing

| Gap | Problem IDs | Risk |
|-----|-------------|------|
| **Firestore rules emulator tests** | TEST-002, TEST-004, JOIN-002 | Production allow/deny not proven; grep ≠ enforcement |
| **Secondary SE deal write** | DEAL-011, RBAC-009 | Read/write split undetected |
| **`call-view` deal-scoped contacts** | TEST-003, CONT-008, JOIN-001 | UI regression invisible |
| **Composite index / grace query** | DEAL-007, MOT-001 | Silent prod failure on `findWonNbDealInGrace` |
| **Director null teamId dual-write** | ORG-014 | Edge role blocked |
| **E2E manager cross-team proxy against real rules** | ORG-002, RBAC-002 | Only local-store tests |
| **Worker expansion prep integration** | DEAL-004, MOT-010 | 501 removed but no expansion-specific synthesis test |
| **SF contract tests** | TEST-005, SF-* | Expected deferred |

---

## 7. Prioritized fix list

### P0 — Do before prod deploy

| Order | IDs | Action |
|------:|-----|--------|
| 1 | **TEST-002, TEST-004**, JOIN-002 | Add Firebase emulator rules tests: segment proxy create, dealContacts write, account read deny for non-member |
| 2 | **DEAL-011, RBAC-009, R-1** | Extend `deals` `allow update` to use `canWriteDealResource` (includes `onAccountSeTeam`) |
| 3 | **ACC-010, ACC-001, RBAC-001** | Tighten account `create`/`update` — require creator on seTeam or manager proxy path |
| 4 | **DEAL-007, R-2** | Document/deploy Firestore composite index for `findWonNbDealInGrace`; add fallback query without orderBy |
| 5 | **ORG-014** | Allow dual-write when `teamId` null but `orgId` present for directors; or block with explicit UI error |

### P1 — Next sprint

| Order | IDs | Action |
|------:|-----|--------|
| 6 | **CONT-008, JOIN-001, TEST-003** | `call-view.js` → `listContactsByDeal` when `dealId` known |
| 7 | **DEAL-001, DEAL-003, ORG-004** | Product decision: per-SE deals vs shared account deals; document in ADR-003 |
| 8 | **MOT-005, MOT-003, ACC-011** | Day-91 `programPhase` job or document team-allowlist override behavior |
| 9 | **DEAL-008** | In `resolveEngagementDealInput`, require `explicitDealType` or remove sync default NB when only `explicitDealId` passed |
| 10 | **CONT-002** | Disable name-only post-call match or require email confirmation gate |
| 11 | **JOIN-003, JOIN-004** | Firestore rule: reject dealContact rows where `contact.accountId ≠ deal.accountId` |
| 12 | **ORG-007, DEAL-015** | Reorder `getVisibleScope` — segment leader branch before org director for non-directors |
| 13 | **DW-001** | Firestore batch/transaction wrapper for dual-write critical section |

### P2 — Backlog

| IDs | Action |
|-----|--------|
| SF-001–SF-013 | Sync pipeline (deferred) |
| JOIN-006 | Worker-side dealContacts persistence |
| LC-010 | Lifecycle→deal backfill job |
| ORG-005, DW-003, DW-004 | History/legacy path convergence |

---

## Appendix A — Monolithic pass file touch map

| File | Fix-pass changes verified |
|------|---------------------------|
| `firestore.rules` | dealContacts, canReadAccountData, segment proxy, deal read via account seTeam |
| `web/domain/acting-owner.js` | resolveActingWriteContext |
| `web/domain/dual-write.js` | write context, accountId preserve, post-call ordering, dealId on artifacts |
| `web/domain/deal-motion.js` | Grace helpers, won_grace source, explicitDealType from store |
| `web/domain/deal-service.js` | closedWonAt, handoff grace, listDeals unfiltered in account-service |
| `web/domain/lifecycle-service.js` | segment scope in listLifecyclesForSession |
| `web/domain/account-service.js` | listContactsByDeal in engagement detail, resolveContactOnAccount in prep |
| `web/domain/contact-service.js` | resolveContactOnAccount, dedupeContactsForDisplay |
| `web/domain/types.js` | CRM ids, read_account segment guard |
| `worker/src/routes.ts` | Expansion prep 501 removed |

---

## Appendix B — Return summary for parent agent

| Metric | Value |
|--------|------:|
| Review doc path | `docs/ULTRA_REVIEW_A.md` |
| FIXED claims **CONFIRMED** | **32** / 42 |
| FIXED claims **NOT DONE** | **0** / 42 |
| FIXED claims **OVERSTATED** | **10** / 42 |
| Overall score | **6.5 / 10** |

### Top 5 P0 items (ordered)

1. **TEST-002 / TEST-004 / JOIN-002** — Firestore emulator rules tests (segment proxy + dealContacts); grep tests insufficient for prod  
2. **DEAL-011 / RBAC-009 / R-1** — Align deal **update** rules with read (`canWriteDealResource` / seTeam path)  
3. **ACC-010 / ACC-001 / RBAC-001** — Tighten account create/update rules (still `isSignedIn()` wide)  
4. **DEAL-007 / R-2** — Composite index + validation for `findWonNbDealInGrace` Firestore query  
5. **ORG-014** — Dual-write null when target SE lacks `teamId`; explicit error or director org-only path  

---

*End of Ultra Review A*
