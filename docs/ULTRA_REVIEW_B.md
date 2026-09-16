# Ultra Review B — Adversarial Functional Review (2026-08-06)

**Reviewer:** Agent B (adversarial)  
**Scope:** Independent verification of fix pass **2.1.24** against `docs/ACCOUNT_DEAL_CONTACT_PROBLEMS.md` and `docs/ACCOUNT_DEAL_CONTACT_FIX_REPORT.md`  
**Method:** Run mandated test scripts, grep for residual patterns, trace production code paths the unit tests do not exercise. **No fixes applied.**

---

## 1. Test results table

| Script | Result | Notes |
|--------|--------|-------|
| `test-account-deal-fixes.mjs` | **PASS** (3/3) | Local-store only; rules check is **string grep**, not Firebase emulator |
| `test-deal-motion-nb-expansion.mjs` | **PASS** (13/13) | Grace routing enforced; `[dual-write] summaries regenerate failed: fetch failed` (non-fatal, sandbox) |
| `test-activity-deal-association.mjs` | **PASS** (4/4) | Proxy test is **same-team manager→SE** only; no cross-team segment leader |
| `test-contact-deal-mapping.mjs` | **PASS** (13/13) | Store-layer join invariants; does not assert `deal-view.js` rendering |
| `test-org-service.mjs` | **PASS** (43/43) | Scope/RBAC on seeded org; no Firestore write simulation |
| `test-acting-owner.mjs` | **PASS** | Acting owner + same-team proxy dual-write |
| `test-deal-domain.mjs` | **PASS** | Domain smoke |
| `test-deal-e2e.mjs` | **PASS** | Handoff grace path; `[dual-write] summaries regenerate failed` again |

**Summary:** **8/8 PASS**, zero exit-code failures.  
**Caveat:** All tests run against **local in-memory store**. None prove production Firestore rule evaluation, worker HTTP for expansion prep, or cross-team proxy writes end-to-end.

---

## 2. Broken scenarios — concrete user flows that still fail

### 2.1 Segment leader (Digital) proxies prep for flat-team IC — cross-team Firestore write

**Problem IDs:** ORG-001 (partial), ORG-002, ORG-008, ORG-011, RBAC-002, TEST-002

**Flow:** Preethi (Digital segment leader, `teamId` ≠ Digital IC team) selects a Digital IC in the proxy picker and runs prep.

**Expected (fix report):** Artifact stamped with IC `teamId`; Firestore accepts write.

**Reality:** `resolveActingWriteContext` correctly resolves IC `teamId` for prep/post-call dual-write. **No automated test** exercises Preethi→Digital IC cross-team against real rules. `test-activity-deal-association.mjs` only proxies manager and SE on **the same** `TEAM_ID`. Manual QA row in fix report is untested in CI.

**Breakage mode:** If `canWriteAsManagerForOwner` / `leadsSegmentContainingTeam` edge fails (org has >3 segments, team not in first three segment slots, or IC not in org user doc), write **denies in prod** while UI `create_on_behalf` allows.

---

### 2.2 Org director (`teamId: null`) proxies cross-team — task import path

**Problem IDs:** ORG-014 (partial), ORG-003, RBAC-003, RBAC-006

**Flow:** Vipin imports/links a task to a lifecycle on behalf of an SE (`linkTaskToLifecycle`).

**Reality:** Prep/post-call paths use `resolveActingWriteContext` and no longer hard-require `session.teamId`. **`linkTaskToLifecycle` still does:**

```643:655:web/domain/dual-write.js
export async function linkTaskToLifecycle(session, task, lifecycleId) {
  const ownerId = sessionUserId(session);
  if (!ownerId || !session?.teamId || !lifecycleId) return null;
  // ...
      teamId: session.teamId,
```

Director with `teamId: null` → **silent null return**; task never links. Stamps **manager session teamId**, not target SE — regression of ORG-001 on a secondary code path.

---

### 2.3 Won NB day 45 — post-call on account; secondary SE on same account

**Problem IDs:** DEAL-001, DEAL-003, DEAL-011 (partial), LC-011, RBAC-009 (partial)

**Flow:** NB deal closed-won (grace). Secondary SE runs post-call; primary SE owns deal (`resolveDealOwnerId` → `primarySeUserId`).

