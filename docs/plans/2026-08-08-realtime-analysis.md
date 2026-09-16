# Analysis — Why the dashboard/deal/call views aren't near-realtime, and the best fix

Date: 2026-08-08 | Branch: 2.1 | Repo: /root/lionpath_V2

## The user's ask
"Make the dashboard and whatever we fetch & show from Firebase to the web app almost
realtime (GCP is fast, right?)." Plus two concrete UI bugs seen in the portal:
1. "Timeline not loaded / Video was available, but visual analysis did not produce share
   segments" — timeline section shows empty even though videoFacts exist.
2. A big loading bar that takes ~a minute then resizes itself (the ARR / deal record load).

## Current architecture (why it's NOT realtime)

### Store mode
`web/domain/store.js` `resolveStoreMode()`:
- On **localhost** → `"firestore"` (browser Firestore SDK directly).
- On **production** (VPS/portal) → `"api"` (worker API via `fetch`).

So in production the web app reads ALL data through the worker API:
- `api-store.js` uses `fetch` to `/api/calls`, `/api/deals`, `/api/calls/:id`, `/api/deals/:id`,
  `/api/accounts`, etc.
- It has a **30-second TTL cache** (`DETAIL_TTL_MS = 30_000`, `DEALS_LIST_TTL_MS = 30_000`).
- Every read is a full HTTP round-trip to the worker, which then does MULTIPLE Firestore
  queries server-side via the admin SDK.

### Server-side read cost
- `getDealDetail` (worker/src/data/repositories/deals.ts:144) does **6 parallel Firestore
  queries** (summary, technicalCommit, dealSignals, arrLines, productGaps, whatWorks) per request.
- `getPostCallDetail` (calls.ts:151) does **11+ queries** (scorecards, arrLines, videoFacts,
  timelineSegments, timelineMarkers, followUps, objections, momDrafts, meddpiccDeltas, tcDeltas,
  dealSignals) per request.

### The dashboard DOES have realtime listeners — but only for 2 things
`app.js` `buildSubscribeRemoteCalls()` and `buildSubscribeRemotePreps()` use
`fb.onSnapshot` (Firestore realtime) for:
- `postCalls` where ownerId == user.uid (dashboard call count + recent activity)
- `preps` / `prepBriefs` (dashboard prep count)

These are the ONLY realtime paths. Everything else (deals, ARR, timeline, call detail,
deal detail) goes through the API store with 30s TTL → NOT realtime.

## Root cause of the two UI bugs
1. **Timeline not loaded**: `renderTimelineSection` (call-view.js:2082) shows "Timeline not
   loaded" when `hasVideo` is true but `timeline.segments` is empty. The call has `videoFacts`
   but no `timelineSegments` were persisted (or they're in the API detail but the timeline
   assembly didn't pick them up). This is a data-persistence/assembly gap, separate from realtime.
2. **Slow ARR bar (~1 min)**: the deal record loads ARR via `listArrLinesByDeal` → in API mode
   → `loadDealDetail` → `fetch /api/deals/:id` → 6 server queries, with 30s TTL. The big
   loading bar is the skeleton/shimmer showing while this slow chain resolves.

## The best fix (for GLM-5.2 to decide)

### Option A — Use Firestore realtime listeners (onSnapshot) for reads in production
Firestore's native `onSnapshot` is designed for exactly this: sub-second updates, delta sync,
no server round-trip. The browser SDK enforces `firestore.rules` (RBAC stays intact). This is
the "GCP is fast" answer — Firestore realtime is the fastest way to push changes to the client.

- Change `resolveStoreMode` so production uses the browser Firestore SDK for READS (like
  localhost already does), OR add realtime subscriptions for the deal/call/ARR/timeline data
  the way the dashboard already does for postCalls/preps.
- Keep the worker API for WRITES that need admin privileges (e.g. the server-side deal create
  we just added) and for heavy/aggregate reads.
- Risk: must confirm `firestore.rules` allows the browser to read everything the views need
  (deals, arrLines, timelineSegments, etc.) for the signed-in user's scope. The rules already
  gate reads by owner/team/org, so this should work — but needs verification.

### Option B — Server push / SSE / WebSocket from the worker
The worker pushes change events to the browser over SSE/WebSocket. More moving parts, more
latency than Firestore's native sync, and reimplements what Firestore already does. Not
recommended.

### Option C — BigQuery / RAG
BigQuery is for analytics over large datasets, not for pushing a single user's dashboard
updates in realtime — wrong tool. RAG is for semantic search, not realtime sync. Neither
addresses "make the dashboard update fast." Reject both for this use case.

### Recommendation
**Option A** — lean on Firestore's native realtime listeners for the data the user is
actively viewing (deals, ARR, timeline, call detail), mirroring the pattern the dashboard
already uses for postCalls/preps. This is the lowest-latency, lowest-complexity path and
directly answers "GCP is fast." Keep the API store for admin-privileged writes.

## Files involved
- `web/domain/store.js` — store mode resolution
- `web/domain/api-store.js` — 30s TTL fetch reads
- `web/domain/firestore-store.js` — browser Firestore reads (already exists, used on localhost)
- `web/app.js` — existing onSnapshot subscription builders (pattern to extend)
- `web/dashboard.js`, `web/deal-view.js`, `web/call-view.js` — view load paths
- `firestore.rules` — verify browser read access for the new realtime queries

## Verification
- Dashboard KPIs + recent activity update within ~1s of a change (not 30s).
- Deal record (ARR, traction, timeline) loads fast and updates when data changes.
- Timeline section shows segments when videoFacts exist (fix the assembly gap too).
- No permission-denied errors in console (rules allow the realtime reads).
- Worker API still used for admin writes (deal create).
