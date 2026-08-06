# Deal motion (NB vs Expansion), 90-day rule, and Salesforce sync — gap analysis

Second-pass audit (2026-08-06). Builds on ADR-003, `test-contact-deal-mapping.mjs`, and org-hierarchy work.

---

## 1. Current NB vs Expansion model

### How deals are created and typed

| Path | Function | Behavior |
|------|----------|----------|
| Prep / post-call spine | `getOrCreateLifecycle` → `resolveDealForEngagement` | Creates or reuses deal by resolved `prepType` |
| Explicit NB | `getOrCreateNewBusinessDeal` | `findActiveDeal(accountId, "new_business")` — one active NB per account |
| Explicit expansion | `createExpansionDeal` | `findActiveDeal(accountId, "expansion")` — one active expansion per account |
| "+ New deal" UI | `createDealWithExplicitTitle` | Always forks; archives prior lifecycle |
| Manual handoff | `handoffToExpansion` | Archives NB deal at `closed_won`, sets `programPhase: "expansion"`, creates expansion deal |

Deal type is stored on `Deal.type` (`new_business` | `expansion`). Motion **routing** (which type to use before a deal exists) is separate, in `web/domain/deal-motion.js`.

### Motion resolution order (`resolveEngagementDealInput`)

1. `explicitDealId` (+ `explicitPrepType` if expansion)
2. `account.metadata.engagementOverride` (`dealId`, `dealType`)
3. Session `getAccountEngagementContext()` (`dealId`, `prepType`)
4. Explicit `explicitPrepType`
5. `account.programPhase === "expansion"`
6. NB account allowlist (`web/config/nb-account-allowlist.json`)
7. Actor on NB teams (`TEAM_AJAY_ID`, `TEAM_NIKIL_ID`)
8. Default **expansion**

Account UI writes overrides via `setAccountEngagementOverride` in `account-service.js`.

### What happens on win

- `handoffToExpansion` calls `archiveDeal(nbDeal.id, actor, { stage: "closed_won" })` — sets `status: "archived"`, stage `closed_won`.
- `findActiveDeal(accountId, "new_business")` then returns **null** (archived ≠ active).
- **No `wonAt` timestamp** on Deal or Account.
- **No 90-day timer**, cron, or scheduled job anywhere in the codebase.
- `programPhase` is only set to `"expansion"` on explicit handoff — not automatically after 90 days.

### Is 90-day transition implemented?

**Yes (2026-08-06 fix pass).** `Deal.metadata.closedWonAt` is stamped when NB is archived at `closed_won`. `deal-motion.js` exposes `shouldUseWonNbDeal`, `shouldRouteWonNbToExpansion`, and `NB_GRACE_PERIOD_MS` (90 days). New activities route to the archived won NB deal during grace; after 90 days expansion routing applies without reparenting historical artifact `dealId`s. `handoffToExpansion` enters grace (`programPhase: "live"`) without immediately creating an expansion deal.

**Not yet:** scheduled day-91 `programPhase` flip (MOT-003), SF CloseDate webhook (MOT-011), or `closed_won_grace` deal sub-status (MOT-012 option A).

---

## 2. Activity → deal association model

### Primary spine

```
Account → Deal → Lifecycle (ownerId × dealId lens) → Artifacts
```

Dual-write entry points: `linkPrepToLifecycle`, `linkPostCallToLifecycle` (`dual-write.js`).

### Artifact dealId stamping

| Artifact | dealId source | Notes |
|----------|---------------|-------|
| **PrepBrief** | `lifecycle.dealId` at attach | Set in `attachPrep` |
| **PostCall** | `lifecycle.dealId` or existing on upsert | Dedupe by `callIdentityKey` |
| **Task** | `task.dealId \|\| lifecycle.dealId` | `attachTask` |
| **Scorecard** | **None** | `persistScorecardDraft` ctx: `callId`, `accountId` only |
| **VideoFacts** | **None** | call-scoped |
| **TimelineSegment / Marker** | **None** | call-scoped |
| **FollowUp / Objection / MomDraft** | `persistCtx.dealId` when lifecycle has deal | post-call dual-write |
| **MeddpiccDelta** | `dealId` required | `applyQualificationToDeal` |
| **TcDelta / TechnicalCommit** | `dealId` required | deal 1:1 |
| **DealSignal** | `dealId` required | Pass 8 rollup |
| **ArrLine** | `dealId` required | per-call ARR |
| **ProductGap / WhatWorks** | `dealId` in context | Pass 6 |
| **DealSummary / AccountSummary** | deal/account scoped | Pass 9 |
| **ContactEvent** | optional `dealId` in payload | prep/post-call frameworks |
| **dealContacts join** | `dealId` | per-deal contact roles |

### What survives motion change

- **Immutable:** All artifacts keep the `dealId` stamped at creation. Archiving NB and creating expansion does **not** reparent historical preps/calls.
- **Lifecycle:** Active lifecycle per `(ownerId, accountId)` may be archived on deal switch; new lifecycle points at new deal.
- **Account-level:** Contacts, `seTeam`, firmographics persist. `programPhase` and `engagementOverride` affect **future** routing only.
- **MEDDPICC:** On `Deal.metadata.meddpicc` — per deal, not account rollup (ADR-005).

