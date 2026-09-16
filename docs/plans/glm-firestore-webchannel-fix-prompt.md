Task: Analyze and plan a fix for the Firestore WebChannel perpetual retry loop on portal.benjaminsquare.com.

## Context
- Portal serves SEs (role="se") at portal.benjaminsquare.com
- Firestore security rules deny broad reads for SEs (canReadTeamResource requires ownership/team/org match, but account data lacks seTeam.seUserId matching the logged-in SE)
- When Firestore `onSnapshot` queries fail with permission-denied, the SDK's WebChannel transport keeps retrying indefinitely
- Worker API (portalapi.benjaminsquare.com) handles all data reads for SEs via Firestore Admin SDK

## What's been tried so far
1. Subscribe error handlers now unsubscribe on permission-denied (firestore-store.js)
2. `fb?.db ? createFirestoreStore(fb) : null` guard in api-store.js
3. `fsMod.terminate()` + `fb.db = null` after session enrichment
4. `fb.db` initialized to null, only lazily created for manager/admin roles

## The remaining issue
The WebChannel transport is still being created because `completeFirebaseLogin` calls `syncSessionWithDomainStore` which may trigger Firestore listeners before the role check. The current approach of nullifying fb.db works when the session role is available in `ensureFirebaseSdk()`, but sometimes the role might not be in the session yet.

## Required analysis
1. Root cause: trace the complete login flow and find exactly where the Firestore WebChannel transport is first created
2. Exact fix: a bulletproof approach to ensure no Firestore transport is ever created for SE users
3. Risk assessment for managers/admins (who need Firestore realtime reads)
4. Implementation steps for Codex (gpt-5.5)
5. Verification steps

Be precise and decisive. Give exact file paths and code-level changes.