**Reality:** Grace routing (`shouldUseWonNbDeal`, `findWonNbDealInGrace`) works in tests for **acting owner = deal owner**. Secondary SE lifecycle gets its own `ownerId`; `findActiveDeal(accountId, type)` is **account-scoped** — two SEs share one active NB/expansion slot. Secondary may attach lifecycle to same dealId via engagement context, but deal `ownerId` stays primary → pipeline/coaching filters mis-attribute (DEAL-001). Firestore `canReadDealResource` now allows `seTeam` members (fix), but **deal list filters** and manager dashboards keyed on `deal.ownerId` still miss proxied/secondary work (ORG-004).

---

### 2.4 Duplicate contact — post-call attendee with name only, no email

**Problem IDs:** CONT-002, JOIN-003

**Flow:** Post-call analysis lists attendee "Jordan Lee" with no email; another contact "Jordan Lee" exists on account with different email.

**Reality:** `applyPostCallContactFrameworks` uses `resolveContactOnAccount` **only when email present**. Name-only branch:

```733:746:web/domain/contact-service.js
    if (email && email.includes("@")) {
      contact = await resolveContactOnAccount(accountId, attendee, { ... });
    } else {
      const nameKey = normalizeName(attendee.name);
      contact = contacts.find((c) => normalizeName(c.name) === nameKey) || null;
    }
```

Weak identity key — frameworks attach to **wrong contact** or skip. Not covered by mapping tests (all use emails).

---

### 2.5 Production Firestore — `dealContacts` join write succeeds in local store, fails or leaks in prod

**Problem IDs:** JOIN-002 (claimed FIXED), RBAC-005 (claimed FIXED), TEST-004 (partial), ACC-010, RBAC-001 (partial)

**Flow:** SE completes prep; dual-write calls `createDealContact`.

**Reality:** Rules block **exists** (`match /dealContacts/` + `canWriteDealResource`). `test-account-deal-fixes.mjs` only asserts **file contains strings**. No emulator run. Risks:

- **`canReadAccountData` org-leader blanket read:** `(isManager() && isOrgLeader())` with **no account/seTeam guard** — any `seniorLeaderIds` manager reads **all accounts** in org (broader than tightened UI `read_account`).
- **Account create:** `allow create: if isSignedIn()` — any authenticated user can create accounts (ACC-010 still open).
- **`onAccountSeTeam` / `seTeam` capped at 4 members** in rules — fifth SE on account loses Firestore read/write paths.
- **`leadsSegmentContainingTeam` hard-coded to segments[0..2]** — org with 4+ segments: segment-4 leader proxy fails at rules.

---

### 2.6 Expansion prep — 501 removed but expansion product path still hollow

**Problem IDs:** DEAL-004 (claimed FIXED), SF-014, MOT-010 (claimed FIXED), JOIN-006

**Flow:** SE selects `prepType: expansion`, runs worker prep generate.

**Reality:** `worker/src/prep/index.ts` no longer returns 501. **`synthesizePrep` ignores `prepType`** — same NB synthesis template for expansion. Stale comment in `worker/src/prep/expansion-synthesize.md` still claims 501. Domain dual-write can create expansion deal + brief; worker output is **not expansion-specific**. Asymmetric MOT reduced, not eliminated.

---

### 2.7 Call view shows account-wide contacts, not deal join

**Problem IDs:** CONT-008 (claimed FIXED), JOIN-001 (partial)

**Flow:** User opens post-call call view for deal B on account with deals A and B.

**Reality:** Fix report claims CONT-008 fixed via account engagement detail (`listContactsByDeal`). **`call-view.js` still loads account-wide contacts:**

```1071:1075:web/call-view.js
  if (!resolvedContacts?.length && store?.listContactsByAccount) {
      resolvedContacts = await store.listContactsByAccount(accountId);
```

Deal panel in account/deal record path is fixed; **call timeline UI is not**.

---

### 2.8 History fallback — Firestore empty, manager views team dashboard

**Problem IDs:** ACC-004, LC-002, DEAL-013, DW-004

**Flow:** Store unreachable; SE has local post-call history only.

**Reality:** `listAccountRowsFromHistory` synthesizes `hist_*` rows; deal Tier-3 recovery in `call-view.js` picks newest non-archived deal. Cross-user visibility and deal linking **break** — documented gap, still user-visible in dev/offline and partial outages.

---

## 3. Claims vs reality — fix report disagreements

