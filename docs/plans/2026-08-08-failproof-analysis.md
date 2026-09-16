# Analysis — Two critical production bugs (from live portal log)

Date: 2026-08-08 | Branch: 2.1 | Repo: /root/lionpath_V2

## Evidence (live portal log, sathish.kuttan@freshworks.com)

### BUG A — Commit 500 persists despite the retry fix
```
POST https://portalapi.benjaminsquare.com/api/postcall/commit 500
[postcall] commit soft-fail: Could not parse JSON from model output:
  Expected ',' or '}' after property value in JSON at position 1489. Preview: {
  "status": "pending", "justification": "The customer expressed satisfaction with the
  product and requested a contra…ill in the process of reviewing the proposal and
  contract draft provided by the AE. The customer is still in the process
[postcall] deferred commit soft-fail: Could not parse JSON from model output: ... position 1489
```
The SAME error at position 1489 appears on BOTH the initial call AND the retry call.

**Root cause of why the retry doesn't help:** the retry is DETERMINISTIC.
- `worker/src/providers/index.ts:110` `postcallSeedFromPrompt(passName, user)` derives a
  stable seed from `passName + user`.
- `index.ts:132` forces `temperature = req.temperature ?? 0`.
- So the retry (commit.ts:349, `maxTokens: 6000`) uses the SAME seed + SAME temperature +
  SAME prompt → Gemini returns the SAME truncated output at position 1489. The retry is
  pointless as written.

**Fix:** the retry must produce a DIFFERENT response. Options:
1. Vary the seed on retry (e.g. `seed + 1` or a random seed) so Gemini samples differently.
2. Raise temperature slightly on retry.
3. Add a "continue from where you left off" hint (append the partial JSON and ask to complete).
4. Best: combine — on retry, pass a different seed AND a system hint to continue the JSON.

### BUG B — Permission-denied cascade (technical commit, timeline, deal stage, dual-write)
The log is full of `Missing or insufficient permissions`:
```
[domain] meddpicc deal migration failed: Missing or insufficient permissions.
[call-view] getTechnicalCommitByDeal skipped (permissions)
[call-view] getCall skipped (permissions)
Lifecycle dual-write (post-call) failed: FirebaseError: Missing or insufficient permissions.
[postcall] ensure customer contact failed: Missing or insufficient permissions.
[postcall] prior technical commit lookup failed: Missing or insufficient permissions.
listDealsByAccount ordered query failed: hist_healthydietqa Missing or insufficient permissions.
search-service: account row index failed: hist_vivid-pix Missing or insufficient permissions.
```

**Root cause:** the browser Firestore SDK is being denied reads/writes it needs. Two sub-issues:
1. **History stub IDs** (`hist_*`, e.g. `hist_healthydietqa`, `hist_vivid-pix`, `hist_sendova`)
   are being passed to Firestore queries (`listDealsByAccount`), and the rules reject them.
   These are local-history records that don't exist in Firestore — the code should NOT query
   Firestore for them (the api-store already has `isHistoryStubId()` guards, but some paths
   bypass them).
2. **The technical commit / call detail / deal reads** are failing on permissions. This is why
   the technical commit doesn't load, the timeline is messed up (loads then disappears), and
   the deal stage on top is broken.

**Fix:** 
- The realtime refactor (in flight) switches reads to the browser Firestore SDK with proper
  rules — this should fix the permission cascade IF the rules allow the reads. Phase 0
  verified all collections have `canReadTeamResource` rules. But the `hist_*` stub IDs must
  be filtered out BEFORE hitting Firestore (the api-store `isHistoryStubId` guard must be
  applied consistently).
- The dual-write permission failure: the post-call dual-write writes to Firestore client-side
  and is denied. This needs the acting-owner context to match the rules (ownerId/teamId/orgId
  must be the caller's own, or the write must go through the worker admin SDK).

## What's in flight
- Codex is implementing the realtime refactor (store.js read/write split, firestore-store
  onSnapshot subscriptions, wiring into dashboard/deal-view/call-view). This is the right
  vehicle for the permission fix.

## Ask GLM-5.2
Give a FAILPROOF, bug-free implementation plan for Codex (gpt-5.5) that fixes BOTH:
1. The deterministic commit retry (so the retry actually produces a different, complete JSON).
2. The permission-denied cascade (technical commit, timeline, deal stage, dual-write) —
   including filtering hist_* stub IDs before Firestore queries, and ensuring the dual-write
   uses the correct acting-owner context or the worker admin SDK.
