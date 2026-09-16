# Account, Deal & Contact — Known Problems (Complete Inventory)

> Last updated: 2026-08-06 (fix pass). Consolidates architecture review (23 breakage points), NB/Expansion/Salesforce audit (`DEAL_MOTION_AND_SALESFORCE_GAPS.md`), org-hierarchy gaps, and codebase grep.

### Fix pass 2026-08-06

See **`docs/ACCOUNT_DEAL_CONTACT_FIX_REPORT.md`** for full detail. Portal build **2.1.24**.

| Status | Count |
|--------|------:|
| FIXED | 42 |
| PARTIAL | 18 |
| DEFERRED | 59 |

Status legend per entry: **FIXED** | **PARTIAL** | **DEFERRED** | **documented gap** (unchanged design constraint).

---

## Summary counts by area and severity

| Area | Total | Blocker | Data leak | Wrong attribution | UX only | Missing feature | Partial |
|------|------:|--------:|----------:|------------------:|--------:|----------------:|--------:|
| Accounts | 12 | 1 | 3 | 3 | 3 | 1 | 1 |
| Deals | 18 | 4 | 1 | 7 | 2 | 3 | 1 |
| Contacts | 8 | 0 | 1 | 2 | 3 | 2 | 0 |
| Deal↔Contact joins | 6 | 2 | 0 | 3 | 1 | 0 | 0 |
| Lifecycle & activity | 11 | 1 | 0 | 4 | 3 | 2 | 1 |
| Manager proxy & org hierarchy | 14 | 5 | 0 | 6 | 3 | 0 | 0 |
| NB vs Expansion & 90-day rule | 12 | 2 | 0 | 4 | 1 | 4 | 1 |
| Salesforce sync | 14 | 0 | 0 | 1 | 0 | 13 | 0 |
| UI vs Firestore RBAC | 10 | 4 | 3 | 1 | 2 | 0 | 0 |
| Dual-write & persistence | 9 | 1 | 0 | 3 | 3 | 1 | 1 |
| Testing gaps | 5 | 0 | 0 | 0 | 0 | 0 | 5 |
| **Grand total** | **119** | **20** | **8** | **34** | **21** | **24** | **9** |

*Severity is per-entry primary tag; some entries span multiple concerns.*

---

## Accounts (all problems, numbered)

### ACC-001
- **ID:** ACC-001
- **Severity:** data leak
- **Scenario:** Any signed-in user can read every account document in Firestore.
- **Why it breaks:** Account docs have no `orgId`/`teamId`; rules allow `read: if isSignedIn()` for all accounts.
- **Code refs:** `firestore.rules:165-169`; `web/domain/types.js` Account typedef
- **Related:** both | org hierarchy | SF sync
- **Status:** open
- **Also reported in:** architecture analysis #1

### ACC-002
- **ID:** ACC-002
- **Severity:** data leak
- **Scenario:** UI `read_account` allows any manager to read any account that has a non-empty `seTeam`, regardless of team/segment membership.
- **Why it breaks:** `can()` case `"read_account"` checks `isManager && seTeamIds.length` without team/segment guard.
- **Code refs:** `web/domain/types.js:194-199` (`read_account`)
- **Related:** prep | post-call | org hierarchy
- **Status:** open
- **Also reported in:** architecture analysis #2

### ACC-003
- **ID:** ACC-003
- **Severity:** blocker
- **Scenario:** Segment leader who is **not** in `org.seniorLeaderIds` gets `getVisibleScope()` → `type: "segment"`, but `listLifecyclesForSession` only handles `own | team | org` — account/lifecycle lists empty.
- **Why it breaks:** No `segment` branch in lifecycle listing; segment-scoped leaders see no engagements.
- **Code refs:** `web/domain/lifecycle-service.js:368-448`; `web/domain/org-service.js:118-181`
- **Related:** both | org hierarchy
- **Status:** open
- **Also reported in:** architecture analysis #3; org hierarchy gap table

### ACC-004
- **ID:** ACC-004
- **Severity:** wrong attribution
- **Scenario:** Firestore empty or store fails; UI shows synthetic `hist_*` accounts built from local post-call history only.
- **Why it breaks:** History IDs are not shared Firestore records; cross-user visibility and deal linking break.
- **Code refs:** `web/domain/account-service.js:374-470` (`listAccountRowsFromHistory`, `buildAccountEngagementDetailFromHistory`); `web/search-service.js:326`
- **Related:** post-call | UX only (dev/offline)
- **Status:** documented gap
- **Also reported in:** architecture analysis #4

### ACC-005
- **ID:** ACC-005
- **Severity:** wrong attribution
- **Scenario:** Two accounts share a corporate domain; domain lookup picks the wrong account unless the actor is on one account's `seTeam`.
- **Why it breaks:** `findAccountsByDomain` multi-match disambiguation only prefers account where `actorId ∈ seTeam`.
- **Code refs:** `web/domain/account-service.js:88-98` (`upsertAccountFromPrep`)
- **Related:** prep | post-call
- **Status:** open
- **Also reported in:** architecture analysis #5

### ACC-006
- **ID:** ACC-006
- **Severity:** missing feature
- **Scenario:** Account entity has no CRM external id (`crmAccountId`) for Salesforce Account sync.
- **Why it breaks:** ADR-003 target shape lists optional CRM id; not on type or store.
- **Code refs:** `docs/adr/003-account-deal-engagement.md`; `web/domain/types.js` Account typedef
- **Related:** SF sync
- **Status:** open
- **Also reported in:** SF audit gaps #1

### ACC-007
- **ID:** ACC-007
- **Severity:** UX only
- **Scenario:** Account-level MEDDPICC fallback (`MEDDPICC_ACCOUNT_FALLBACK = true`) conflates qualification when multiple deals exist on one account.
- **Why it breaks:** Expansion multi-deal ambiguity — account rollup vs per-deal slots undecided (ADR-003 open question).
- **Code refs:** `web/domain/contact-service.js:33,92`; `web/scripts/test-deal-meddpicc.mjs:140`
- **Related:** prep | post-call | both
- **Status:** documented gap
- **Also reported in:** org hierarchy gap table; ADR-003 consequences

### ACC-008
- **ID:** ACC-008
- **Severity:** data leak
- **Scenario:** Contacts collection allows read/create/update for any signed-in user (no team/org scoping).
- **Why it breaks:** Same pattern as open account reads; contact PII visible org-wide at Firestore layer.
- **Code refs:** `firestore.rules:172-176`
- **Related:** both | SF sync
- **Status:** open

### ACC-009
- **ID:** ACC-009
- **Severity:** wrong attribution
- **Scenario:** Explicit `payload.accountId` from CRM panel was historically dropped before `upsertAccountFromPrep`, re-deriving account from typed company name (duplicate account risk).
- **Why it breaks:** Shorthand company name + free-mail prospect cannot slug-match selected account.
- **Code refs:** `web/scripts/test-contact-deal-mapping.mjs:584-626`; `web/domain/dual-write.js` (accountId path)
- **Related:** prep
- **Status:** partial (tests assert fix; regression risk remains if path bypassed)
- **Also reported in:** contact-deal mapping tests

### ACC-010
- **ID:** ACC-010
- **Severity:** UX only
- **Scenario:** Account create/update open to all signed-in users at Firestore — no `seTeam` or org membership check on write.
- **Why it breaks:** Malicious or mistaken client can mutate any account metadata including `engagementOverride`.
- **Code refs:** `firestore.rules:165-169`
- **Related:** prep | post-call
- **Status:** open

### ACC-011
- **ID:** ACC-011
- **Severity:** UX only
- **Scenario:** `programPhase` only transitions to `"expansion"` on manual `handoffToExpansion` — not on closed-won, not on 90-day timer, not on SF webhook.
- **Why it breaks:** Motion resolver checks `programPhase === "expansion"` but phase rarely updates automatically.
- **Code refs:** `web/domain/deal-service.js:629-670`; `web/domain/deal-motion.js`
- **Related:** both | MOT | SF sync
- **Status:** open
- **Also reported in:** SF audit #11

