# Analysis — Two Post-Call Bugs (commit 500 + dual-write permission)

Date: 2026-08-08
Branch: 2.1
Repo: /root/lionpath_V2

## Context
The P0 Firestore self-role-escalation fix (commit 18c4a18) is DONE, committed, pushed to
origin/2.1, and has a regression test (rules-tests/users.test.mjs). That is not the blocker.

Two REAL bugs surfaced while testing the post-call flow. Both block the technical-commit /
deal-linking feature. This doc is the investigation for GLM-5.2 to decide the fix, then
Codex implements.

---

## BUG 1 — POST /api/postcall/commit returns 500: malformed JSON from model

### Symptom
```
Could not parse JSON from model output: Expected ',' or '}' after property value in JSON at position 1489
```
The commit pass (Pass 5, produces the technical commit) fails, so the technical commit
never loads.

### Root cause
- `worker/src/postcall/commit.ts:330` calls `provider.generate({ maxTokens: 4000, ... })`.
- The COMMIT_SCHEMA (commit.ts:65-87) is LARGE: it requires `status`, `justification`,
  SIX TC slots (`incumbent`, `competitor`, `identifiedRisk`, `timelineForClosure`,
  `reasonForEvaluation`, `whatsWorking`), each with `value` + `evidence` + `surfaced`,
  plus the `aiAttach` object. That is a lot of output tokens.
- The error at "position 1489" is a truncated string — the model hit `maxTokens: 4000`
  mid-JSON and the output was cut off.
- `worker/src/json.ts` `extractJson()` has NO retry: it tries 3 candidate strings
  (raw, stripped fences, isolated object) × 2 (raw + repairJson) ONCE, then throws.
- The Gemini provider (`gemini.ts`) retries only on HTTP status (429/503/network) via
  `gemini-retry.ts` — it does NOT retry on malformed JSON. So a truncated response is a
  hard 500.

### Fix options (for GLM-5.2 to decide)
1. **Raise maxTokens** for the commit pass (e.g. 4000 → 8000). Cheap, but doesn't fix the
   general truncation case.
2. **Add a JSON-parse retry** in the provider layer: if `extractJson` throws, re-call
   `generate` once (or twice) with a higher maxTokens / a "continue from where you left
   off" hint. This is the robust fix — it handles any pass that truncates, not just commit.
3. **Repair truncated JSON** in `json.ts` (append closing braces / quote repair). Fragile;
   not recommended as primary.

Recommended: option 2 (retry on parse failure, bumping maxTokens on the retry), possibly
combined with option 1 for the commit pass specifically.

---

## BUG 2 — Lifecycle dual-write: "Missing or insufficient permissions" (deal/account linking)

### Symptom
The post-call dual-write fails on a Firestore permission error when creating/linking the
deal. The deal never gets created, so the technical commit (which is deal-scoped) can't
attach.

### Root cause
- `web/domain/deal-motion.js:242` `resolveDealOwnerId(accountId, actorId)` returns
  `account?.primarySeUserId || actorId`.
- So when a post-call runs on an account whose `primarySeUserId` is a DIFFERENT SE than the
  current actor, the deal is created with `ownerId = primarySeUserId` (someone else).
- The Firestore rule for deal create (`firestore.rules:300`):
  ```
  allow create: if canCreateTeamResource(request.resource.data.ownerId, request.resource.data.teamId, request.resource.data.orgId);
  ```
- `canCreateTeamResource` (firestore.rules:118-128) requires EITHER:
  - `canWriteOwnResource(ownerId)` → `currentUserId() == ownerId`, OR
  - `canWriteAsManagerForOwner(ownerId, ...)` → caller is `isManager()` AND owner is role
    `'se'` AND same team/org/segment.
- For a plain SE actor creating a deal owned by the account's primary SE (a different SE):
  - `canWriteOwnResource(primarySeUserId)` = false (actor != primary)
  - `canWriteAsManagerForOwner` = false (actor is not a manager)
  → **permission-denied**. The deal create fails.

This is the "deal issue": the deal/account linking write fails on permissions whenever the
acting SE is not the account's primary SE.

### Fix options (for GLM-5.2 to decide)
1. **Server-side deal creation**: have the worker create the deal via the admin SDK
   (firestore-admin) with elevated privileges, instead of the client writing directly.
   Cleanest, but a bigger change (new worker route or extend an existing one).
2. **Extend the rules** so any SE on the account's `seTeam` can create a deal owned by the
   account's primary SE (mirror `onAccountSeTeam`). Keeps client-side writes, but widens
   the rule surface.
3. **Make the deal owner the actor** (not the account primary SE) when the actor is the one
   doing the work. Simplest, but changes ownership semantics (deal would be owned by the
   acting SE, not the account's primary SE).

Recommended: option 1 (server-side deal create via admin SDK) is the most correct — it
removes the client-side ownership mismatch entirely and matches how the worker already
writes other derived rows. Option 2 is a lighter-touch alternative if a server route is
undesirable.

---

## Files touched (for Codex)
- `worker/src/postcall/commit.ts` (maxTokens / retry wiring)
- `worker/src/json.ts` or `worker/src/providers/*` (JSON-parse retry)
- `web/domain/deal-motion.js` / `web/domain/deal-service.js` (deal owner resolution)
- `worker/src/routes.ts` (if adding a server-side deal-create route)
- `firestore.rules` (only if option 2 chosen)
- `rules-tests/` (regression tests for whichever fix)

## Verification
- Commit pass: POST /api/postcall/commit returns 200 with a valid technicalCommit.
- Dual-write: post-call completes and the deal is created/linked without permission errors.
- Run `rules-tests` (note: run-all.mjs currently has an arg-ordering bug with the firebase
  CLI — run the inner command directly:
  `npx firebase emulators:exec --only firestore --project lionpath-rules-test "node accounts.test.mjs && node dealContacts.test.mjs && node users.test.mjs"`).
