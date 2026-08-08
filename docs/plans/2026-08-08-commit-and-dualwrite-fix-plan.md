# Implementation Plan — Two Post-Call Bugs (GLM-5.2 decisions)

Branch: 2.1 | Repo: /root/lionpath_V2 | Implementer: Codex (gpt-5.5)

## GLM-5.2 decisions
- **BUG 1 (commit 500 / malformed JSON):** Option 2 (provider-layer JSON-parse retry) +
  Option 1 (bump commit maxTokens 4000 → 8000).
- **BUG 2 (dual-write permission / deal owner mismatch):** Option 1 (server-side deal
  creation via admin SDK). No firestore.rules changes.
- **Order:** BUG 2 first (upstream blocker — technical commit is deal-scoped, needs a deal
  to attach to), then BUG 1. Two separate commits.

---

## BUG 2 — Server-side deal creation via admin SDK

### File 1: worker/src/routes.ts
Add route `POST /api/deals` (match existing route conventions in this file).
- Body: `{ accountId, name, stage, type, ...dealFields }` + actor identity from auth context.
- Server-side logic:
  1. Fetch account doc via admin SDK (`firestore-admin`, already initialized in worker).
  2. Resolve `ownerId = account.primarySeUserId || actorId` (mirror `resolveDealOwnerId`
     from `web/domain/deal-motion.js:242`).
  3. Resolve `teamId`, `orgId`, `segmentId` from the account.
  4. Create deal doc via admin SDK `db.collection('deals').add({ ownerId, teamId, orgId,
     ...dealFields, createdAt, createdBy: actorId })`.
  5. Return `{ dealId, ownerId }`.
- Auth: require authenticated SE (same auth middleware as other worker routes). Admin SDK
  bypasses Firestore rules — no rule change needed.

### File 2: web/domain/deal-motion.js (or deal-service.js — trace the actual Firestore add() call)
- Replace the client-side Firestore `add()` call with `fetch('/api/deals', { method:
  'POST', body: ... })` to the new worker route.
- Keep `resolveDealOwnerId` as local fallback/reference, but actual owner resolution now
  happens server-side. Remove/deprecate client-side owner resolution to avoid drift.
- Only the post-call dual-write path routes through the worker. Manual UI deal-create stays
  client-side with existing rules.

### File 3: firestore.rules
- NO changes.

### File 4: rules-tests/deals.test.mjs (new or extend dealContacts.test.mjs)
- Test: client-side deal creation by a non-primary SE still returns permission-denied
  (confirms no regression — rule not loosened).

---

## BUG 1 — JSON-parse retry + commit maxTokens bump

### File 1: worker/src/postcall/commit.ts (line ~330)
- Change `maxTokens: 4000` → `maxTokens: 8000`.
- Replace `provider.generate(...)` + `extractJson(...)` sequence with the new
  `generateJsonWithRetry` helper.

### File 2: worker/src/providers/index.ts (or json.ts — wherever provider type is importable)
- Add exported `generateJsonWithRetry(provider, generateParams, extractOpts)`:
  1. Call `provider.generate(generateParams)`.
  2. Try `extractJson(output, extractOpts)`.
  3. If it throws, check: does `output.length >= 0.9 * maxTokens` OR does output end
     mid-string (no closing `}`)? If yes → truncation likely.
  4. Retry up to 2 times with `maxTokens = Math.ceil(maxTokens * 1.5)`. On retry, optionally
     prepend a system hint: "Continue the JSON object from where the previous response was
     cut off. Start from the last valid key."
  5. If all retries fail, throw the original extractJson error.
- Keep provider-agnostic (takes provider as param).

### File 3: worker/src/postcall/commit.ts
- Import `generateJsonWithRetry` and use it in place of raw generate + extractJson.

### File 4: worker/src/__tests__/json-retry.test.mjs (new)
- Mock a provider returning truncated string first, full JSON second.
- Assert generateJsonWithRetry returns parsed JSON.
- Assert it does NOT retry on genuine schema mismatch (only truncation-shaped failures).

---

## Verification
1. `npx firebase emulators:exec --only firestore --project lionpath-rules-test "node accounts.test.mjs && node dealContacts.test.mjs && node users.test.mjs"` (and deals test if added).
2. End-to-end: trigger post-call on account where actor != primarySeUserId → commit pass
   returns 200 with technicalCommit, deal created + linked, post-call doc has both
   technicalCommit and dealId, no 500s, no permission errors.
3. Check worker logs for generateJson retry events.

## Constraints
- Two separate commits (Bug 2, then Bug 1). Do NOT bundle.
- Do NOT touch firestore.rules.
- Do NOT change manual UI deal-create path.
- Commit after each task. Push to origin/2.1 when done.
