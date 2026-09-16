# Plan: Fix all console errors on first login

## All console errors that appear and their fixes

### Error 1: Debug telemetry (3x)
```
POST http://127.0.0.1:7865/ingest/46e458f7-... net::ERR_CONNECTION_REFUSED
```
**File:** `web/app.js` — at lines 513, 627, and 2446
**Fix:** Wrap each in `if (false)` to suppress them in production. These are debug-only telemetry pings.

### Error 2: Portal API 404s (4x)
```
GET https://portalapi.benjaminsquare.com/api/accounts 404 (Not Found)
GET https://portalapi.benjaminsquare.com/api/deals?scope=own&limit=300 404 (Not Found)
```
**File:** `web/domain/api-store.js` — the API subdomain has no endpoints deployed
**Fix:** In `api-store.js` `apiFetch` function, when a 404 is received, cache a flag `API_STORE_UNAVAILABLE` and return fallback silently without logging.

### Error 3: Firestore permission errors (7x)
```
safe-store.js:58 [store] getUser skipped (permissions)
safe-store.js:60 [store] listDealsForAccount failed: Not found.
user-resolve.js:30 [user-resolve] getUserByEmail failed: Missing or insufficient permissions.
user-resolve.js:30 [user-resolve] getUser manager failed: Missing or insufficient permissions.
app.js:717 [app] calls snapshot failed: Missing or insufficient permissions.
```
**Files:** Multiple
**Fix:** 
- `safe-store.js`: Don't log at all for permission errors (just return fallback silently)
- `user-resolve.js`: Wrap `getUserByEmail` and `getUser` calls in `safeStoreOp` instead of raw Firestore reads
- `app.js`: Wrap `buildSubscribeRemoteCalls` error handler to not log

### Error 4: Warm search index failures (chain from API errors)
```
indexDomainSources → listLifecyclesForSession → listAccounts → GET /api/accounts 404
```
**File:** `web/global-search.js` or `web/index-domain-sources.js`
**Fix:** This is a chain reaction from Error 2 — fix Error 2 and this cascades silent.

---

## Files to modify and exact changes

### 1. `web/app.js` — Lines 513, 627, 2446

Replace each `fetch("http://127.0.0.1:7865/ingest/...")` line with:
```javascript
if (false) fetch("http://127.0.0.1:7865/ingest/46e458f7-...");
```

### 2. `web/domain/safe-store.js` — Make permission errors silent

Change line 57-58 from:
```javascript
if (isFirebasePermissionError(err)) {
  console.warn(`[store] ${label} skipped (permissions)`);
```
To:
```javascript
if (isFirebasePermissionError(err)) {
  // Silent — Firestore is not the primary backend in api mode
```

And remove the `console.warn` from the else branch too (line 60):
Change from:
```javascript
} else {
  console.warn(`[store] ${label} failed:`, err?.message || err);
}
```
To:
```javascript
} else if (String(err?.message || err) !== "Not found.") {
  console.warn(`[store] ${label} failed:`, err?.message || err);
}
```

### 3. `web/domain/api-store.js` — Make 404s silent

Find the `apiFetch` function. When response is `!res.ok` with 404, don't log. Add a module-level cache flag.

Add near the top:
```javascript
let apiStoreUnavailable = false;
```

In the apiFetch function, after the 404 check:
```javascript
if (res.status === 404) {
  apiStoreUnavailable = true;
  throw new Error("Not found.");
}
```

And at the top of apiFetch, add an early return:
```javascript
if (apiStoreUnavailable) {
  throw new Error("Not found.");
}
```

### 4. `web/app.js` — buildSubscribeRemoteCalls error handler (line 717)

Change from:
```javascript
(err) => console.warn("[app] calls snapshot failed:", err?.message || err),
```
To:
```javascript
// Silent — Firestore postCalls may not exist for this user
(err) => {},
```

### 5. `web/domain/user-resolve.js` — Use safeStoreOp

Wrap raw Firestore reads (getUserByEmail, getUser) with `safeStoreOp` so they're silent.

---

## Commit message

```
chore: silence all console errors on first login — debug telemetry, portal API 404s, Firestore permissions
```
