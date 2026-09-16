# Pre-call fix report (portal build 2.1.28)

## Summary

Pre-call generation now reliably dual-writes **account → contacts → deal → lifecycle → prepBrief** into the domain store (localStorage shim or Firestore), appears in **Accounts** nav, resolves CRM by email **or** typed company domain, and **“How big is this fish?”** renders from research facts and company context—not only from additional-context notes.

**CRM parity (2.1.28):** Prep and post-call share `resolveEngagementEntities` in `web/domain/engagement-entities.js` so account/contact/deal creation uses the same resolution order. See [`docs/PRECALL_POSTCALL_CRM_PARITY.md`](./PRECALL_POSTCALL_CRM_PARITY.md).

---

## Root causes

| # | Symptom | Root cause |
|---|---------|------------|
| 1 | Accounts/deals missing after pre-call | `app.js` gated `linkPrepToLifecycle` on `sessionUserId && session.teamId`. Sessions with email but missing `teamId` (or before domain sync) skipped dual-write silently. `linkPrepToLifecycle` also lacked post-call account resolution (`findAccountByCompanyName`, engagement context, `useSessionContext`). |
| 2 | Domain from email not used in CRM search | CRM instant preview bailed on free-mail emails **before** reading the typed **Company domain** field, hiding account/deal grid. Lookup fallback existed but preview path did not. |
| 3 | Contacts without account/deal | Contacts could appear from brief/history while domain cascade was skipped (same gate as #1). Partial writes are not possible in `linkPrepToLifecycle`—when it runs, account is always created first. |
| 4 | Post-call wired, pre-call not | Post-call resolved account via slug/name/domain, used `resolveActingWriteContext`, `useSessionContext`, and engagement context for deal routing. Pre-call passed raw payload into upsert without fallbacks. |
| 5 | End-to-end store incomplete | Accounts nav lists from **lifecycles**, not legacy `preps` Firestore collection. `savePrep()` only writes sidebar history; domain store is the source of truth for Accounts. |
| 6 | Fish sizing always empty | Worker only ran `extractFishSizingFromContext` when `additionalContext` was non-empty (≥20 chars). Rivals web search often returns null for niche companies. No fallback from grounded **research facts** (Company size, Support team). |

---

## Fixes applied

### Web — dual-write parity (`web/domain/dual-write.js`)

- Pre-call account resolution mirrors post-call: honour `accountId`, `createNewAccount`, then `findAccountByCompanyName`.
- Pass `useSessionContext: true` and engagement-context `dealId` / `prepType` into `getOrCreateLifecycle`.
- Use `resolveActingWriteContext` for owner/team/org (manager proxy SE support).

### Web — app gate (`web/app.js`)

- Removed brittle `sessionUserId && teamId` gate; dual-write runs whenever session has email.
- Uses `withEffectiveUserId(session)` before `linkPrepToLifecycle`.
- Writes back `accountId` / `dealId` onto brief meta after link.

### Web — CRM preview (`web/prep-crm-resolve.js`)

- Instant account/deal preview uses **company domain field** when prospect email is personal (Gmail/Outlook).

### Web — brief storage (`web/precall.js`)

- Brief records now store `accountId` and `dealId` from dual-write meta.

### Worker — fish sizing (`worker/src/prep/rivals-context.ts`, `worker/src/prep/index.ts`)

- `fishSizingFromResearchFacts()` — maps Company size → Employees, Support team → Support agents, etc.
- `buildFishSizingPromptContext()` — builds LLM input from company, domain, emails, facts, and AE notes.
- `resolveFishContext()` — merges fact-based metrics + LLM extraction (always runs, not only when AE notes exist).

### Build

- Portal build bumped: **2.1.27 → 2.1.28** (`web/index.html`).

### CRM parity (`web/domain/engagement-entities.js`, `web/domain/dual-write.js`)

- Extracted `resolveEngagementEntities` and `collectParticipantEmails` — shared by `linkPrepToLifecycle` and `linkPostCallToLifecycle`.
- Unified account resolution (explicit id → slug/domain → create), contact upsert, deal routing, `createNewDeal` pre-create, and `orgId` fallback.
- Prep no longer forces `prepType: "new_business"`; defers to motion resolution like post-call.

---

## CRM parity (pre-call vs post-call)

| Question | Answer |
|----------|--------|
| Same account for same company+emails? | **Yes** — both use `resolveEngagementEntities` |
| Same deal when no explicit new-deal? | **Yes** — `getOrCreateLifecycle` + session context |
| Contacts deduped? | **Yes** — `resolveContactOnAccount` by email |
| Intentionally different? | Artifact attach (prep brief vs post-call), framework enrichment source, post-call rollups + identity stamp |

Full step-by-step table: [`docs/PRECALL_POSTCALL_CRM_PARITY.md`](./PRECALL_POSTCALL_CRM_PARITY.md).

---

## Firestore vs localStorage

| Mode | When | Dual-write target |
|------|------|-------------------|
| **localStorage shim** | No `firebaseConfig.projectId` or Firebase not init | `se-singha-domain:*` keys via `local-store.js` |
| **Firestore** | Firebase auth + `projectId` + `fb.db` | `createFirestoreStore` collections (accounts, deals, lifecycles, prepBriefs, …) |

Legacy `preps` Firestore collection (`savePrep` in `app.js`) is **sidebar/history only** — not used by Accounts nav.

Dual-write requires a signed-in session with resolvable team (via user profile or org membership). Failures log `[dual-write] prep skipped` or `Lifecycle dual-write (prep) failed:` to console.

---

## Tests

| Script | Result |
|--------|--------|
| `web/scripts/test-prep-postcall-crm-parity.mjs` | **PASS** (new) |
| `web/scripts/test-precall-dual-write-e2e.mjs` | **PASS** |
| `web/scripts/test-prep-domain.mjs` | PASS |
| `web/scripts/test-contact-deal-mapping.mjs` | PASS (14 checks) |
| `web/scripts/test-activity-deal-association.mjs` | PASS (4/4) |
| `web/scripts/test-deal-motion-nb-expansion.mjs` | PASS (13/13) |
| `web/scripts/test-prep-crm-preview.mjs` | PASS |
| `web/scripts/test-fish-sizing-buckets.mjs` | PASS |
| `worker/scripts/test-rivals-context.ts` | PASS (16 checks) |

Run web suite:

```bash
cd web && node scripts/test-precall-dual-write-e2e.mjs
```

---

## Manual QA checklist

1. Sign in (Firebase or dummy). Confirm session has team (Profile or dev seed).
2. **Pre-call** → enter corporate email `you@company.com` → verify company domain auto-fills.
3. Confirm account/deal preview card appears (new or existing).
4. Fill additional context + LinkedIn PDF → **Generate**.
5. Open **Accounts** → new account row with deal stage.
6. Re-enter same email on a new brief → CRM shows existing account/deal.
7. **Fish sizing**: generate brief for a company with public headcount in research → Know tab shows benchmark or INPUT rows (not empty state).
8. **Post-call** smoke: run one analysis — confirm no regression (dual-write still creates account/deal).

---

## Files changed

- `web/domain/engagement-entities.js` (new)
- `web/domain/dual-write.js`
- `web/app.js`
- `web/precall.js`
- `web/prep-crm-resolve.js`
- `web/index.html`
- `web/scripts/test-prep-postcall-crm-parity.mjs` (new)
- `web/scripts/test-precall-dual-write-e2e.mjs` (new)
- `docs/PRECALL_POSTCALL_CRM_PARITY.md` (new)
- `worker/src/prep/rivals-context.ts`
- `worker/src/prep/index.ts`
- `worker/scripts/test-rivals-context.ts`
- `docs/PRECALL_FIX_REPORT.md` (this file)