| Fix report claim | Adversarial finding | Problem IDs |
|------------------|---------------------|-------------|
| **42 FIXED** including ACC-001, ACC-002, CONT-007, JOIN-002, ORG-001–003, MOT-001–002, MOT-010 | **`ACCOUNT_DEAL_CONTACT_PROBLEMS.md` body still marks many entries `Status: open`** while summary table says FIXED — doc drift causes false confidence | Doc hygiene |
| ACC-001 / RBAC-001 **FIXED** — account read scoped | Read path improved via `canReadAccountData`. **Org leaders (`seniorLeaderIds`) get org-wide account read** without seTeam check — may exceed UI intent; not “any signed-in user” but still broad leak for sensitive accounts | ACC-001, ACC-002, RBAC-001, RBAC-004 |
| ACC-002 **FIXED** — UI `read_account` team/segment guard | UI `read_account` improved. **`manage_account_team` still:** `isManager && user.teamId && seTeamIds.length` — any manager on any team can manage any account with non-empty seTeam | ACC-002 (UI partial) |
| ACC-003 **FIXED** — segment scope in lifecycle listing | **`listLifecyclesForSession` handles `scope.type === "segment"`** — verified in code + test. **Senior leader in `seniorLeaderIds` who is not segment leader and not director** falls through to **team scope only** — no org rollup | ACC-003 (partial), ORG-007 |
| ORG-001 **FIXED** — proxy stamps target SE teamId | True for prep/post-call via `resolveActingWriteContext`. **`linkTaskToLifecycle` still uses `session.teamId`** | ORG-001, ORG-014 |
| DEAL-004 / MOT-010 **FIXED** — expansion prep enabled | 501 gate removed. **Worker synthesis not expansion-aware**; placeholder doc stale | DEAL-004, MOT-010, SF-014 |
| JOIN-001 / CONT-008 **FIXED** | **`getAccountEngagementDetail` uses `listContactsByDeal`** when deal selected — verified. **`deal-view.js` delegates to that path**. **`call-view.js` still account-wide** | JOIN-001, CONT-008 |
| TEST-002 **partial** — proxy tests added | Only **same-team** proxy + local store; **no Firestore deny path** | TEST-002, ORG-002 |
| TEST-004 **partial** — rules smoke test | **Static file grep only** — JOIN-002 could regress to default-deny without CI catching runtime behavior | TEST-004, JOIN-002 |
| MOT-001 **FIXED** — 90-day grace implemented | **`closedWonAt` + routing helpers exist and tests pass**. **`programPhase` not auto-flipped at day 91** (MOT-003 deferred); team allowlist can override after grace if phase stale | MOT-001, MOT-003, MOT-005, ACC-011 |
| DEAL-011 / RBAC-009 **FIXED** | `canReadDealResource` includes account seTeam path — good. **Deal owner attribution unchanged** — coaching still wrong, not read-denial | DEAL-001, DEAL-011 |

---

## 4. Edge cases

### 4.1 Multi-SE account

- **Single active deal per type per account** (`findActiveDeal`) — two SEs conflict on deal selection (DEAL-003).
- **Deal owner = primary SE**; secondary lifecycles diverge (DEAL-001, LC-011).
- **Rules `onAccountSeTeam` indexes 0–3 only** — account with 5+ SEs: member 5 loses direct rules path (implicit via manager read only).
- **`listDealsByAccount` no longer filters by acting owner** (DEAL-002 fix) — secondary sees all deals in UI list; attribution filters elsewhere may still hide work.

### 4.2 Cross-segment proxy

- UI `create_on_behalf` allows segment leader when `segmentTeamIds.includes(resource.teamId)`.
- Firestore `leadsSegmentContainingTeam` supports **max 3 segments** by index — fragile for org growth.
- Digital flat team (ORG-008): IC reports to segment leader, not team manager — depends entirely on segment-leader rules path; **untested in CI**.

### 4.3 History fallback

- `listAccountsForSession` catches failure → `listAccountRowsFromHistory` (ACC-004).
- `getAccountEngagementDetail` falls back when lifecycle dealId unset (LC-002).
- `deal-view.js` merges history extras when `_historyFallback` — deal/contact sets may not match Firestore joins.

### 4.4 Legacy preps / dual-write orphans

- Legacy `preps` uid collection vs domain `prepBriefs` (DW-003).
- Triple history: localStorage, Worker KV, Firestore (DW-004).
- `lionpath_briefs` parallel storage (DW-007).
- Non-transactional dual-write (DW-001) — partial failure after account+contacts still possible.

