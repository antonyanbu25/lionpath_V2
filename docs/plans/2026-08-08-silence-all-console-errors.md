# Plan: Fix all console errors on first login

## Root cause

Three sources of console errors on first login:

### 1. Debug telemetry — `POST http://127.0.0.1:7865/ingest/... net::ERR_CONNECTION_REFUSED`

The source `web/app.js` has hardcoded `fetch(...)` calls to a local debug endpoint `http://127.0.0.1:7865/ingest/46e458f7-...`. These are wrapped in `.catch(() => {})` but the browser still logs the `net::ERR_CONNECTION_REFUSED` at the network level.

Fix: These are debug-only. The build (esbuild) doesn't strip them. Use a global flag `__DEBUG__` or wrap in `if (typeof __DEBUG__ !== 'undefined')`.

### 2. Portal API — `GET https://portalapi.benjaminsquare.com/api/* 404 (Not Found)`

`api-store.js` tries all API calls against `portalapi.benjaminsquare.com`. Every single endpoint returns 404 — accounts, deals, calls. The API backend is not deployed to that subdomain.

The `safeStoreOp` wrapper catches the error and converts to `console.warn`, but the 404 still shows in console devtools.

Fix: When the API store detects a 404 on the first call, cache a flag and skip all subsequent API calls silently. OR: detect in `firebase-config.js` that `portalapi` is unreachable and fall back to the Worker-only path.

### 3. Firestore permissions — multiple `Missing or insufficient permissions` errors

The Firestore rules exist in `firestore.rules` but are NOT deployed to the Firestore instance. Without deployed rules, Firestore uses default DENY ALL.

Every Firestore read fails:
- `getUserByEmail` → permission denied
- `postCalls` onSnapshot → permission denied  
- `getUser manager` → permission denied
- `listLifecyclesByOwner` → permission denied
- `listProductGapsByPostCall` → permission denied
- etc.

Fix: Deploy Firestore rules. OR: Catch these at a higher level and suppress the console noise when the store mode is 'api' (which means Firestore is not the primary backend).

---

## Files to modify

1. **web/app.js** — Strip or guard debug telemetry fetches
2. **web/domain/safe-store.js** — Make permission-denied and 404 errors silent (they're expected)
3. **web/call-view.js** — Already fixed with `storeRejected` flag (skip enrichment after rejection)
4. **firestore.rules** — Already exists, just needs deployment