### ACC-012
- **ID:** ACC-012
- **Severity:** wrong attribution
- **Scenario:** When IC moves segments/teams, historical artifacts keep original `teamId` (MVP policy) — account/deal mapping unchanged but visibility shifts.
- **Why it breaks:** Manager/segment dashboards may hide legacy account activity after reassignment.
- **Code refs:** `docs/RELATIONSHIPS.md` Denormalization; `docs/RBAC.md`
- **Related:** org hierarchy
- **Status:** documented gap
- **Also reported in:** org hierarchy gap table

---

## Deals (same format, DEAL-001…)

### DEAL-001
- **ID:** DEAL-001
- **Severity:** wrong attribution
- **Scenario:** Deal `ownerId` = `account.primarySeUserId || actorId`; lifecycle `ownerId` = acting SE (or proxied SE).
- **Why it breaks:** Secondary SE work attaches to their lifecycle but deal RBAC/pipeline filters use primary as deal owner.
- **Code refs:** `web/domain/deal-motion.js:164-168` (`resolveDealOwnerId`); `web/domain/lifecycle-service.js`
- **Related:** prep | post-call | org hierarchy
- **Status:** open
- **Also reported in:** architecture analysis #6; SF audit #12

### DEAL-002
- **ID:** DEAL-002
- **Severity:** wrong attribution
- **Scenario:** `listDealsByAccount(accountId, ownerId)` filters by owner when building account rows — secondary SE may not see primary-owned deals.
- **Why it breaks:** Account list passes `effectiveSessionUserId`, not primary SE id.
- **Code refs:** `web/domain/account-service.js:699-702`; `web/domain/firestore-store.js` optional `where ownerId`
- **Related:** both
- **Status:** open
- **Also reported in:** architecture analysis #7

### DEAL-003
- **ID:** DEAL-003
- **Severity:** wrong attribution
- **Scenario:** `findActiveDeal(accountId, type)` is account-scoped — one active NB + one active expansion max; shared across all SEs on account.
- **Why it breaks:** Conflicts with per-SE lifecycle model; two SEs share one deal or fight for active deal selection.
- **Code refs:** `web/domain/deal-service.js`; `web/domain/local-store.js`; `web/domain/firestore-store.js` `findActiveDeal`
- **Related:** prep | post-call
- **Status:** open
- **Also reported in:** architecture analysis #8; SF audit #4

### DEAL-004
- **ID:** DEAL-004
- **Severity:** blocker
- **Scenario:** Expansion prep blocked in worker (`501`) while domain layer can create expansion deals and stamp expansion `prepType`.
- **Why it breaks:** Split brain — pre-call expansion motion fails at API; post-call may still succeed.
- **Code refs:** `worker/src/prep/index.ts:338-339,482-483`; `web/domain/deal-service.js` `createExpansionDeal`
- **Related:** prep
- **Status:** open
- **Also reported in:** architecture analysis #9; SF audit #1; ADR-003 consequences

### DEAL-005
- **ID:** DEAL-005
- **Severity:** missing feature
- **Scenario:** No `crmOpportunityId` (or `metadata.crmOpportunityId`) on Deal type — Salesforce Opportunity link impossible.
- **Why it breaks:** ADR-003 planned field not implemented in web or worker domain models.
- **Code refs:** `web/domain/types.js` Deal typedef; `worker/src/domain-model/deal.ts`; SF audit #15
- **Related:** SF sync
- **Status:** open

### DEAL-006
- **ID:** DEAL-006
- **Severity:** missing feature
- **Scenario:** No `wonAt` / `metadata.closedWonAt` when deal archived at `closed_won`.
- **Why it breaks:** 90-day NB grace period cannot be computed; SF CloseDate cannot be stored.
- **Code refs:** `web/domain/deal-service.js:431` (`archiveDeal`); `web/scripts/test-deal-motion-nb-expansion.mjs:290-323`
- **Related:** MOT | SF sync
- **Status:** open
- **Also reported in:** SF audit #3

### DEAL-007
- **ID:** DEAL-007
- **Severity:** missing feature
- **Scenario:** `findActiveDeal` only returns `status === "active"` — archived won NB invisible immediately after close.
- **Why it breaks:** Post-win activities cannot attach to won NB deal during 90-day grace without schema/policy change.
- **Code refs:** `web/domain/local-store.js`; `web/scripts/test-deal-motion-nb-expansion.mjs`
- **Related:** MOT | post-call
- **Status:** documented gap
- **Also reported in:** SF audit #3, naive 90-day table

### DEAL-008
- **ID:** DEAL-008
- **Severity:** wrong attribution
- **Scenario:** `explicitDealId` forces `prepType` to **new_business** unless `explicitPrepType === "expansion"`.
- **Why it breaks:** Pinning an expansion deal id without explicit prep type mis-labels motion as NB.
- **Code refs:** `web/domain/deal-motion.js:82-87`
- **Related:** prep | post-call
- **Status:** open
- **Also reported in:** SF audit #5

### DEAL-009
- **ID:** DEAL-009
- **Severity:** missing feature
- **Scenario:** Cannot model parallel expansion opportunities on one account — `findActiveDeal(accountId, "expansion")` allows only one active expansion deal.
- **Why it breaks:** Product revisit trigger in ADR-003 when parallel expansion deals required.
- **Code refs:** `web/domain/deal-service.js` `createExpansionDeal`; SF audit #4
- **Related:** both
- **Status:** open

### DEAL-010
- **ID:** DEAL-010
- **Severity:** UX only
- **Scenario:** `handoffToExpansion` archives NB deal **immediately** at `closed_won` and creates expansion deal — violates sales 90-day NB retention rule.
- **Why it breaks:** Day-1 post-win routing goes to new expansion deal, not won NB.
- **Code refs:** `web/domain/deal-service.js:629-677`
- **Related:** MOT | both
- **Status:** open
- **Also reported in:** SF audit #9

### DEAL-011
- **ID:** DEAL-011
- **Severity:** wrong attribution
- **Scenario:** Secondary SE may fail Firestore read on deal doc owned by primary (`deal.ownerId` ≠ secondary, `teamId` may differ).
- **Why it breaks:** `canReadTeamResource(deal.ownerId, deal.teamId)` — secondary is neither owner nor necessarily same team as deal stamp.
- **Code refs:** `firestore.rules:186-190`
- **Related:** post-call | org hierarchy
- **Status:** open
- **Also reported in:** architecture analysis #23

### DEAL-012
- **ID:** DEAL-012
- **Severity:** UX only
- **Scenario:** Deal update in Firestore requires `canWriteOwnResource(resource.data.ownerId)` — managers cannot update deal fields even on behalf of SE.
- **Why it breaks:** Handoff/stage changes initiated by manager may fail at rules layer if not written as SE.
- **Code refs:** `firestore.rules:186-190`
- **Related:** both
- **Status:** open

### DEAL-013
- **ID:** DEAL-013
- **Severity:** wrong attribution
- **Scenario:** `call-view.js` Tier-3 recovery picks newest non-archived deal on account when post-call record lacks `dealId` — may attach UI to wrong opportunity.
- **Why it breaks:** Heuristic fallback when dual-write skipped or confirm had no deals.
- **Code refs:** `web/call-view.js:2014-2034`
- **Related:** post-call
- **Status:** open

### DEAL-014
- **ID:** DEAL-014
- **Severity:** partial
- **Scenario:** `createNewDeal` flag was swallowed by lifecycle reuse branches (getOrCreateLifecycle, session context, findActiveDeal short-circuit).
- **Why it breaks:** UI promised second deal but flow reused first.
- **Code refs:** `web/scripts/test-contact-deal-mapping.mjs:487-518`; `web/domain/lifecycle-service.js`
- **Related:** prep
- **Status:** partial (tests pass; complex branch ordering)

