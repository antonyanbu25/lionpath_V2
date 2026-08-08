# Root-Cause Analysis: Dashboard shows 8 not 48 + Call page slow

## Two separate problems with different root causes

---

### Problem 1: Dashboard shows 8 calls, not 48

**Root cause is NOT our merge fix.** The log proves it:

```
history.js:256 [history] loaded 48 record(s) from server for sathish.kuttan@freshworks.com
app.js:1751 [app] loaded 48 post-call record(s) for sathish.kuttan@freshworks.com
app.js:717 [app] calls snapshot failed: Missing or insufficient permissions.
```

48 records are loaded from Worker KV into localStorage. Then `renderSeLaunchpadOnce` runs and reads from localStorage -> 48 records -> should show 48.

**BUT the Firestore postCalls snapshot fails.** The `subscribeRemoteCalls` listener at `app.js:700-720` does:
```js
fb.query(fb.collection(fb.db, "postCalls"), fb.where("ownerId", "==", user.uid))
```
The error: `Missing or insufficient permissions` on this query.

The Firestore rules say:
```
match /postCalls/{docId} {
  allow read: if canReadTeamResource(resource.data.ownerId, resource.data.teamId, resource.data.orgId);
}
```

`canReadTeamResource` calls `isOwner(ownerId)` which checks `currentUserId() == ownerId`. The problem is `currentUserId()` resolves via `authIndex/FIREBASE_AUTH_UID` -> `userId`. The Firestore docs have `ownerId` as the internal User.id (like `usr_xxx`), NOT the Firebase auth UID. So `currentUserId()` returns `usr_xxx` but the postCalls `ownerId` might be storing the Firebase auth UID, or vice versa.

**BUT the real question: if 48 are in localStorage, why does the dashboard show 8?**

The dashboard count comes from `buildLaunchpadCallMetricsFromRecords(callRecords)` which = `dedupeAnalysesByCallIdentity(listPostCallAnalyses(email))`. After our force-reconcile patch in `renderSeLaunchpadOnce`, it re-reads from localStorage which has 48. So it should show 48.

UNLESS `listPostCallAnalyses` filters differently. Let me check `listAnalysesWithQuality` — the dashboard KPI uses `buildLaunchpadCallMetricsFromRecords` not `listAnalysesWithQuality`. That's just `dedupeAnalysesByCallIdentity(listPostCallAnalyses(email))` which should return all records.

**Unless the Worker KV doesn't actually have all records for this user?** The "loaded 48" is counting ALL records loaded via `syncHistoryOnLogin`, which merges Worker KV records into localStorage. If 48 merged, then `listPostCallAnalyses(email)` returns 48. The dashboard KPI grid uses `buildLaunchpadCallMetricsFromRecords` which counts ALL deduped records.

**This means the force-reconcile patch should fix it.** After a hard refresh:
1. Worker KV sends 48 records
2. `syncHistoryOnLogin` writes them to localStorage
3. `renderSeLaunchpadOnce` reads 48 from localStorage via `listPostCallAnalyses`
4. Dashboard shows 48

If it STILL shows 8, then the Worker KV doesn't have the full 48 for this user (the "loaded 48" includes OTHER users' records from a different call).

**We must verify by checking the actual Worker KV files.**

---

### Problem 2: Call page slow

**Root cause:** The entire `loadCallBundle` function makes 6+ Firestore reads that ALL fail with permission errors. Each `safeEnrich` call awaits the failing request (takes time to get denied), then silently falls back.

Each failed call adds latency:
1. `store.getCall(record.id)` — `GET /api/calls/call_xxx` returns 404 (API store) or Firestore permission denied
2. `store.listProductGapsByPostCall(record.id)` — fails
3. `store.listWhatWorksByPostCall(record.id)` — fails
4. `store.listTcDeltasByCall(record.id)` — fails
5. `store.listMeddpiccDeltasByCall(record.id)` — fails
6. `store.listDealsByAccount(accountId)` — fails (404 on `GET /api/deals?scope=own&limit=300`)

The API store (`portalapi.benjaminsquare.com/api/*`) returns 404 for EVERYTHING — accounts, deals, calls. This means the API backend is either not deployed or the routes don't match. The `api-store.js` tries the API, gets 404, then falls through... but the Firestore reads also fail with "Missing or insufficient permissions".

**Firestore rules bug:**
The root issue is that `authIndex` maps Firebase auth UIDs to internal User IDs (`usr_xxx`). But the `postCalls`, `scorecards`, etc. may store `ownerId` as the Firebase auth UID (from the session token's `uid`) instead of the internal User.id. The rules expect `currentUserId()` (from `authIndex`) to equal `ownerId`.

OR: The records in Firestore were never dual-written properly — the `postCalls` collection might not exist for this user because the dual-write happens during postcall which uses the store (Firestore admin from the server), not client-side Firestore.

## Fix Plan

### Fix A: Skip failing Firestore enrichment on call page entirely (instant fix)

The call page already renders from localStorage with full data (`buildLocalCallBundle` reads everything from `record.result`). The Firestore enrichment tries to add more detail (product gaps, what works, TC deltas, etc.) but these ALL fail. We should skip them entirely when none of the data is available locally — or better, skip the Firestore/API-store reads when the store mode returns permission denied on the first call.

**File: web/call-view.js** — `loadCallBundle` function

Add a flag at the top: if `getCall`/`getPostCall` fails on the first attempt, skip ALL subsequent enrichment calls immediately instead of trying each one separately and awaiting each failure.

**Change:** After the `domainCall` fetch at line 2365, if it returned null and the error was permission-denied, skip all the parallel enrichment calls.

### Fix B: Verify Worker KV has the right data

We need to SSH into the VPS and check the Worker KV file for `sathish.kuttan@freshworks.com` to confirm it has 48 records, then inspect one to see if it has the full `result` blob.

### Fix C: Firestore rules — if needed

If the `ownerId` mismatch is confirmed, update `firestore.rules` or the data to make `postCalls` readable by `ownerId` filter. But this needs investigation first.
