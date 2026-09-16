Shared via Gideon (CLI) — Architecture Decision for Boss

## Firestore WebChannel Retry Loop — Root Cause & Fix Plan

### The Problem
SE users on portal.benjaminsquare.com see a perpetual browser console flood:
(anonymous) @ webchannel_blob_es2018.js:56 (repeating every 1-2 seconds)

This is the Firestore SDK's WebChannel transport retrying indefinitely after permission-denied errors.

### Root Cause (identified after 6 iterations)
The import of firebase-firestore.js at app module load initializes the WebChannel transport as a side effect for ALL users — including SEs who don't need it. The worker API handles all data for SEs via Firestore Admin SDK.

### Previous Attempts (all failed)
1. Subscribe error handlers unsubscribe on permission-denied — transport still retries at SDK level
2. fb.db = null at startup — transport already initialized by module import
3. fsMod.terminate() after role enrichment — too late, module already loaded

### Final Fix (GLM-5.2 Approved: Option A)
✅ Lazy-import firebase-firestore.js only for manager/admin users
✅ SE users never load the module → no WebChannel transport → no retry
✅ Verifiable in Network tab: SEs see zero firebase-firestore.js requests
✅ Zero risk to managers/admins (they get the module loaded after role confirmation)

### Implementation (for Codex)
~40 lines across 4 files:
1. Remove firebase-firestore.js from the initial Promise.all import
2. Add lazy loader (ensureFirestore()) to the fb object
3. Gate Firestore init on role in syncSessionWithDomainStore
4. Tighten null-guards in api-store.js
5. Add role gate + ensureFirestore() in dashboard/component onMount

Ready to deploy when Antony's push lands.