### 4.5 Won NB 90-day grace

- Tests prove routing at T+1 and T+91 via `shouldRouteWonNbToExpansion`.
- **`handoffToExpansion` enters grace** (no immediate expansion deal) — `test-deal-e2e` confirms.
- After 91 days: routing switches via timestamp math; **`programPhase` may remain `"live"`** until manual update — MOT-003, ACC-011.
- **`findActiveDeal` still ignores archived won NB** except via dedicated `findWonNbDealInGrace` in motion resolver — callers that skip motion resolver still break (DEAL-007 documented gap for non-motion paths).

---

## 5. Disagreements with likely Agent A findings

Agent A will likely **certify the fix pass green** based on all scripts passing and rules file presence. Agent B disagrees on severity:

| Agent A (predicted) | Agent B (adversarial) |
|---------------------|------------------------|
| “JOIN-002 / RBAC-005 closed — rules added” | Rules added but **unvalidated in emulator**; seTeam/segment index caps create **silent prod failures** |
| “ORG proxy fixed globally” | Fixed on **prep/post-call spine only**; `linkTaskToLifecycle`, `findLifecycleForCompany` still gate on **`session.teamId`** |
| “CONT-008 / JOIN-001 fixed” | Fixed on **account/deal engagement detail**; **call-view** still account-scoped — user-visible leak on call pages |
| “MOT-010 / DEAL-004 fixed — expansion prep unblocked” | **HTTP 501 gone** ≠ expansion prep product; worker uses **same synthesize path** |
| “ACC-003 fixed — segment leaders see lifecycles” | True for **segment leaders with `getSegmentForLeader`**. **Not** for seniorLeader-only without segment assignment; ORG-007 tension remains for Firestore `isOrgLeader` reads |
| “42 FIXED — ship 2.1.24” | **~15–20 IDs** remain functionally broken or partially fixed; problems doc **per-entry status stale** |
| “TEST-002/004 partial acceptable” | **False confidence** — production blockers (ORG-002, JOIN-002 runtime) explicitly deferred from automated proof |

---

## 6. Grep findings (mandated patterns)

### 6.1 Remaining `isSignedIn()` open reads on accounts/contacts

**Accounts/contacts read paths:** No longer bare `isSignedIn()` — use `canReadAccountData` / parent account lookup. **Improvement real.**

**Still permissive:**

| Location | Pattern | Risk |
|----------|---------|------|
| `firestore.rules:237` | `accounts` **create**: `isSignedIn()` | ACC-010 |
| `firestore.rules:168-173` | `canReadAccountData` includes **`isManager() && isOrgLeader()`** without account linkage | ACC-002 / RBAC-004 at Firestore layer |
| `firestore.rules:337+` | rubrics, priceBooks: `read: isSignedIn()` | Out of scope but org-wide reference data leak |

### 6.2 `session.teamId` in dual-write where SE teamId should be used

| File | Line | Context |
|------|------|---------|
| `dual-write.js:654` | `teamId: session.teamId` | **`linkTaskToLifecycle`** — should use `resolveActingWriteContext` |
| `dual-write.js:645-646` | guard `!session?.teamId` | Blocks director/null-team sessions on task link |
| `acting-owner.js:132` | fallback `ownerUser?.teamId \|\| session?.teamId` | If SE user doc missing `teamId`, falls back to manager team — wrong stamp |

Prep/post-call paths correctly destructure `{ teamId }` from `resolveActingWriteContext` — **primary path fixed**.

### 6.3 Expansion prep 501 remnants

- **`worker/src/prep/index.ts`:** no 501 — gate removed ✓
- **`worker/src/prep/expansion-synthesize.md:8`:** stale “returns 501” comment — **doc debt**
- **`synthesize.ts`:** no `prepType` branch — expansion prep content not differentiated

### 6.4 Missing segment scope in lifecycle listing

**Not missing** in current code:

```409:409:web/domain/lifecycle-service.js
    } else if (scope.type === "team" || scope.type === "segment") {
```

`test-account-deal-fixes.mjs` covers segment leader **not** in `seniorLeaderIds`. Does **not** cover segment leader who is also `seniorLeaderIds` + org-wide Firestore read side effects.

### 6.5 Contact duplicate paths not using `resolveContactOnAccount`