### Post-call ordering invariant

`linkPostCallToLifecycle` upserts account/contacts **before** deal/lifecycle so `primaryContactId` is set on deal creation (documented in `dual-write.js`).

---

## 3. Salesforce sync readiness

### What exists today

| Area | Status |
|------|--------|
| Domain model | CRM-aligned: Account, Contact, Deal (Opportunity), OpportunityContactRole-like `dealContacts` |
| External ID field | **Planned only:** `crmOpportunityId` in ADR-003 target shape — **not on `Deal` type or store** |
| SF API / sync worker | **None** |
| Activity export | **None** — no Event/Task push to SF |
| Prep worker | Logs `dealId`; passes `prepType` — no SF write |
| Post-call worker | Logs `dealId` on generate/analyze — no SF write |
| AE on deal | `Deal.metadata.ae` from post-call identity stamp |
| Incumbent competitor | TC/MEDDPICC text may mention "Salesforce" — not integration |

### Ideal Portal → Salesforce mapping

| Portal entity | SF object | Key fields | Sync direction |
|---------------|-----------|------------|----------------|
| Account | Account | `slug`/domain → Name/Website; portal `id` → custom External Id | Bi-directional |
| Contact | Contact | `accountId`, email; portal `id` → External Id | Bi-directional |
| Deal | Opportunity | `type` → Record Type or custom Motion; `stage` → StageName; `crmOpportunityId` ↔ SF Id | Bi-directional |
| dealContacts | OpportunityContactRole | role, isPrimary | Portal → SF on call confirm |
| PrepBrief | Custom object or Task/Event | Subject, prep link, `dealId` | Portal → SF |
| PostCall | Event or custom Call object | transcript summary, QIP, MoM | Portal → SF |
| Task (follow-ups) | Task | Open items from Pass 7 | Portal → SF |
| MeddpiccDelta | Opportunity field updates or custom | slot movements | Portal → SF |
| TechnicalCommit | Opportunity custom fields | aiAttach, incumbent | Portal → SF |
| Scorecard | Custom / attached PDF | **needs dealId on scorecard** | Gap |

### Gaps for SF path

1. No `crmOpportunityId`, `crmAccountId`, `crmContactId` on entities
2. No idempotency keys / sync cursor / conflict resolution
3. Scorecard and several call sub-artifacts lack `dealId` — SF Opportunity activity rollups cannot join without PostCall hop
4. No mapping table for `LifecycleStage` ↔ SF StageName per motion/record type
5. No webhook or polling from SF for Opportunity stage changes (won date for 90-day rule)
6. Worker blocks `prepType === "expansion"` (501) — expansion prep cannot sync until enabled

---

## 4. 90-day NB → Expansion transition — design options

### Business rule (sales alignment)

After Opportunity **Closed Won**, customer remains **New Business motion for 90 days** for reporting/alignment; then activities should attach to **Expansion** motion. SE requirement: **all activities captured on correct deal** regardless of label change.

### Option A — Time-based routing only (recommended P1)

- Add `Deal.wonAt` (or `metadata.closedWonAt`) when stage → `closed_won`.
- Add `resolveMotionAfterWin(account, actor, now)`:
  - If active archived NB with `wonAt` within 90d → route new activities to **that deal id** (even though archived) OR keep deal `status: active` with sub-status `closed_won_grace`.
  - After 90d → `createExpansionDeal` / expansion routing; do **not** mutate old artifact `dealId`s.
- SF sync: use SF `CloseDate` as source of truth for `wonAt`.

**Breaks if naive:** Changing `Deal.type` from `new_business` to `expansion` in place — corrupts historical reporting. Reusing `findActiveDeal` without grace period — skips won deal immediately.

### Option B — Account `programPhase` + scheduled job

- Cron/worker sets `programPhase: "expansion"` at day 91.
- Motion resolver already checks `programPhase === "expansion"` (source `phase`).
- Still need explicit deal selection: `createExpansionDeal` vs reuse.

### Option C — Salesforce-driven

- SF Opportunity Record Type flip or Stage triggers webhook → portal handoff.
- Portal `handoffToExpansion` already exists but is **manual** and **immediate** (archives NB now).

### Current code breakage if 90-day added naively

| Scenario | Failure |
|----------|---------|
| Archive at won + default expansion routing | Day-1 post-win call creates **new expansion deal**, not won NB |
| `findActiveDeal(type)` only `status === active` | Won NB invisible; cannot attach to grace-period deal |
| `handoffToExpansion` immediate | Violates 90-day NB retention |
| Reparent artifact `dealId` on transition | Breaks audit trail and Pass 9 summaries |
| NB actor after day 91 | Still routes NB via team allowlist unless `programPhase` updated |

---

## 5. Breakage points catalog

