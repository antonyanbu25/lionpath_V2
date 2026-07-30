# ADR 003 — Account backbone, Deal/Opportunity, and engagement aggregate

| Status | Accepted |
|--------|----------|
| Date | 2026-07-22 |
| Context | New business (NB) now; expansion after ~3 months live; multiple records per account |

---

## Context

Today Lionpath models:

- **Account** — shared customer record (contacts, deal team, account-level MEDDPICC, merged activity in UI).
- **Lifecycle** — aggregate root for one **active** `(ownerId, accountId)` thread: pipeline stage, prep/post-call/tasks, timeline events.
- **Contact** — person at account with its own append-only **ContactEvent** stream.

NB fits “one SE pursuing one account.” Expansion implies:

- The **same account** persists; **team** may hand off from NB to expansion.
- **Multiple opportunities/deals** over time (NB close → expansion motions) need separate pipeline and artifacts.
- Contacts and account firmographics are **customer-level**; stage and pursuit artifacts are **opportunity-level**.

Forces: ship NB on current lifecycle spine; avoid a risky “replace Lifecycle with Account-only” rewrite; align with CRM mental model (Account → Contact → Opportunity).

---

## Decision

Adopt **Option B: Account backbone + Deal/Opportunity + refined engagement aggregate.**

1. **Account** is the **navigation and data backbone** — identity, contacts, deal team (`seTeam`), customer-level research/MEDDPICC (policy TBD per deal), merged account timeline.
2. **Deal** (synonym: Opportunity) is a **first-class entity** — one pursuit on an account (`new_business` | `expansion` | future types), with its own **stage**, status, owner/team, and CRM external id when synced.
3. **Engagement aggregate** (evolution of today’s **Lifecycle**):
   - **Near term:** Keep `lifecycles/{id}` and `lifecycleId` on artifacts; treat each active lifecycle as the implicit **NB deal** for `(ownerId, accountId)`.
   - **Target:** Either rename conceptually to **Engagement** or fold into **Deal** with optional **per-SE lens** (`ownerId × dealId`) when multiple SEs work the same deal.
   - Artifacts gain **`dealId`** (required for new expansion work); **`lifecycleId`** remains during migration, then optional or alias of deal + owner.

**NB → expansion handoff** (product rules to refine):

- Update **Account** (`seTeam`, optional `programPhase`: e.g. `new_business` → `live` → `expansion`).
- **Close/archive** NB deal (terminal stage); **create** expansion deal(s) on same `accountId`.
- Contacts and account history **do not** move; new preps/post-calls attach to the expansion **deal**.

**Not chosen:** Account-only aggregate (Option A) — loses clean multi-deal and multi-SE pursuit modeling. Lifecycle-only expansion (Option C) — one active lifecycle per SE×account cannot represent multiple expansion opportunities.

---

## Target shape (not fully implemented)

```text
Account (acc_*)
  contacts[] via Contact.accountId
  seTeam[], primarySeUserId
  metadata (firmographics, meddpicc — scope: see open question)

Deal (deal_*)
  accountId, type: "new_business" | "expansion"
  stage, status: active | paused | archived | terminal
  ownerId, teamId, orgId (denorm for RBAC)
  optional: primaryContactId, crmOpportunityId

Engagement / Lifecycle (lc_* → may merge with Deal)
  dealId (FK)
  ownerId (SE lens when multiple SEs on same deal)
  prepCount, postCallCount, events subcollection

PrepBrief | PostCall | Task
  accountId, dealId, lifecycleId (compat), ownerId, teamId, orgId
```

---

## Options considered

### Option A: Account as sole aggregate root

Remove Lifecycle; hang all artifacts on `accountId` only.

| Dimension | Assessment |
|-----------|------------|
| Complexity | High — full reparenting of queries, indexes, dual-write, dashboards |
| Fit for expansion | Needs another sub-aggregate anyway for multi-deal |

**Rejected** — high migration cost; duplicates problems Deal solves.

### Option B: Account + Deal + engagement aggregate

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — phased; new entity + FK backfill |
| Fit for NB | Current lifecycle maps to implicit NB deal |
| Fit for expansion | Multiple deals; handoff without new account |

**Accepted.**

### Option C: Lifecycle only + prepType

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low |
| Fit for expansion | Poor — stage and counts conflate at SE×account |

**Rejected** for long-term expansion.

---

## Trade-offs

| Topic | Choice |
|-------|--------|
| UX home | Account detail; deal switcher or default “active deal” |
| Manager views | Query by `dealId` / `teamId` / `orgId` (same denorm pattern as today) |
| MEDDPICC | **Open:** account rollup vs per-deal slots — decide before expansion UI |
| Worker | `prepType` + `dealId` (and optional `lifecycleId` for logging during migration) |

### Deal motion routing (NB vs expansion)

Resolution order (see `web/domain/deal-motion.js`):

1. Explicit `dealId` / form `prepType`
2. `account.metadata.engagementOverride` (manual, managers or deal team)
3. Session `getAccountEngagementContext()` from account detail
4. Account on `web/config/nb-account-allowlist.json`
5. Actor on new-business squads (`TEAM_AJAY_ID` → **International - NB**, `TEAM_NIKIL_ID` → **North America - NB**)
6. Default **expansion** (e.g. Preethi squads) unless allowlist or override

Account UI pursuit type + “Apply to next prep/post-call” / “Remember for this account” call `setAccountEngagementOverride`.

---

## Consequences

### Positive

- CRM-aligned model; NB code path stays valid while Deal is introduced.
- Handoff is explicit (team + deals), not destructive migration of contacts.
- Contact and ContactEvent model unchanged.

### Negative / cost

- Two IDs in APIs and URLs during transition (`dealId`, `lifecycleId`).
- Backfill: map existing `lc_*` → implicit `deal_*` for NB data.
- Expansion prep must be enabled in worker (today blocked for `prepType === "expansion"`).

### Revisit when

- Parallel expansion deals on one account are required.
- CRM sync defines opportunity as system of record.

---

## Implementation phases (action items)

1. [ ] Product: handoff trigger (time-based vs go-live vs closed-won) and max concurrent deals per account.
2. [ ] Add **Deal** to [ENTITY_CATALOG.md](../ENTITY_CATALOG.md) and [RELATIONSHIPS.md](../RELATIONSHIPS.md) when schema is locked.
3. [ ] Phase 1 — implicit deal: create `deal_*` on first lifecycle create for NB; set `dealId` on new artifacts.
4. [ ] Phase 2 — expansion: enable worker expansion prep; create expansion deal on handoff workflow.
5. [ ] Phase 3 — UI: account deal switcher; pipeline per deal; deprecate standalone lifecycle-first nav where redundant.
6. [ ] Decide MEDDPICC scope (account vs deal) and document in ENTITY_CATALOG.

---

## Related

- [ARCHITECTURE.md](../ARCHITECTURE.md) — core vs extension; current Lifecycle spine
- [RELATIONSHIPS.md](../RELATIONSHIPS.md) — User ↔ Account via Lifecycle today
- [FULLSTACK_REVIEW_BRIEF.md](../FULLSTACK_REVIEW_BRIEF.md) — product jobs