### DEAL-015
- **ID:** DEAL-015
- **Severity:** UX only
- **Scenario:** Pipeline/segment views must explicitly filter `Deal.type` — org/team scope queries do not infer NB vs expansion motion.
- **Why it breaks:** Segment scope (`SEG_NEW_BUSINESS_ID`) filters teams, not deal motion; mixed pipeline counts.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §6; `web/domain/org-service.js`
- **Related:** org hierarchy
- **Status:** documented gap

### DEAL-016
- **ID:** DEAL-016
- **Severity:** wrong attribution
- **Scenario:** Naive in-place mutation of `Deal.type` from `new_business` to `expansion` would corrupt historical reporting.
- **Why it breaks:** Artifacts retain original `dealId`; type flip mislabels closed-won NB activity as expansion.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §4 Option A
- **Related:** MOT
- **Status:** documented gap (design constraint)

### DEAL-017
- **ID:** DEAL-017
- **Severity:** missing feature
- **Scenario:** No Salesforce stage mapping config (`LifecycleStage` ↔ SF `StageName`) per motion/record type.
- **Why it breaks:** Bi-directional stage sync cannot normalize portal stages to SF picklists.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §3 gaps #4
- **Related:** SF sync
- **Status:** open

### DEAL-018
- **ID:** DEAL-018
- **Severity:** data leak
- **Scenario:** Deal read uses team/org rollup rules, but deal `teamId` may reflect manager session on proxy writes (wrong team) — unintended cross-team visibility or denial.
- **Why it breaks:** Denormalized `teamId` on deal may not match SE's actual team after proxy prep.
- **Code refs:** `web/domain/dual-write.js:142,297`; `firestore.rules:96-118`
- **Related:** prep | post-call | org hierarchy
- **Status:** open
- **Also reported in:** architecture analysis #14 (deal side effect)

---

## Contacts (CONT-001…)

### CONT-001
- **ID:** CONT-001
- **Severity:** missing feature
- **Scenario:** No global person identity — same human at two accounts creates two Contact docs.
- **Why it breaks:** `(accountId, email)` uniqueness only; no cross-account merge (RELATIONSHIPS future M:N).
- **Code refs:** `docs/RELATIONSHIPS.md` Future M:N; `web/domain/account-service.js` `upsertAccountFromPrep`
- **Related:** prep | post-call | SF sync
- **Status:** documented gap
- **Also reported in:** architecture analysis #11

### CONT-002
- **ID:** CONT-002
- **Severity:** wrong attribution
- **Scenario:** Post-call `applyPostCallContactFrameworks` matches attendee by normalized name when email missing — can attach frameworks to wrong contact.
- **Why it breaks:** Weak identity key (`normalizeName`) within account contact list.
- **Code refs:** `web/domain/contact-service.js:135,613-614` (`applyPostCallContactFrameworks`)
- **Related:** post-call
- **Status:** open
- **Also reported in:** architecture analysis #12

### CONT-003
- **ID:** CONT-003
- **Severity:** UX only
- **Scenario:** Primary contact = first email in prep form order; prep path does not prioritize confirmed identities like post-call does.
- **Why it breaks:** Economic buyer may not be first typed email; `primaryContactId` and join `isPrimary` follow form order.
- **Code refs:** `web/domain/dual-write.js` prep path; `web/domain/dual-write.js:247` (`postCallParticipantEmails` — post-call better)
- **Related:** prep | post-call
- **Status:** open
- **Also reported in:** architecture analysis #13

### CONT-004
- **ID:** CONT-004
- **Severity:** missing feature
- **Scenario:** No `crmContactId` on Contact for Salesforce Contact sync.
- **Why it breaks:** External id field planned in ADR-003 / SF mapping table only.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §3
- **Related:** SF sync
- **Status:** open

### CONT-005
- **ID:** CONT-005
- **Severity:** wrong attribution
- **Scenario:** Free-mail domain stored on account `domain` field can cause incorrect domain-based contact resolution if gate bypassed.
- **Why it breaks:** Account with `domain: gmail.com` must never match unrelated gmail prospects by domain fallback.
- **Code refs:** `web/postcall-contact-resolve.js`; `web/scripts/test-contact-deal-mapping.mjs:412-476`
- **Related:** post-call | prep
- **Status:** partial (`isFreeMailDomain` gate exists; bad account data still a risk)

### CONT-006
- **ID:** CONT-006
- **Severity:** UX only
- **Scenario:** Contact at multiple accounts (same email, different companies) — no `accountContacts` join; duplicate CRM contacts in SF sync.
- **Why it breaks:** Explicitly not implemented (RELATIONSHIPS future M:N).
- **Code refs:** `docs/RELATIONSHIPS.md` Future M:N
- **Related:** SF sync
- **Status:** documented gap

### CONT-007
- **ID:** CONT-007
- **Severity:** data leak
- **Scenario:** Any signed-in user can read all contacts (PII: email, name, DISC metadata).
- **Why it breaks:** Firestore contacts rules lack team/org scoping.
- **Code refs:** `firestore.rules:172-176`
- **Related:** both
- **Status:** open
- **Also reported in:** ACC-008 (related)

### CONT-008
- **ID:** CONT-008
- **Severity:** UX only
- **Scenario:** `call-view.js` enriches call UI with `listContactsByAccount(accountId)` when loading contact context — account-wide, not deal-scoped.
- **Why it breaks:** Call view may show contacts not on the call's deal join.
- **Code refs:** `web/call-view.js:1071-1075,2202-2205`
- **Related:** post-call
- **Status:** open

---

## Deal↔Contact joins (JOIN-001…)

### JOIN-001
- **ID:** JOIN-001
- **Severity:** wrong attribution
- **Scenario:** Deal detail UI loads contacts via `listContactsByAccount(accountId)` — two deals on one account show **identical** contact lists.
- **Why it breaks:** Salesforce model requires `dealContacts` join (`listContactsByDeal`); account-wide read masks join bugs.
- **Code refs:** `web/domain/account-service.js:1221-1225`; `web/deal-view.js:967-980`; `web/scripts/test-contact-deal-mapping.mjs:183-254`
- **Related:** prep | post-call | both
- **Status:** open
- **Also reported in:** architecture analysis #7; SF audit #7

### JOIN-002
- **ID:** JOIN-002
- **Severity:** blocker
- **Scenario:** `dealContacts` collection has **no Firestore security rules** — default deny blocks join writes in production.
- **Why it breaks:** Dual-write calls `createDealContact` after prep/post-call; silently fails with warn.
- **Code refs:** `web/domain/firestore-store.js:295+`; `firestore.rules` (no `match /dealContacts/`); architecture analysis #10
- **Related:** prep | post-call | SF sync
- **Status:** open

### JOIN-003
- **ID:** JOIN-003
- **Severity:** wrong attribution
- **Scenario:** `deal.primaryContactId` denormalized pointer can diverge from `dealContacts` row where `isPrimary: true` if multiple writers apply different primary policies.
- **Why it breaks:** Two representations must agree; second brief with new primary must update both.
- **Code refs:** `web/scripts/test-contact-deal-mapping.mjs:262-308`; `web/domain/deal-service.js` `linkDealContacts`
- **Related:** prep | post-call
- **Status:** partial (tests guard cascade path)

### JOIN-004
- **ID:** JOIN-004
- **Severity:** wrong attribution
- **Scenario:** Join row could theoretically straddle accounts if `contact.accountId ≠ deal.accountId` — data integrity depends on dual-write discipline.
- **Why it breaks:** No DB constraint; bad write creates orphan join semantics.
- **Code refs:** `web/scripts/test-contact-deal-mapping.mjs:377-405`
- **Related:** both
- **Status:** open (invariant tested, not enforced in rules)

