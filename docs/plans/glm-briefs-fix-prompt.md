## Architecture Decision: Load Briefs via Worker API for SE Users

### Problem
The dashboard "All briefs" section shows "No briefs yet. Generate one from Pre-call to populate this list." for SE users, even when briefs exist.

### Root Cause
`queryRemotePrepCollections()` in `web/app.js` (line 541) has an early return:
```javascript
if (!isFirebaseAuthEnabled() || !fb?.auth?.currentUser || !fb?.db) {
    return { prepDocs: [], prepBriefDocs: [] };
}
```

When `fb.db` is null for SEs (lazy-init only for managers/admins), it returns empty arrays immediately. The briefs data is stored in Firestore ("preps" and "prepBriefs" collections) and is only queried via Firestore client SDK reads.

### Options
**Option A (Recommended): API-endpoint fallback**
Add a worker API endpoint that returns the user's briefs via Admin SDK (which bypasses security rules). Call this API when `fb.db` is null.

**Option B: Enable Firestore for briefs queries only**
Create a restricted Firestore instance just for reading briefs collections.

**Option C: Filter out the empty-state soon message**
Hide the "No briefs yet" text and show the Coming Soon page for the briefs section in dashboard too.

### Deliverable
Give me:
1. The simplest fix approach with exact code changes
2. File paths and line numbers
3. Risk assessment

The portal already has a worker API at portalapi.benjaminsquare.com with endpoints like /api/calls, /api/accounts, /api/deals. We can add a /api/briefs endpoint or reuse an existing pattern.

Be decisive. Give exact code for Codex.