| Path | Uses `resolveContactOnAccount`? |
|------|--------------------------------|
| `account-service.js` `upsertAccountFromPrep` | **Yes** ✓ |
| `contact-service.js` `applyPostCallContactFrameworks` (email) | **Yes** ✓ |
| `applyPostCallContactFrameworks` (name-only) | **No** — `normalizeName` scan (CONT-002) |
| `applyPrepContactFrameworks` | **No** — assumes contact exists via `findContactByAccountEmail` only (safe if upsert ran first) |
| `postcall-contact-resolve.js` | **No** — read-only CRM lookup (by design) |
| `dual-write.js` ~616 | Direct `findContactByAccountEmail` in post-call identity block |

Primary duplicate-**creation** path is guarded; duplicate-**matching** on name-only post-call is not.

---

## 7. Prioritized fix list

### P0 — Blockers & prod integrity

| Priority | Problem IDs | Action |
|----------|-------------|--------|
| P0-1 | TEST-004, JOIN-002, RBAC-005 | Firebase **rules emulator tests** for `dealContacts` create/read/deny matrix |
| P0-2 | ORG-001, ORG-014, RBAC-006 | Route **`linkTaskToLifecycle`** (and `findLifecycleForCompany` guards) through **`resolveActingWriteContext`** |
| P0-3 | ORG-002, ORG-008, ORG-011, RBAC-002, TEST-002 | CI test: **segment leader cross-team proxy** write against rules (Digital flat team fixture) |
| P0-4 | ACC-010, RBAC-001 | Tighten **account create/update** rules; narrow **`canReadAccountData` org-leader** branch to seTeam/segment linkage |
| P0-5 | ACC-002 | Fix **`manage_account_team`** — same team/segment guards as `read_account` |
| P0-6 | Firestore caps | Replace hard-coded **seTeam[0..3]** and **segments[0..2]** with loop-capable rules or denormalized `account.orgId` + membership map |

### P1 — User-visible wrong behavior

| Priority | Problem IDs | Action |
|----------|-------------|--------|
| P1-1 | CONT-002, CONT-008, JOIN-001 | Name-only post-call: require email or use `resolveContactOnAccount`; **call-view** → `listContactsByDeal` |
| P1-2 | DEAL-001, DEAL-003, ORG-004, ORG-012 | Deal owner vs acting SE policy (primary vs lifecycle owner) |
| P1-3 | MOT-003, ACC-011, MOT-005 | Day-91 **`programPhase`** flip job or document-only UI state sync |
| P1-4 | DEAL-004, MOT-010, SF-014 | Wire **expansion synthesize template** or flag worker output as NB-placeholder |
| P1-5 | CONT-005, ACC-005, ACC-009 | Account domain disambiguation + explicit `accountId` bypass audit |
| P1-6 | ORG-005, DW-004 | Proxy history email under manager fallback |
| P1-7 | TEST-003 | **`test-deal-view.mjs`** assert deal-scoped contacts |

### P2 — Deferred but tracked

| Priority | Problem IDs | Notes |
|----------|-------------|-------|
| P2 | SF-001–SF-013, JOIN-006 | SF sync + worker-side joins |
| P2 | ACC-004, LC-010, DW-003, DW-007 | Legacy/history/migration |
| P2 | ORG-007, DEAL-015 | Senior leader scope vs segment dashboard product rules |
| P2 | Doc | Sync **`ACCOUNT_DEAL_CONTACT_PROBLEMS.md`** per-entry `Status` with fix report |

---

## 8. Return summary (for parent agent)

**Review doc path:** `docs/ULTRA_REVIEW_B.md`

**Test pass/fail:** **8/8 PASS** (all mandated scripts exit 0)

**Top 5 breakage scenarios:**

1. **Cross-team segment-leader proxy (Digital flat team)** — UI allows, Firestore/rules fragility untested in CI (ORG-002, ORG-008, RBAC-002).
2. **Director / null-team task linking** — `linkTaskToLifecycle` still requires and stamps `session.teamId` (ORG-014, ORG-001).
3. **Post-call name-only contact match** — wrong contact frameworks (CONT-002).
4. **Call view account-wide contacts** — deal join fix did not reach call UI (CONT-008, JOIN-001).
5. **Firestore rules unproven at runtime** — static grep ≠ emulator; org-leader blanket account read + account create wide open (ACC-010, RBAC-001, TEST-004).

---

*End of Ultra Review B.*