### JOIN-005
- **ID:** JOIN-005
- **Severity:** UX only
- **Scenario:** Per-deal contact **roles** (OpportunityContactRole-like) exist in join model but UI deal panel does not surface role/isPrimary distinction beyond primary tile.
- **Why it breaks:** SF sync expects role + isPrimary on join; UI under-represents join metadata.
- **Code refs:** `web/domain/types.js` DealContactLink; `web/deal-view.js` `renderDealContactsPanel`
- **Related:** SF sync
- **Status:** open

### JOIN-006
- **ID:** JOIN-006
- **Severity:** blocker
- **Scenario:** Worker does not persist `dealContacts` — all join writes are client-side only.
- **Why it breaks:** No server-side validation or SF push of OpportunityContactRole on call confirm.
- **Code refs:** `worker/src/postcall/resolve.ts` (match only); architecture analysis §2 UI vs backend
- **Related:** post-call | SF sync
- **Status:** open

---

## Lifecycle & activity association (LC-001…)

### LC-001
- **ID:** LC-001
- **Severity:** UX only
- **Scenario:** Lifecycle uniqueness is `(ownerId, accountId)` not `(ownerId, dealId)` — deal switch archives prior lifecycle for that SE×account pair.
- **Why it breaks:** Switching active deal loses single lifecycle lens; historical artifacts keep old `dealId` correctly but lifecycle counts move.
- **Code refs:** `docs/RELATIONSHIPS.md` Uniqueness; `web/domain/lifecycle-service.js`; SF audit #10
- **Related:** both
- **Status:** documented gap

### LC-002
- **ID:** LC-002
- **Severity:** wrong attribution
- **Scenario:** `findLifecycleByDealAndOwner` may miss when lifecycle exists for account but `dealId` not yet set on lifecycle record (migration/legacy).
- **Why it breaks:** Account engagement detail falls back to `findActiveLifecycle(ownerId, accountId)` — wrong deal lens.
- **Code refs:** `web/domain/account-service.js:1166-1180`
- **Related:** both
- **Status:** open

### LC-003
- **ID:** LC-003
- **Severity:** missing feature
- **Scenario:** Scorecard lacks `dealId` — SF Opportunity activity rollup cannot join scorecard without PostCall hop.
- **Why it breaks:** `persistScorecardDraft` ctx: `callId`, `accountId` only.
- **Code refs:** `web/domain/scorecard-service.js:10-44`; SF audit #6
- **Related:** post-call | SF sync
- **Status:** open

### LC-004
- **ID:** LC-004
- **Severity:** missing feature
- **Scenario:** VideoFacts collection lacks `dealId` on artifact — call-scoped only.
- **Why it breaks:** SF activity bundling per Opportunity requires indirect join via PostCall.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §2 artifact table; `docs/RELATIONSHIPS.md` VideoFacts FK
- **Related:** post-call | SF sync
- **Status:** open

### LC-005
- **ID:** LC-005
- **Severity:** missing feature
- **Scenario:** TimelineSegment / TimelineMarker lack `dealId` — call-scoped only.
- **Why it breaks:** Same SF rollup gap as LC-004.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §2
- **Related:** post-call | SF sync
- **Status:** open

### LC-006
- **ID:** LC-006
- **Severity:** UX only
- **Scenario:** Objection artifacts lack `dealId` FK (only `callId`, `accountId` denorm).
- **Why it breaks:** Deal-level objection queries require PostCall join.
- **Code refs:** `docs/RELATIONSHIPS.md` Objection FK table
- **Related:** post-call
- **Status:** open

### LC-007
- **ID:** LC-007
- **Severity:** UX only
- **Scenario:** MomDraft lacks `dealId` — customer-facing output not directly queryable by deal without call hop.
- **Why it breaks:** Spec FK map shows call + account denorm only.
- **Code refs:** `docs/RELATIONSHIPS.md` MomDraft FK
- **Related:** post-call | SF sync
- **Status:** open

### LC-008
- **ID:** LC-008
- **Severity:** wrong attribution
- **Scenario:** Reparenting artifact `dealId` on NB→expansion transition would break audit trail and Pass 9 summaries.
- **Why it breaks:** Must never mutate historical `dealId`; only future routing changes.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §4 naive breakage table
- **Related:** MOT | post-call
- **Status:** documented gap (design constraint)

### LC-009
- **ID:** LC-009
- **Severity:** partial
- **Scenario:** ADR-003 target: `dealId` required on new artifacts; `lifecycleId` remains during migration — dual IDs in APIs/URLs.
- **Why it breaks:** Incomplete migration; some code paths still lifecycle-first.
- **Code refs:** `docs/adr/003-account-deal-engagement.md` Consequences
- **Related:** both
- **Status:** partial

### LC-010
- **ID:** LC-010
- **Severity:** missing feature
- **Scenario:** No backfill job mapping legacy `lc_*` lifecycles to implicit `deal_*` for all historical NB data.
- **Why it breaks:** ADR-003 Phase 1 action item unchecked.
- **Code refs:** `docs/adr/003-account-deal-engagement.md` Implementation phases #3
- **Related:** both
- **Status:** open

### LC-011
- **ID:** LC-011
- **Severity:** wrong attribution
- **Scenario:** Two SEs on same expansion deal need matching `dealId` via engagement context or override — no automatic convergence.
- **Why it breaks:** Each SE has own lifecycle; deal selection is session/account override dependent.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §6
- **Related:** prep | post-call | org hierarchy
- **Status:** open

---

## Manager proxy & org hierarchy (ORG-001…)

