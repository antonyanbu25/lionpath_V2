You are implementing BUG 2 of a two-bug fix in the Lionpath SE portal (repo /root/lionpath_V2, branch 2.1). Bug 1 is already done. Implement ONLY Bug 2, per the plan below. Work task-by-task, commit after each task, and push to origin/2.1 when done.

## BUG 2 — Server-side deal creation via admin SDK

Problem: The post-call dual-write fails with "Missing or insufficient permissions" when creating/linking a deal. Root cause: `web/domain/deal-motion.js` `resolveDealOwnerId(accountId, actorId)` returns `account.primarySeUserId || actorId`. When the acting SE is not the account's primary SE, the deal is created with someone else's ownerId, and the Firestore rule `canCreateTeamResource()` (firestore.rules:300) denies the client-side write (actor is neither the owner nor a manager). So the deal never gets created, and the deal-scoped technical commit has nowhere to attach.

Decision (GLM-5.2): Move deal creation server-side via the admin SDK. NO firestore.rules changes. Preserve "deal owned by account's primary SE". Only the post-call dual-write path routes through the worker; the manual UI deal-create path stays client-side.

### Task 1 — Add POST /api/deals route in worker/src/routes.ts
- Add a handler `handleDealsCreate` and register it in the `routes` map (the map is `export const routes: Record<string, Record<string, RouteHandler>>` at routes.ts:1354; add `"/api/deals": { POST: handleDealsCreate }` — note there is already a GET handler for /api/deals in worker/src/routes/domain-reads.ts, so only add the POST method here).
- The handler must:
  1. `await requireUser(request, env)` (same as other handlers).
  2. Parse body `{ accountId, title, type, primaryContactId, ...dealFields }`.
  3. Use the admin SDK from `worker/src/data/firestore-admin.ts` (functions `getDb`, `getDoc`, `setDoc`). Get the account doc: `getDoc("accounts", accountId, env)`.
  4. Resolve `ownerId = account.primarySeUserId || actorId` (actorId from the authenticated user — check how other handlers resolve the current user id, e.g. via requireUser / resolveHistoryEmail; use the same pattern).
  5. Resolve `teamId`, `orgId` from the account doc (fall back to request body if absent).
  6. Create the deal doc via admin SDK `db.collection("deals").add({ accountId, ownerId, teamId, orgId, type, stage: "research", status: "active", title, primaryContactId, prepCount: 0, postCallCount: 0, openTaskCount: 0, latestQualityScore: null, createdAt, updatedAt, lastActivityAt, createdBy: actorId, createdVia: "postcall-dualwrite" })`. Use timestamps consistent with the rest of the codebase (check `now()` usage in web/domain).
  7. Return `{ dealId, ownerId }` with 200.
- Guard: if `!firestoreAdminReady(env)` return a clear error (see how other admin-SDK routes handle it, e.g. worker/src/routes/health.ts).

### Task 2 — Route the post-call dual-write deal creation through the worker
- In `web/domain/deal-service.js`, the functions `getOrCreateNewBusinessDeal` (line ~277) and `createExpansionDeal` (line ~312) and `createDealWithExplicitTitle` (line ~351) call `store.createDeal(...)` directly. The post-call flow reaches these via `resolveDealForEngagement` (line ~620) and `getOrCreateLifecycle` (web/domain/lifecycle-service.js).
- Add a server-side path: when the store is the API store (i.e. a workerBaseUrl is configured), create the deal by POSTing to `/api/deals` instead of `store.createDeal`. Keep `resolveDealOwnerId` as the intended-owner hint passed to the worker, but the worker re-validates by reading the account server-side.
- IMPORTANT: Do NOT change the manual UI deal-create path. Only the post-call dual-write path (the one reached from `resolveDealForEngagement` / `getOrCreateLifecycle` with `useSessionContext`) should route through the worker. If it's cleaner, add a flag/option to `createDealWithExplicitTitle` / `getOrCreateNewBusinessDeal` / `createExpansionDeal` (e.g. `opts.viaWorker`) that the post-call path sets, and only then use the fetch path.
- Check how the API store exposes the worker base URL and auth token (see `web/domain/api-store.js` `createApiStore({ workerBaseUrl, getToken, fb })` and how `apiFetch` builds the Authorization header). Reuse that pattern for the POST.

### Task 3 — Add a rules regression test
- Add `rules-tests/deals.test.mjs` (or extend an existing deals test) asserting that a client-side deal create by a non-primary SE is still permission-denied (confirms the rule was NOT loosened). Follow the existing test style in `rules-tests/users.test.mjs` (uses `setupEnv`, `seedPersona`, `authedContext`, `assertFails`/`assertSucceeds` from `./helpers.mjs`).
- Wire it into `rules-tests/run-all.mjs`'s inner command (add `node deals.test.mjs`).

## Constraints
- Do NOT touch firestore.rules.
- Do NOT change the manual UI deal-create path.
- Two separate commits: (1) worker route + web dual-write routing, (2) rules test. Commit after each.
- Match existing code style (this is a JS web app + TS worker; follow each file's conventions).
- After both commits, push to origin/2.1.

## Verification
- Run the rules tests directly (the run-all.mjs wrapper has an arg bug, so run the inner command):
  `cd /root/lionpath_V2/rules-tests && npx firebase emulators:exec --only firestore --project lionpath-rules-test "node accounts.test.mjs && node dealContacts.test.mjs && node users.test.mjs && node deals.test.mjs"`
- Confirm the worker TypeScript compiles (check for a build/typecheck script in worker/package.json and run it if present).
- Report what actually ran and returned. Do NOT claim success without running the tests.
