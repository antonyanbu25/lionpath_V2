# Firestore WebChannel Perpetual Retry — Architecture Decision

## Problem
Portal.benjaminsquare.com (Freshworks SE tool) has a constant WebChannel retry loop for SE users. The browser console floods with:

```
(anonymous) @ webchannel_blob_es2018.js:56
Promise.then
bind @ webchannel_blob_es2018.js:56
```

Repeating every 1-2 seconds indefinitely.

## Architecture Context
- **Store modes**: SE users operate in "api" mode (reads via portalapi.benjaminsquare.com worker, writes via admin API). Managers/admins use "firestore" mode (direct Firestore reads).
- **Firestore rules**: `canReadTeamResource()` checks ownerId/teamId/orgId — SEs can only read their own data. Accounts lack seTeam.seUserId matching the logged-in SE, so listAccounts/listDealsByAccount fail with permission-denied.
- **Worker API**: Uses Firestore Admin SDK (bypasses rules), handles all data for SEs.
- **Auth flow**: Firebase Google SSO → `completeFirebaseLogin` → `persistFirebaseSession` → `syncSessionWithDomainStore` → enriched session with role.

## What's been tried (deployed at commit a529d67)
1. `fb.db = null` initialized in fb object — no Firestore instance created at startup
2. `resolveReadMode()` returns "api" when `fb.db` is null — store uses worker API
3. `api-store.js` null-guards: `fb?.db ? createFirestoreStore(fb) : null`
4. Subscription error handlers unsubscribe on permission-denied
5. Manager/admin role checks before lazy-initializing Firestore

## The Remaining Problem
The import of `firebase-firestore.js` happens for ALL users at module load:

```javascript
const [{ initializeApp }, authMod, fsMod] = await Promise.all([
  import("firebase-app.js"),
  import("firebase-auth.js"),
  import("firebase-firestore.js"),  // THIS LOADS WebChannel for everyone
]);
```

This SDK module initializes the WebChannel transport as a side effect — even before `getFirestore(app)` is called. So the WebChannel retry starts for SE users before we can stop it.

## Options for Bulletproof Fix
### Option A: Lazy-import firebase-firestore.js
Only import firebase-firestore.js when the session role is known to be manager/admin. Keep imports for app and auth at startup (needed for sign-in UI).

### Option B: Terminate transport right after import
Import firebase-firestore.js for everyone but immediately call `fsMod.terminate(fsMod.getFirestore(app))` if the session role is SE — killing the WebChannel transport. This is the current approach but needs refinement.

### Option C: Conditional dynamic import
Keep the current approach (table stakes with fb.db = null) but add an explicit WebChannel transport kill in the dashboard/App init code path that first exercises Firestore subscriptions.

## Deliverable
1. Pick the best approach with justification
2. Give exact file paths and code-level changes for Codex (gpt-5.5)
3. Risk assessment for manager/admin users
4. Verification steps

Be decisive — this has been iterated 5+ times and needs to work.