### ORG-001
- **ID:** ORG-001
- **Severity:** blocker
- **Scenario:** Manager/segment-leader proxy writes stamp `teamId: session.teamId` (manager's team), not target SE's `teamId`.
- **Why it breaks:** Firestore `canCreateTeamResource` requires `teamId == userTeamId()` — cross-team proxy writes fail or stamp wrong team.
- **Code refs:** `web/domain/dual-write.js:117,142,209,286-297`; `firestore.rules:115-118`
- **Related:** prep | post-call
- **Status:** open
- **Also reported in:** architecture analysis #14

### ORG-002
- **ID:** ORG-002
- **Severity:** blocker
- **Scenario:** UI `create_on_behalf` allows segment leader to proxy for SE on another team **within segment**; Firestore `canWriteAsManagerForOwner` requires **same team** only.
- **Why it breaks:** Rules have no segment concept; segment leader proxy blocked at Firestore.
- **Code refs:** `web/domain/types.js:204-209`; `firestore.rules:107-113`
- **Related:** prep | post-call
- **Status:** open
- **Also reported in:** architecture analysis #15

### ORG-003
- **ID:** ORG-003
- **Severity:** blocker
- **Scenario:** Org director (may have `teamId: null`) runs prep for SE on another team — `canCreateTeamResource` fails `teamId == userTeamId()`.
- **Why it breaks:** Director proxy not supported at rules layer.
- **Code refs:** `firestore.rules:115-118`; architecture analysis #16
- **Related:** prep | post-call
- **Status:** open

### ORG-004
- **ID:** ORG-004
- **Severity:** wrong attribution
- **Scenario:** Manager proxy sets artifact `ownerId` to SE but deal `ownerId` stays `primarySeUserId` — coaching dashboards keyed on deal owner miss proxied work.
- **Why it breaks:** `resolveDealOwnerId` does not use acting SE.
- **Code refs:** `web/domain/deal-motion.js:164-168`; architecture analysis manager proxy summary
- **Related:** prep | post-call
- **Status:** open
- **Also reported in:** SF audit #12

### ORG-005
- **ID:** ORG-005
- **Severity:** wrong attribution
- **Scenario:** Post-call history saved under manager email if proxy resolution fails — falls back to `currentSession.email`.
- **Why it breaks:** SE history and manager coaching views diverge.
- **Code refs:** `web/app.js` `setOnAnalysisSaved`; architecture analysis #18
- **Related:** post-call
- **Status:** open

### ORG-006
- **ID:** ORG-006
- **Severity:** UX only
- **Scenario:** `buildPostCallResolveContext` scoped to proxy SE's lifecycles/deals — if proxy validation bypassed, manager's empty context used.
- **Why it breaks:** Pass 0 match quality degrades without SE-scoped briefs/deals snapshot.
- **Code refs:** `web/postcall-resolve-context.js`; `web/postcall.js`; architecture analysis #17
- **Related:** post-call
- **Status:** open

### ORG-007
- **ID:** ORG-007
- **Severity:** UX only
- **Scenario:** Segment leaders listed in `seniorLeaderIds` get `getVisibleScope()` → `type: "org"` **before** segment branch — segment dashboard spec contradicted.
- **Why it breaks:** `isOrgDirector(user.id, org)` checked before `getSegmentForLeader`; senior segment leaders see full org in team rollup.
- **Code refs:** `web/domain/org-service.js:157-181`; `docs/RBAC.md` segment table; architecture analysis #22
- **Related:** org hierarchy
- **Status:** open

### ORG-008
- **ID:** ORG-008
- **Severity:** wrong attribution
- **Scenario:** Digital flat team (ICs report to segment leader, not team manager) — proxy fails when leader `teamId` ≠ Digital IC `teamId`.
- **Why it breaks:** No special case for flat team; same as ORG-001/ORG-002.
- **Code refs:** `docs/RBAC.md` Digital segment; org hierarchy gap table
- **Related:** prep | post-call
- **Status:** open

### ORG-009
- **ID:** ORG-009
- **Severity:** UX only
- **Scenario:** `effectiveSessionUserId` used for list queries — manager does **not** impersonate proxy SE for read scope; sees manager scope until team/org rollup.
- **Why it breaks:** Acting owner affects writes only, not reads.
- **Code refs:** `web/domain/session.js:19-24`; org hierarchy gap table
- **Related:** both
- **Status:** documented gap

### ORG-010
- **ID:** ORG-010
- **Severity:** wrong attribution
- **Scenario:** `canManagerActForSe` error message says "not on your team" but `create_on_behalf` allows segment scope — confusing failure mode for segment leaders when SE not in picker list.
- **Why it breaks:** `listTeamSeOptions` depends on `listVisibleSeEmails` / scope; mismatch with `can()` segment branch.
- **Code refs:** `web/domain/acting-owner.js:103-116,81-94`
- **Related:** prep | post-call
- **Status:** open

### ORG-011
- **ID:** ORG-011
- **Severity:** blocker
- **Scenario:** Firestore `canWriteAsManagerForOwner` only checks `sameTeam(teamId)` — no `leadsSegmentContainingTeam` path for artifact create (unlike some org-structure rules).
- **Why it breaks:** Segment leader cannot create artifacts for SE on another team in segment at Firestore layer.
- **Code refs:** `firestore.rules:107-113,75-78`
- **Related:** prep | post-call
- **Status:** open

### ORG-012
- **ID:** ORG-012
- **Severity:** wrong attribution
- **Scenario:** Manager proxy adds SE to `account.seTeam` via `ensureSeTeamForPrepActor` but does not reassign `primarySeUserId` — deal ownership stays with prior primary.
- **Why it breaks:** Proxy engagement does not shift account/deal ownership model.
- **Code refs:** `web/domain/dual-write.js`; architecture analysis manager proxy summary
- **Related:** prep | post-call
- **Status:** open

### ORG-013
- **ID:** ORG-013
- **Severity:** UX only
- **Scenario:** Structure editor IC moves across segments do not remap account `seTeam` or deal `teamId` — historical vs current ownership split.
- **Why it breaks:** Org structure PATCH updates users/teams; account/deal mapping stale until new activity.
- **Code refs:** `worker/src/org-structure.ts`; `docs/RBAC.md` structure edits
- **Related:** org hierarchy
- **Status:** documented gap

### ORG-014
- **ID:** ORG-014
- **Severity:** blocker
- **Scenario:** `dual-write.js` returns null when `!session?.teamId` — directors or users without `teamId` cannot complete prep/post-call dual-write.
- **Why it breaks:** Early guard `if (!ownerId || !session.teamId) return null`.
- **Code refs:** `web/domain/dual-write.js:117,209`
- **Related:** prep | post-call
- **Status:** open

---

## New Business vs Expansion & 90-day rule (MOT-001…)

### MOT-001
- **ID:** MOT-001
- **Severity:** missing feature
- **Scenario:** Sales alignment rule: won deal stays **New Business for 90 days**, then activities attach to **Expansion** — **not implemented**.
- **Why it breaks:** No `wonAt`, no scheduler, no motion grace function.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §1,§4; `web/scripts/test-deal-motion-nb-expansion.mjs:290-323`
- **Related:** both | SF sync
- **Status:** documented gap
- **Also reported in:** SF audit #3

### MOT-002
- **ID:** MOT-002
- **Severity:** wrong attribution
- **Scenario:** After NB archived at `closed_won`, expansion actor immediately gets `prepType: expansion` and **new expansion deal** — not won NB deal.
- **Why it breaks:** `findActiveDeal(nb)` returns null; default expansion routing.
- **Code refs:** `web/scripts/test-deal-motion-nb-expansion.mjs:325-334`
- **Related:** post-call | prep
- **Status:** open

### MOT-003
- **ID:** MOT-003
- **Severity:** missing feature
- **Scenario:** No cron/worker job to flip `programPhase` to `"expansion"` at day 91.
- **Why it breaks:** Option B in SF audit not implemented.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §4 Option B
- **Related:** MOT
- **Status:** open

### MOT-004
- **ID:** MOT-004
- **Severity:** missing feature
- **Scenario:** No `shouldUseWonNbDeal` / `shouldRouteWonNbToExpansion` helper in `deal-motion.js`.
- **Why it breaks:** Test explicitly checks for missing function (`test-deal-motion-nb-expansion.mjs`).
- **Code refs:** `web/domain/deal-motion.js`; `web/scripts/test-deal-motion-nb-expansion.mjs:317-319`
- **Related:** prep | post-call
- **Status:** documented gap

### MOT-005
- **ID:** MOT-005
- **Severity:** wrong attribution
- **Scenario:** NB actor on NB teams (`TEAM_AJAY_ID`, `TEAM_NIKIL_ID`) still routes NB via allowlist/team after day 91 unless `programPhase` updated.
- **Why it breaks:** Team-based motion overrides time-based rule when phase not flipped.
- **Code refs:** `web/domain/deal-motion.js:129-140`; SF audit naive 90-day table
- **Related:** prep
- **Status:** open

### MOT-006
- **ID:** MOT-006
- **Severity:** UX only
- **Scenario:** NB account allowlist fetch failure silently sets empty allowlist — NB routing falls through to expansion default for NB teams' accounts.
- **Why it breaks:** `loadNbAccountAllowlist` catch sets `{ accountIds: [], slugs: [] }`.
- **Code refs:** `web/domain/deal-motion.js:31-33`
- **Related:** prep
- **Status:** open
- **Also reported in:** SF audit #13

### MOT-007
- **ID:** MOT-007
- **Severity:** partial
- **Scenario:** Motion resolution order documented in ADR-003 differs slightly from code (ADR lists allowlist before actor teams; code checks override → context → explicit prepType → phase → allowlist → actor → default).
- **Why it breaks:** Documentation drift causes wrong expectations for routing debugging.
- **Code refs:** `docs/adr/003-account-deal-engagement.md`; `web/domain/deal-motion.js:76-140`
- **Related:** prep | post-call
- **Status:** documented gap

### MOT-008
- **ID:** MOT-008
- **Severity:** wrong attribution
- **Scenario:** `engagementOverride` on account affects **future** routing only — does not reparent existing artifacts (correct) but UI may imply global switch.
- **Why it breaks:** Users may expect historical preps to move with override.
- **Code refs:** `web/domain/account-service.js` `setAccountEngagementOverride`; SF audit §2
- **Related:** prep | post-call
- **Status:** documented gap

### MOT-009
- **ID:** MOT-009
- **Severity:** missing feature
- **Scenario:** Product decision unchecked: handoff trigger (time vs go-live vs closed-won) and max concurrent deals per account (ADR-003 action item #1).
- **Why it breaks:** Blocks consistent MOT implementation.
- **Code refs:** `docs/adr/003-account-deal-engagement.md` Implementation phases
- **Related:** MOT
- **Status:** open

### MOT-010
- **ID:** MOT-010
- **Severity:** wrong attribution
- **Scenario:** Post-call can create expansion deal while prep expansion returns 501 — same account may have expansion deal from call but no expansion prep brief.
- **Why it breaks:** Asymmetric MOT support across flows.
- **Code refs:** `worker/src/prep/index.ts`; `web/scripts/test-activity-deal-association.mjs:184-206`
- **Related:** prep | post-call
- **Status:** open

### MOT-011
- **ID:** MOT-011
- **Severity:** missing feature
- **Scenario:** SF Opportunity CloseDate as source of truth for `wonAt` — no inbound webhook/poll.
- **Why it breaks:** Option C SF-driven transition not implemented.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §4 Option C; SF audit #5
- **Related:** SF sync | MOT
- **Status:** open

### MOT-012
- **ID:** MOT-012
- **Severity:** documented gap
- **Scenario:** Changing deal `status` to active sub-status `closed_won_grace` (Option A) not implemented — only binary active/archived today.
- **Why it breaks:** Grace-period routing requires schema/policy extension.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §4 Option A
- **Related:** MOT
- **Status:** open

---

## Salesforce sync readiness (SF-001…)

### SF-001
- **ID:** SF-001
- **Severity:** missing feature
- **Scenario:** No Salesforce API integration or sync worker anywhere in codebase.
- **Why it breaks:** Portal is system of record locally only; manual SF activity entry still required.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §3; grep: no sfdc/opportunity sync impl
- **Related:** prep | post-call | both
- **Status:** open
- **Also reported in:** SF audit #2; architecture analysis bottom line

### SF-002
- **ID:** SF-002
- **Severity:** missing feature
- **Scenario:** No `crmAccountId`, `crmContactId`, `crmOpportunityId` fields persisted on entities.
- **Why it breaks:** Bi-directional sync requires external id mapping.
- **Code refs:** ADR-003 target shape; `web/domain/types.js`; SF audit gaps #1
- **Related:** SF sync
- **Status:** open

### SF-003
- **ID:** SF-003
- **Severity:** missing feature
- **Scenario:** No idempotency keys, sync cursor collection, or conflict resolution policy.
- **Why it breaks:** Retries would duplicate SF Tasks/Events/Opportunity updates.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §3 gaps #2
- **Related:** SF sync
- **Status:** open

### SF-004
- **ID:** SF-004
- **Severity:** missing feature
- **Scenario:** No outbound activity export (PrepBrief → Task/Event, PostCall → Event/custom Call object).
- **Why it breaks:** SE activities not pushed to SF Activity timeline.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §3 ideal mapping table
- **Related:** prep | post-call
- **Status:** open

### SF-005
- **ID:** SF-005
- **Severity:** missing feature
- **Scenario:** Prep worker logs `dealId` / `prepType` only — no SF write on generate.
- **Why it breaks:** Even observability hook absent for sync pipeline.
- **Code refs:** `worker/src/prep/index.ts`; SF audit §3
- **Related:** prep
- **Status:** open

### SF-006
- **ID:** SF-006
- **Severity:** missing feature
- **Scenario:** Post-call worker logs `dealId` on generate/analyze — no SF write on commit passes.
- **Why it breaks:** MEDDPICC/TC/Task follow-ups stay portal-only.
- **Code refs:** `worker/src/postcall/*`; SF audit §3
- **Related:** post-call
- **Status:** open

### SF-007
- **ID:** SF-007
- **Severity:** missing feature
- **Scenario:** No webhook or polling from SF for Opportunity stage changes (won date for 90-day rule).
- **Why it breaks:** SF cannot drive portal motion transition.
- **Code refs:** SF audit gaps #5
- **Related:** MOT | SF sync
- **Status:** open

### SF-008
- **ID:** SF-008
- **Severity:** missing feature
- **Scenario:** `dealContacts` → OpportunityContactRole sync on call confirm not implemented.
- **Why it breaks:** SF opportunity contact roles must be manually maintained.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §3 mapping table
- **Related:** post-call | SF sync
- **Status:** open

### SF-009
- **ID:** SF-009
- **Severity:** missing feature
- **Scenario:** MeddpiccDelta / TechnicalCommit / Task follow-ups → SF Opportunity field updates not implemented.
- **Why it breaks:** Qualification and commit data stays portal-only.
- **Code refs:** SF audit §3 mapping; P2 fix phases
- **Related:** post-call
- **Status:** open

### SF-010
- **ID:** SF-010
- **Severity:** missing feature
- **Scenario:** Scorecard → SF custom object/PDF requires `dealId` on scorecard (blocked by LC-003).
- **Why it breaks:** Composite SF activity export incomplete.
- **Code refs:** SF audit §3 Scorecard row
- **Related:** post-call | SF sync
- **Status:** open

### SF-011
- **ID:** SF-011
- **Severity:** missing feature
- **Scenario:** No sync log collection / retry queue for failed SF pushes.
- **Why it breaks:** P2 pipeline requirement unmet.
- **Code refs:** `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` §7 P2
- **Related:** SF sync
- **Status:** open

### SF-012
- **ID:** SF-012
- **Severity:** wrong attribution
- **Scenario:** `Deal.arrActual` documented as Salesforce-only — portal ARR compute must never overwrite — but no sync populates `arrActual` from SF Opp Amount.
- **Why it breaks:** Pipeline ARR may disagree with SF system of record.
- **Code refs:** `docs/RBAC.md` ARR principle; `web/domain/types.js` Deal `arrActual`
- **Related:** post-call | SF sync
- **Status:** open

### SF-013
- **ID:** SF-013
- **Severity:** missing feature
- **Scenario:** Worker Pass 0 resolve is read-only match — client must send snapshots; SF account/opportunity ids not in resolve payload.
- **Why it breaks:** SF cannot participate in identity confirmation loop.
- **Code refs:** `worker/src/postcall/resolve.ts`; `worker/src/postcall/match.ts`
- **Related:** post-call
- **Status:** open

### SF-014
- **ID:** SF-014
- **Severity:** missing feature
- **Scenario:** Expansion prep 501 blocks expansion prep sync until worker gate removed or feature-flagged.
- **Why it breaks:** SF prep activity export for expansion motion impossible.
- **Code refs:** `worker/src/prep/index.ts:338-339`; SF audit gaps #6
- **Related:** prep | SF sync
- **Status:** open

---

## UI vs Firestore RBAC mismatches (RBAC-001…)

### RBAC-001
- **ID:** RBAC-001
- **Severity:** data leak
- **Scenario:** Firestore account/contact read wider than UI `can(read_account)` — any authenticated user vs team-scoped UI intent.
- **Why it breaks:** UI hides actions but direct Firestore client can read all.
- **Code refs:** `firestore.rules:165-176`; `web/domain/types.js`
- **Related:** both
- **Status:** open
- **Also reported in:** ACC-001, CONT-007

### RBAC-002
- **ID:** RBAC-002
- **Severity:** blocker
- **Scenario:** Segment leader `create_on_behalf` (UI) vs Firestore same-team-only manager proxy (rules).
- **Why it breaks:** UI allows action rules reject.
- **Code refs:** `web/domain/types.js:204-209`; `firestore.rules:107-118`
- **Related:** prep | post-call
- **Status:** open
- **Also reported in:** ORG-002

### RBAC-003
- **ID:** RBAC-003
- **Severity:** blocker
- **Scenario:** Director proxy cross-team blocked at Firestore despite UI/org leader permissions.
- **Why it breaks:** `canCreateTeamResource` teamId match.
- **Code refs:** `firestore.rules:115-118`
- **Related:** prep | post-call
- **Status:** open
- **Also reported in:** ORG-003

### RBAC-004
- **ID:** RBAC-004
- **Severity:** data leak
- **Scenario:** Manager `read_account` any seTeam account (UI) exceeds intended team boundary.
- **Why it breaks:** Missing team/segment check in `read_account`.
- **Code refs:** `web/domain/types.js:198`
- **Related:** both
- **Status:** open
- **Also reported in:** ACC-002

### RBAC-005
- **ID:** RBAC-005
- **Severity:** blocker
- **Scenario:** `dealContacts` writes denied in production (no rules) while UI assumes join exists after prep/post-call.
- **Why it breaks:** UI shows account-wide contacts even when join write failed.
- **Code refs:** JOIN-002; `firestore.rules`
- **Related:** prep | post-call
- **Status:** open

### RBAC-006
- **ID:** RBAC-006
- **Severity:** wrong attribution
- **Scenario:** Artifact `teamId` from manager session breaks `canReadTeamResource` for SE's actual team on subsequent reads.
- **Why it breaks:** Denorm teamId doesn't match SE user doc.
- **Code refs:** `web/domain/dual-write.js`; `firestore.rules:96-101`
- **Related:** prep | post-call
- **Status:** open

### RBAC-007
- **ID:** RBAC-007
- **Severity:** UX only
- **Scenario:** Full UI `can()` matrix (segment leader, PM, org director flags) not fully mirrored in `firestore.rules` or `worker/permissions.ts`.
- **Why it breaks:** Client guards ≠ server enforcement for edge roles.
- **Code refs:** `docs/RBAC.md`; `worker/src/domain-model/permissions.ts`
- **Related:** both
- **Status:** documented gap

### RBAC-008
- **ID:** RBAC-008
- **Severity:** UX only
- **Scenario:** Deals require owner to update (`canWriteOwnResource`) — managers read-only on deals per matrix but handoff needs deal stage updates.
- **Why it breaks:** Role matrix vs handoff workflow tension.
- **Code refs:** `firestore.rules:186-190`; `docs/RBAC.md`
- **Related:** both
- **Status:** open

### RBAC-009
- **ID:** RBAC-009
- **Severity:** blocker
- **Scenario:** Secondary SE cannot read primary-owned deal in Firestore — UI may still show deal via account engagement if loaded through permissive account path.
- **Why it breaks:** Split enforcement: account open read + deal restricted read.
- **Code refs:** `firestore.rules:165-190`; DEAL-011
- **Related:** post-call
- **Status:** open

### RBAC-010
- **ID:** RBAC-010
- **Severity:** data leak
- **Scenario:** Contact events subcollection readable by any signed-in user.
- **Why it breaks:** `contacts/{id}/events` rules: `allow read: if isSignedIn()`.
- **Code refs:** `firestore.rules:178-182`
- **Related:** both
- **Status:** open

---

## Dual-write & persistence (DW-001…)

### DW-001
- **ID:** DW-001
- **Severity:** UX only
- **Scenario:** Dual-write is not transactional — exception after `upsertAccountFromPrep` but before deal/lifecycle leaves account+contacts without deal.
- **Why it breaks:** No store transaction in local-store or firestore-store; re-run heals via email idempotency.
- **Code refs:** `web/domain/dual-write.js:231-246`; SF audit #8
- **Related:** prep | post-call
- **Status:** open
- **Also reported in:** architecture analysis #19

### DW-002
- **ID:** DW-002
- **Severity:** blocker
- **Scenario:** Post-call without company name skips dual-write entirely (`return null`).
- **Why it breaks:** No account/deal/contact mapping for calls missing company header.
- **Code refs:** `web/domain/dual-write.js:226-228`; SF audit #14
- **Related:** post-call
- **Status:** open

### DW-003
- **ID:** DW-003
- **Severity:** wrong attribution
- **Scenario:** Legacy parallel `preps` Firestore collection (uid-scoped) disconnected from domain model — brief may lack `accountId`/`dealId`.
- **Why it breaks:** Pass 0 resolve uses brief snapshots; dual-write failure leaves orphan briefs.
- **Code refs:** `web/app.js:455-470` (`savePrep`); architecture analysis #21
- **Related:** prep | post-call
- **Status:** open

### DW-004
- **ID:** DW-004
- **Severity:** wrong attribution
- **Scenario:** Two parallel post-call histories: localStorage `se-singha-history:{email}`, Worker KV `/api/history`, and Firestore `postCalls` via dual-write — can diverge.
- **Why it breaks:** History email patch for proxy; sync timing; offline paths.
- **Code refs:** `web/history.js`; `web/postcall.js`; architecture analysis §2
- **Related:** post-call
- **Status:** open

### DW-005
- **ID:** DW-005
- **Severity:** UX only
- **Scenario:** Pass 0 worker resolve ranks deals; user confirms different deal — worker never learns final mapping (by design).
- **Why it breaks:** Resolve audit trail ≠ persisted mapping; debugging difficulty only unless confirm skipped.
- **Code refs:** `worker/src/postcall/resolve.ts`; `web/postcall.js`; architecture analysis #20
- **Related:** post-call
- **Status:** documented gap

### DW-006
- **ID:** DW-006
- **Severity:** wrong attribution
- **Scenario:** Worker does **not** persist accounts, deals, contacts, lifecycles — canonical CRM writes are browser domain layer only.
- **Why it breaks:** No server-side authoritative mapping; tamperable client; no headless/sync path.
- **Code refs:** architecture analysis §1 bottom line; `worker/src/postcall/resolve.ts`
- **Related:** prep | post-call | SF sync
- **Status:** open

### DW-007
- **ID:** DW-007
- **Severity:** UX only
- **Scenario:** `lionpath_briefs` localStorage brief storage parallel to `prepBriefs` domain collection.
- **Why it breaks:** Sidebar briefs may not match Firestore prepBriefs if dual-write failed.
- **Code refs:** `web/precall.js`; architecture analysis §2
- **Related:** prep
- **Status:** open

### DW-008
- **ID:** DW-008
- **Severity:** partial
- **Scenario:** Post-call contact ordering fix (upsert account/contacts **before** lifecycle/deal) implemented — but still non-atomic per DW-001.
- **Why it breaks:** Partial failure modes reduced but not eliminated.
- **Code refs:** `web/domain/dual-write.js:231-246`
- **Related:** post-call
- **Status:** partial

### DW-009
- **ID:** DW-009
- **Severity:** missing feature
- **Scenario:** No server-side dual-write or worker persistence path for headless/SF-triggered activity ingest.
- **Why it breaks:** SF sync inbound would need API writes bypassing browser dual-write.
- **Code refs:** architecture analysis; SF audit P2
- **Related:** SF sync
- **Status:** open

---

## Testing gaps (TEST-001…)

### TEST-001
- **ID:** TEST-001
- **Severity:** partial
- **Scenario:** 90-day MOT transition explicitly skipped in tests with `documented gap` console message — no enforcement test until implemented.
- **Why it breaks:** Regression won't fail if someone adds broken partial implementation.
- **Code refs:** `web/scripts/test-deal-motion-nb-expansion.mjs:290-336`
- **Related:** MOT
- **Status:** documented gap

### TEST-002
- **ID:** TEST-002
- **Severity:** partial
- **Scenario:** No automated E2E for segment-leader cross-team proxy writes against real Firestore rules (manager-ux e2e may not cover Firestore deny path).
- **Why it breaks:** ORG-001/002/003 remain manual QA only.
- **Code refs:** `web/scripts/test-manager-ux-e2e.mjs`; `docs/RBAC.md` manual QA table
- **Related:** org hierarchy
- **Status:** open

### TEST-003
- **ID:** TEST-003
- **Severity:** partial
- **Scenario:** `deal-view` UI contact scoping not asserted — join bug (JOIN-001) tested at store layer only, not in `test-deal-view.mjs`.
- **Why it breaks:** UI regression can reintroduce account-wide contact panel.
- **Code refs:** `web/scripts/test-deal-view.mjs`; `web/scripts/test-contact-deal-mapping.mjs:183-186`
- **Related:** both
- **Status:** open

### TEST-004
- **ID:** TEST-004
- **Severity:** partial
- **Scenario:** No test for Firestore rules integration (`dealContacts` deny) — local store tests pass while production fails.
- **Why it breaks:** JOIN-002 invisible to unit test suite.
- **Code refs:** `firestore.rules`; `web/scripts/test-deal-contacts-store.mjs`
- **Related:** prep | post-call
- **Status:** open

### TEST-005
- **ID:** TEST-005
- **Severity:** partial
- **Scenario:** SF sync path has zero tests (expected — feature absent) — no contract tests for future `crmOpportunityId` / sync cursor schema.
- **Why it breaks:** SF implementation will lack test scaffold.
- **Code refs:** SF audit §8 test coverage table (no SF tests)
- **Related:** SF sync
- **Status:** open

---

## Recommended fix order (P0 / P1 / P2)

### P0 — Blockers & data integrity (do first)

| Priority | Problem IDs | Rationale |
|----------|-------------|-----------|
| P0a | JOIN-002, RBAC-005 | `dealContacts` Firestore rules — join writes fail silently in prod |
| P0b | ACC-001, ACC-002, CONT-007, RBAC-001, RBAC-004, RBAC-010 | Tighten account/contact/event Firestore rules to team/org/seTeam model |
| P0c | ORG-001, ORG-002, ORG-003, ORG-011, ORG-014, RBAC-002, RBAC-003, RBAC-006 | Align proxy `teamId`/`orgId` with target SE; extend Firestore manager/segment proxy |
| P0d | DEAL-004, SF-014, MOT-010 | Enable expansion prep (remove 501 or feature flag) — unblocks expansion MOT |
| P0e | ACC-003 | Wire `segment` scope into `listLifecyclesForSession` and account listing spine |
| P0f | DW-002 | Post-call without company — degrade gracefully or require confirm account |
| P0g | DEAL-011, RBAC-009 | Reconcile deal ownership/read for multi-SE accounts |

### P1 — Attribution, MOT foundation, activity completeness

| Priority | Problem IDs | Rationale |
|----------|-------------|-----------|
| P1a | DEAL-005, DEAL-006, MOT-001, MOT-004, MOT-002, DEAL-007, DEAL-010, MOT-012 | `closedWonAt`, grace routing helper, 90-day policy — **no artifact reparenting** (LC-008) |
| P1b | JOIN-001, CONT-008, TEST-003 | Deal UI must use `listContactsByDeal`; fix account engagement detail contact query |
| P1c | DEAL-001, DEAL-002, DEAL-003, ORG-004, ORG-012 | Deal owner vs lifecycle owner vs acting SE coherence |
| P1d | LC-003, LC-004, LC-005, SF-010 | Add `dealId` to scorecard, videoFacts, timeline for SF bundling |
| P1e | DEAL-008 | `explicitDealId` must respect expansion type without extra flag |
| P1f | DW-001, DW-003, DW-004 | Reduce dual-write/orphan and legacy `preps`/history divergence |
| P1g | ACC-005, ACC-009, CONT-002, CONT-005 | Account/contact resolution edge cases |
| P1h | SF-002, DEAL-017 | CRM external id fields + stage mapping config scaffold |

### P2 — Salesforce sync, scale, UX polish

| Priority | Problem IDs | Rationale |
|----------|-------------|-----------|
| P2a | SF-001 through SF-013, DW-009 | Outbound/inbound sync pipeline, idempotency, retry queue |
| P2b | DEAL-009, MOT-009, ACC-007 | Parallel expansion deals, MEDDPICC scope decision, product rules |
| P2c | MOT-003, MOT-011, SF-007 | Scheduled phase flip + SF CloseDate webhook |
| P2d | ORG-007, ORG-008, ORG-013, DEAL-015 | Segment dashboard scope vs org scope; pipeline Deal.type filters |
| P2e | CONT-001, CONT-003, CONT-006, JOIN-005 | Cross-account person, primary contact UX, role display |
| P2f | LC-009, LC-010, LC-001 | Lifecycle/deal migration completion |
| P2g | TEST-001 through TEST-005 | Close documented test gaps as features land |

---

## Source index

| Source | Contribution |
|--------|--------------|
| Architecture subagent (23 breakage points) | ACC-001–005, DEAL-001–004/011, CONT-001–003, ORG-001–009/012–014, DW-001/003–006, RBAC themes, org hierarchy gap table |
| `docs/DEAL_MOTION_AND_SALESFORCE_GAPS.md` | MOT-001–012, SF-001–014, DEAL-004–010/016–017, LC-001/003–005, DW-001–002 |
| `docs/adr/003-account-deal-engagement.md` | LC-009–010, MOT-009, ACC-006–007 |
| `web/scripts/test-contact-deal-mapping.mjs` | JOIN-001/003–004, ACC-009, DEAL-014, CONT-005 |
| `web/scripts/test-deal-motion-nb-expansion.mjs` | MOT-001–004, DEAL-006–007 |
| Codebase grep (2026-08-06) | ACC-008/010, CONT-007–008, LC-006–007, RBAC-008/010, DW-007–009, JOIN-006 |
| **Fix pass 2026-08-06** | `docs/ACCOUNT_DEAL_CONTACT_FIX_REPORT.md` — 42 FIXED, 18 PARTIAL, 59 DEFERRED |

### Fix-pass status by ID (2026-08-06)

| Status | IDs |
|--------|-----|
| **FIXED** | ACC-001, ACC-002, ACC-003, ACC-006, CONT-003, CONT-007, CONT-008, DEAL-002, DEAL-004, DEAL-005, DEAL-006, DEAL-007, DEAL-008, DEAL-010, DEAL-011, JOIN-001, JOIN-002, LC-003, LC-004, LC-005, MOT-001, MOT-002, MOT-004, MOT-010, MOT-012, ORG-001, ORG-002, ORG-003, ORG-011, ORG-014, RBAC-001, RBAC-002, RBAC-003, RBAC-004, RBAC-005, RBAC-006, RBAC-009, SF-002, SF-014, DW-002, TEST-001 |
| **PARTIAL** | ACC-009, ACC-010, ACC-011, DEAL-001, DEAL-003, DEAL-012, DEAL-014, JOIN-003, JOIN-004, ORG-004, ORG-010, ORG-012, CONT-002, CONT-005, MOT-005, MOT-007, LC-009, DW-008, RBAC-007, RBAC-008, TEST-002, TEST-004 |
| **DEFERRED** | ACC-004, ACC-005, ACC-007, ACC-012, DEAL-009, DEAL-013, DEAL-015, DEAL-017, CONT-001, CONT-004, CONT-006, JOIN-005, JOIN-006, LC-001, LC-006, LC-007, LC-008, LC-010, LC-011, ORG-005, ORG-006, ORG-007, ORG-008, ORG-009, ORG-013, MOT-003, MOT-008, MOT-009, MOT-011, SF-001, SF-003–SF-013, DW-001, DW-003–DW-007, DW-009, TEST-003, TEST-005 |
| **documented gap** (unchanged) | DEAL-016, LC-008, MOT-008 (constraints); ACC-004, ACC-007, ACC-012, CONT-006, LC-001, ORG-009, ORG-013, DW-005 |

---

## Related docs

- [DEAL_MOTION_AND_SALESFORCE_GAPS.md](./DEAL_MOTION_AND_SALESFORCE_GAPS.md)
- [RELATIONSHIPS.md](./RELATIONSHIPS.md)
- [RBAC.md](./RBAC.md)
- [adr/003-account-deal-engagement.md](./adr/003-account-deal-engagement.md)
