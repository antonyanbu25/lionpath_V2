# Implementation Plan — Near-realtime reads via Firestore onSnapshot (GLM-5.2 decision)

Branch: 2.1 | Repo: /root/lionpath_V2 | Implementer: Codex (gpt-5.5)

## GLM-5.2 decision
**Option A — Firestore native `onSnapshot` realtime listeners for reads in production.**
Reject B (SSE/WebSocket) and C (BigQuery/RAG). The 30s TTL cache in api-store.js and the
6/11-query server fan-out in the worker are the root cause of the slow ARR bar. Switch reads
to the browser Firestore SDK (which already works on localhost). Keep the worker API for
admin-privileged writes (deal create).

## Phase 0 — Rules audit (DONE, verified)
All collections the views touch already have browser-readable rules scoped by
`canReadTeamResource` / `canReadDealResource` / `canReadAccountData` (owner/team/org):
deals, arrLines, timelineSegments, timelineMarkers, videoFacts, scorecards, objections,
followUps, momDrafts, meddpiccDeltas, tcDeltas, dealSignals, productGaps, whatWorks,
technicalCommits, dealSummaries, postCalls, prepBriefs, accounts. NO firestore.rules changes
needed. Phase 0 gate passes.

## Phase 1 — Split store mode into read vs write
**File: web/domain/store.js**
1. `resolveStoreMode()` currently returns `"api"` in production. Change it so production READS
   use the browser Firestore SDK (`"firestore"`), like localhost already does.
2. Add `resolveWriteMode()` → returns `"api"` in production (admin writes stay on worker),
   `"firestore"` on localhost.
3. Wire the factory: reads → `createFirestoreStore(fb)`, writes → `createApiStore(...)`.
   Keep a `resolveStoreMode()` shim for legacy callers.
4. Add a `?storeMode=api` URL param override that forces read mode to `"api"` for one session
   (rollback kill-switch).

## Phase 2 — Add subscription builders in firestore-store
**File: web/domain/firestore-store.js**
1. `subscribeDealsByOwner(uid, cb)` → `onSnapshot(query(collection(db,'deals'), where('ownerId','==',uid)), cb)`.
2. `subscribeDealDetail(dealId, cb)` → parallel `onSnapshot` on the 6 subcollections
   (dealSummaries, technicalCommits, dealSignals, arrLines, productGaps, whatWorks — all
   `where('dealId','==',dealId)`), merge into one callback shaped like the current
   `getDealDetail` return. Return a single unsubscribe that tears down all.
3. `subscribeCallDetail(callId, cb)` → parallel `onSnapshot` on the 11 subcollections
   (scorecards, arrLines, videoFacts, timelineSegments, timelineMarkers, followUps, objections,
   momDrafts, meddpiccDeltas, tcDeltas, dealSignals — all `where('callId','==',callId)`), merge,
   return single unsubscribe.
4. `subscribeArrLinesByDeal(dealId, cb)` → standalone for the ARR bar.
5. Mirror the exact response shape of api-store's getDealDetail/getPostCallDetail so view code
   doesn't change shape, only source.

## Phase 3 — Wire subscriptions into app + views
**File: web/app.js**
1. Extend the existing `buildSubscribeRemoteCalls` / `buildSubscribeRemotePreps` pattern.
2. Add `buildSubscribeRemoteDeals()`, `buildSubscribeRemoteDealDetail(dealId)`,
   `buildSubscribeRemoteCallDetail(callId)` — each returns an unsubscribe fn. Subscribe on
   auth, unsubscribe on sign-out / route change.

**File: web/dashboard.js**
1. Replace the `apiStore.listDeals()` call (and 30s polling) with the deals subscription.
2. KPIs + recent activity re-render in the onSnapshot callback.

**File: web/deal-view.js**
1. On mount: `subscribeDealDetail(dealId)` + `subscribeArrLinesByDeal(dealId)`.
2. Remove the slow loading-skeleton "big bar" path — onSnapshot fires the initial snapshot
   from cache in <100ms; render immediately, refine on server sync.
3. On unmount: call returned unsubscribe fns (critical — leaks cause duplicate listeners).

**File: web/call-view.js**
1. On mount: `subscribeCallDetail(callId)`.
2. When the call detail snapshot updates, re-render timeline + ARR + follow-ups + objections.

## Phase 4 — Fix the two UI bugs
**Bug 1 — Timeline not loaded.** File: web/call-view.js (~line 2082, renderTimelineSection)
1. When `hasVideo && !timeline.segments.length`: fall back to deriving segments from
   `videoFacts` (videoFacts contain start/end + topic — assemble a minimal timeline).
2. Keep "Timeline not loaded" only when BOTH timelineSegments and videoFacts are empty.

**Bug 2 — Slow ARR bar.** Resolved by Phase 2+3 (ARR arrives via subscribeArrLinesByDeal
onSnapshot, initial cache snapshot <100ms). Delete the skeleton's 60s timeout/resize logic.

## Phase 5 — Trim the API store
**File: web/domain/api-store.js**
1. Mark getDealDetail/getPostCallDetail/listDeals/listArrLinesByDeal as deprecated for read
   views (now handled by firestore-store). Keep write methods (createDealViaWorker, etc.).
2. Add a one-line console.warn if a view accidentally calls the deprecated read paths.

## Constraints
- Do NOT touch firestore.rules (Phase 0 verified no changes needed).
- Do NOT change the worker API write paths (deal create stays server-side).
- Commit after each phase. Push to origin/2.1 when done.

## Verification
1. Localhost (already firestore mode): dashboard, deal view, call view load and update on
   write within ~1s.
2. Production deploy: open portal, sign in, Network tab — no /api/deals/:id or /api/calls/:id
   GETs on view load; only Firestore WS traffic.
3. Console: zero permission-denied errors.
4. Trigger a write from another session → portal updates <1s without refresh.
5. Timeline: open a call with videoFacts but no timelineSegments → segments render from
   videoFacts fallback.
6. ARR bar: deal view loads in <500ms, no 60s shimmer.
7. Admin write: create a deal from the portal → still hits /api/deals POST, succeeds.
8. Rollback: append ?storeMode=api → reads revert to worker API, app still functional.
