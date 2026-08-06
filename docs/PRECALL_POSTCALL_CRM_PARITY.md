# Pre-call vs post-call CRM parity

Both prep and post-call dual-write paths must produce the **same global CRM entities** (account, contacts, deal, lifecycle associations) for equivalent inputs. Shared resolution lives in `web/domain/engagement-entities.js` (`resolveEngagementEntities`, `collectParticipantEmails`).

---

## Comparison table

| Step | Pre-call (`linkPrepToLifecycle`) | Post-call (`linkPostCallToLifecycle`) | Same function? | Divergence |
|------|----------------------------------|---------------------------------------|----------------|------------|
| **Acting owner / proxy SE** | `resolveActingWriteContext(session, payload.proxySeUserId)` | Same | ✅ `resolveEngagementEntities` | None |
| **Participant email order** | Confirmed identities → `prospectEmails` → `participantEmails` → `prospectEmail` | Same | ✅ `collectParticipantEmails` | None (unified) |
| **Company name source** | `payload.companyName` \|\| `meta.company` | Analysis header, record title, or payload | ❌ | **Intentional** — post-call derives company from transcript when intake is sparse |
| **Account pre-lookup** | Explicit `accountId` (payload/meta) → `findAccountByCompanyName` | Same | ✅ `resolveEngagementEntities` | None |
| **Account create/update** | `upsertAccountFromPrep` (slug → domain → create) | Same | ✅ | Prep may pass `prep`, `researchBundle`, `contactDrafts` for enrichment — **intentional** |
| **Contact upsert** | `resolveContactOnAccount` via `upsertAccountFromPrep` | Same | ✅ | Prep enriches from `prep.prospects` / drafts — **intentional** |
| **Primary contact** | First email in `collectParticipantEmails` order | Same | ✅ | Confirmed customer email wins when present — **intentional** |
| **SE team** | `ensureSeTeamForPrepActor(accountId, ownerId)` | Same | ✅ | None |
| **Engagement context** | `getAccountEngagementContext()` for `dealId` / `prepType` when account matches | Same | ✅ | None |
| **Deal id sources** | `payload.dealId` \|\| `meta.dealId` \|\| session context | `payload.dealId` \|\| `record.dealId` \|\| session context | ✅ | Record vs meta — **intentional** (artifact-specific) |
| **"+ New deal"** | `createDealWithExplicitTitle` then `getOrCreateLifecycle(dealId)` | Same | ✅ `resolveEngagementEntities` | None (unified; post-call was reference) |
| **Deal resolve/create** | `getOrCreateLifecycle` → `resolveDealForEngagement` | Same | ✅ | None |
| **Lifecycle attach** | `attachPrep` | `attachPostCall` | ❌ | **Intentional** — different artifact types |
| **Contact frameworks** | `applyPrepContactFrameworks` (from prep JSON) | `applyPostCallContactFrameworks` (from analysis) | ❌ | **Intentional** — different enrichment sources |
| **dealContacts join** | `linkContactsToDeal` → `linkContactsToDealRecord` | Same | ✅ | Post-call wraps in try/catch + warnings — **intentional** (non-fatal enrichment phase) |
| **Domain extraction** | `payload.companyDomain` \|\| `meta.domain` → `upsertAccountFromPrep` | `payload.companyDomain` only | ✅ | Meta is prep-only — **intentional** |
| **Identity stamp (AE / SE / contacts on call)** | Not run | `stampCallIdentities` after frameworks | ❌ | **Intentional** — post-call confirm gate only |
| **Post-call-only rollups** | — | scorecard, ARR, traction, summaries, pass6, etc. | ❌ | **Intentional** |

---

## Answer: how different are they?

**For account, contact, and deal creation — effectively the same** after unification via `resolveEngagementEntities`. Both paths:

1. Resolve owner/team/org through `resolveActingWriteContext`
2. Collect participant emails with the same ordering policy
3. Look up account by explicit id → company slug/domain → create
4. Upsert contacts on the account through `upsertAccountFromPrep` / `resolveContactOnAccount`
5. Ensure SE team membership
6. Resolve deal from payload, session context, or explicit "+ New deal"
7. Create lifecycle and link contacts to the deal join

**Remaining intentional differences** are downstream of entity resolution: prep attaches briefs and research; post-call attaches analysis artifacts, rollups, identity stamping, and confirm-gate email priority (already shared in `collectParticipantEmails`).

---

## Bugs fixed in this parity pass

| Issue | Before | After |
|-------|--------|-------|
| Duplicate participant email collectors | `prepParticipantEmails` vs `postCallParticipantEmails` | Single `collectParticipantEmails` |
| Post-call duplicate `accountId` lookup | Two identical `getAccount` calls | One lookup in shared helper |
| Prep forced `prepType: "new_business"` | Overrode motion resolution | Defers to `resolveDealForEngagement` like post-call |
| Prep `createNewDeal` via lifecycle flag | Different from post-call pre-create | Both use `createDealWithExplicitTitle` + `dealId` |
| Post-call missing `account.orgId` fallback | `orgId` only from acting context | `orgId \|\| account.orgId` in shared helper |
| Prep omitted `participantEmails` field | Post-call only | Both include all email fields |

---

## Code map

| File | Role |
|------|------|
| `web/domain/engagement-entities.js` | Shared `resolveEngagementEntities`, `collectParticipantEmails` |
| `web/domain/dual-write.js` | `linkPrepToLifecycle`, `linkPostCallToLifecycle` (orchestration only) |
| `web/domain/account-service.js` | `upsertAccountFromPrep`, `findAccountByCompanyName` |
| `web/domain/contact-service.js` | `resolveContactOnAccount`, framework apply |
| `web/domain/deal-service.js` | `resolveDealForEngagement`, `createDealWithExplicitTitle`, `linkContactsToDealRecord` |
| `web/domain/lifecycle-service.js` | `getOrCreateLifecycle` |

---

## Tests

```bash
node web/scripts/test-prep-postcall-crm-parity.mjs
node web/scripts/test-precall-dual-write-e2e.mjs
node web/scripts/test-contact-deal-mapping.mjs
```

Parity test asserts: same company + emails through prep then post-call → one account, one deal, deduped contacts.