| # | Sev | Scenario | Location |
|---|-----|----------|----------|
| 1 | **P0** | Expansion prep blocked in worker (501) | `worker/src/prep/index.ts` — **Fixed 2026-08-06** |
| 2 | **P0** | No Salesforce sync; no external IDs | ADR-003 only; schema hooks added, sync DEFERRED |
| 3 | **P0** | 90-day won→expansion rule | **Fixed 2026-08-06** — `closedWonAt` + grace routing in `deal-motion.js` |
| 4 | **P1** | `findActiveDeal` one active deal per type per account — cannot model parallel expansion opps | `local-store.js`, `deal-service.js` |
| 5 | **P1** | `explicitDealId` forces `prepType` to NB unless explicitPrepType is expansion | `deal-motion.js:82-87` |
| 6 | **P1** | Scorecard lacks `dealId` | `scorecard-service.js` |
| 7 | **P1** | deal-view may list contacts by account not deal join | `test-contact-deal-mapping.mjs` #3 |
| 8 | **P1** | Dual-write not transactional — partial failure leaves account without deal | `dual-write.js` |
| 9 | **P2** | `handoffToExpansion` immediate archive vs 90-day sales rule | `deal-service.js:629` |
| 10 | **P2** | Lifecycle uniqueness `(ownerId, accountId)` not `(ownerId, dealId)` — deal switch archives lifecycle | `lifecycle-service.js` |
| 11 | **P2** | `programPhase` only set on manual handoff | `handoffToExpansion` |
| 12 | **P2** | Manager proxy sets artifact `ownerId` to SE but deal `ownerId` may be `primarySeUserId` | `resolveDealOwnerId` |
| 13 | **P2** | NB allowlist fetch fails silently → empty allowlist | `deal-motion.js:31-33` |
| 14 | **P2** | Post-call without company name skips dual-write entirely | `dual-write.js:226-228` |
| 15 | **P3** | `crmOpportunityId` not in Deal schema | `types.js`, worker `deal.ts` |

*(Prior contact/deal mapping findings #1–7 preserved in `test-contact-deal-mapping.mjs`.)*

---

## 6. Org hierarchy × motion types

- **NB teams** (International / North America NB): `isNewBusinessActor` → default NB for new accounts unless allowlist/override/phase says otherwise.
- **Expansion teams** (Preethi segment): default expansion — matches field SE motion.
- **Manager proxy** (`acting-owner.js`): `resolveActingOwnerId` sets artifact `ownerId` to proxied SE; lifecycle keyed by proxied `ownerId`. Deal document owner uses `account.primarySeUserId || actorId` — manager prep on behalf of secondary SE may create lifecycle owned by SE but deal owned by primary.
- **Multi-SE accounts:** One active lifecycle per SE×account; shared account contacts; deal-level join for contact roles. Two SEs on same expansion deal need matching `dealId` via engagement context or override.
- **Segments:** `SEG_NEW_BUSINESS_ID` in org structure — scope queries by team/org, not by deal motion; pipeline views must filter `Deal.type` explicitly.

---

## 7. Recommended fix phases

### P0 — Foundation for sales alignment + SF

1. Add `Deal.metadata.closedWonAt`, `Deal.metadata.crmOpportunityId` (and Account/Contact CRM ids).
2. Document motion grace policy; implement `shouldUseWonNbDeal(account, deal, now)` in `deal-motion.js` — **do not** reparent artifacts.
3. Enable expansion prep in worker (remove 501) or gate with feature flag.

### P1 — Routing + activity completeness

1. Grace-period routing: new activities attach to won NB deal for 90d; then `createExpansionDeal`.
2. Add `dealId` to Scorecard, VideoFacts, Timeline collections for SF activity bundling.
3. Deal switcher + engagement context: always pass explicit `dealId` from account UI to prep/post-call.
4. SF stage mapping config per `Deal.type`.

### P2 — Sync pipeline

1. Outbound: post-call commit → SF Event/Task + Opportunity field updates (MEDDPICC, TC).
2. Inbound: SF Opportunity CloseDate → set `closedWonAt`; Stage changes → optional portal stage sync.
3. Idempotent sync log collection; retry queue.
4. Replace immediate `handoffToExpansion` with configurable trigger (manual / SF webhook / 90d job).

---

## 8. Test coverage

| Script | Purpose |
|--------|---------|
| `web/scripts/test-deal-motion.mjs` | Core motion resolution |
| `web/scripts/test-deal-motion-nb-expansion.mjs` | NB/expansion paths, findActiveDeal, 90d gap |
| `web/scripts/test-activity-deal-association.mjs` | Dual-write dealId consistency |
| `web/scripts/test-deal-domain.mjs` | Lifecycle↔deal mirror |
| `web/scripts/test-deal-e2e.mjs` | handoff + post-call context |
| `web/scripts/test-contact-deal-mapping.mjs` | Contact/deal join integrity |

---

## Related

- [adr/003-account-deal-engagement.md](./adr/003-account-deal-engagement.md)
- [RELATIONSHIPS.md](./RELATIONSHIPS.md)
- [ENTITY_CATALOG.md](./ENTITY_CATALOG.md)
