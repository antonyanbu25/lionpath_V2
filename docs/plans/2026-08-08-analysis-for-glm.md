# Analysis for GLM-5.2: Dashboard shows 8/48 + Call page slow

## My investigation so far

### Logs from the user's hard refresh of portal.benjaminsquare.com

Key log sequence:
```
history.js:256 [history] loaded 48 record(s) from server for sathish.kuttan@freshworks.com
app.js:1751 [app] loaded 48 post-call record(s) for sathish.kuttan@freshworks.com
app.js:717 [app] calls snapshot failed: Missing or insufficient permissions.
```

48 records loaded from Worker KV into localStorage successfully.

Then:
```
user-resolve.js:30 [user-resolve] getUserByEmail failed: Missing or insufficient permissions.
user-resolve.js:30 [user-resolve] getUser manager failed: Missing or insufficient permissions.
safe-store.js:60 [store] listDealsForAccount failed: Not found.
api-store.js:127  GET https://portalapi.benjaminsquare.com/api/deals?scope=own&limit=300 404 (Not Found)
api-store.js:127  GET https://portalapi.benjaminsquare.com/api/accounts 404 (Not Found)
```

The Portal API (portalapi.benjaminsquare.com/api/*) returns 404 for EVERYTHING — accounts, deals, calls.

Then when opening a specific call:
```
api-store.js:127  GET https://portalapi.benjaminsquare.com/api/calls/call_xxx 404 (Not Found)
call-view.js:2334 [call-view] getCall skipped (permissions)
call-view.js:2334 [call-view] listProductGapsByPostCall skipped (permissions)
call-view.js:2334 [call-view] listWhatWorksByPostCall skipped (permissions)
call-view.js:2334 [call-view] listTcDeltasByCall skipped (permissions)
call-view.js:2334 [call-view] listMeddpiccDeltasByCall skipped (permissions)
call-view.js:2334 [call-view] listDealsForAccount skipped: Not found.
```

### The Firestore rules issue

The `postCalls` collection is queried by ownerId:
```js
fb.query(fb.collection(fb.db, "postCalls"), fb.where("ownerId", "==", user.uid))
```
Where `user.uid` is the Firebase Auth UID.

Firestore rules:
```
match /postCalls/{docId} {
  allow read: if canReadTeamResource(resource.data.ownerId, resource.data.teamId, resource.data.orgId);
}
```
`canReadTeamResource` calls `isOwner(ownerId)` which does `currentUserId() == ownerId`.
`currentUserId()` reads from `authIndex/{authUid}.data.userId` which gives the INTERNAL user ID (e.g. `usr_xxx`).

So if Firestore `postCalls.ownerId` = Firebase auth UID (from `user.uid`), the rule checks `usr_xxx == firebase_uid` → FALSE → permission denied.

OR: The dual-write may not have created Firestore `postCalls` docs at all for this user — they might only exist in the Worker KV file-based history.

### The "8" mystery

The dashboard KPI count comes from:
```js
buildLaunchpadCallMetricsFromRecords(callRecords)
// = dedupeAnalysesByCallIdentity(listPostCallAnalyses(email)).length
```

`listPostCallAnalyses` reads from localStorage. If 48 were loaded and written, it should return 48. BUT `applyRemoteCallsToLaunchpad` fires from the Firestore snapshot callback — if the snapshot returns 8 docs (the only 8 that somehow have matching ownerIds OR are in a different collection), `mergePostCallRecordsIntoLocal` overwrites the 48 with 8.

OR: The `dedupeAnalysesByCallIdentity` dedupes by `callIdentityKey` (zoom link or title+date), so if the 48 Worker records overlap with the 8 Firestore docs, dedupe might reduce the count.

OR: The API-store `safeStoreOp` returns 404 for `listDealsForAccount` and these are caught and suppressed, but maybe the count is actually from a cached snapshot.

## What needs fixing

### Issue A: Skip failing Firestore enrichment in call-view.js loadCallBundle

`loadCallBundle` (web/call-view.js ~line 2354) makes 6+ enrichment calls:
1. `store.getCall(record.id)` or `store.getPostCall(record.id)` — fails with permissions/404
2. `store.listProductGapsByPostCall(record.id)` — fails
3. `store.listWhatWorksByPostCall(record.id)` — fails
4. `store.listTcDeltasByCall(record.id)` — fails
5. `store.listMeddpiccDeltasByCall(record.id)` — fails
6. `store.listDealsByAccount(accountId)` — fails (404 on portal API)

Each `safeEnrich` wraps an async call, catches the error, logs it, returns fallback. But each call still awaits the rejection/network timeout — adding ~500ms-3s per call, 6 calls = 3-18s of waiting for things that will NEVER succeed.

Fix: After the FIRST call (getCall/getPostCall) fails with permission-denied or 404, set a flag (`storeRejected = true`), skip ALL remaining enrichment calls. The call tab data is already fully in `record.result` (technicalCommit, summarise, pass6, etc.) loaded from localStorage.

### Issue B: Dashboard count — verify the snapshot merge path

The Firestore `subscribeRemoteCalls` listener fires and calls `applyRemoteCallsToLaunchpad` which calls `mergePostCallRecordsIntoLocal(email, remoteCalls)`. If `remoteCalls` has fewer records (e.g., 8 Firestore docs), it overwrites localStorage from 48 to 8.

Fix: `mergePostCallRecordsIntoLocal` should NOT reduce the local count — it should only ADD new records or UPDATE existing ones, never remove. Currently it writes the ENTIRE merged list to localStorage, which replaces the full 48 with just the 8.

OR: Make the dashboard NOT use the Firestore snapshot for the count — use the `fetchRemoteHistory` (Worker KV) instead, which has the authoritative 48.

### Issue C: Firestore rules or dual-write

Longer term: fix why postCalls aren't readable via Firestore. Either:
- The dual-write doesn't create Firestore postCalls docs (they only exist in Worker KV)
- The ownerId field uses the wrong ID format (Firebase auth UID vs internal User.id)

## Files involved

- `web/call-view.js` — `loadCallBundle` function ~line 2354
- `web/dashboard.js` — `applyRemoteCallsToLaunchpad` ~line 1395, `renderSeLaunchpadOnce` ~line 1852
- `web/history.js` — `mergePostCallRecordsIntoLocal` ~line 374, `syncHistoryOnLogin` ~line 220
- `web/app.js` — `buildSubscribeRemoteCalls` ~line 700
- `firestore.rules` — postCalls read rule ~line 326

## The plain English summary for the plan

There are two performance bugs:

1. **Call page is slow** because when you open a call, the code fires 6 Firestore/API requests to "enrich" the data with product gaps, what works, TC deltas, etc. Every single one of these requests FAILS with permission denied. But each one still waits for the rejection (500ms-3s). 6 × 3s = 18s of waiting for things that will always fail. The fix: once the first enrichment call fails, skip all the rest immediately — the call already has all its data from localStorage.

2. **Dashboard shows wrong count** because the Firestore realtime snapshot fires and overwrites the 48 Worker KV records with just 8 Firestore docs. The fix is to either make the merge NOT reduce the count, or use Worker KV as the primary source instead of the Firestore snapshot.

The API store (portalapi.benjaminsquare.com) returns 404 for everything — accounts, deals, calls. This may or may not be related and might be a separate deployment issue.

## Plan request

Please write a clear implementation plan that Codex (gpt-5.6-sol) can execute. The plan should:

1. Fix `call-view.js` `loadCallBundle` — skip enrichment after first rejection
2. Fix `dashboard.js` `applyRemoteCallsToLaunchpad` — don't let Firestore snapshot reduce the dashboard count below what Worker KV provided
3. Files to modify, exact code changes, and commit messages
