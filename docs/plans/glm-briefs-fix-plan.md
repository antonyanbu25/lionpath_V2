# Decision: Option A — `/api/briefs` Worker Endpoint

**Rationale**: Matches the existing `/api/calls`, `/api/accounts`, `/api/deals` pattern exactly. Option B is over-engineered (a second Firestore instance for one feature). Option C hides the bug instead of fixing it — SEs would still see no data.

---

## 1. Exact Code Changes

### Change 1 — New worker route: `/api/briefs`

**File**: `worker/routes/briefs.js` (new file, or append to existing router file — match wherever `/api/calls` lives)

```javascript
// worker/routes/briefs.js
import { getFirestore } from 'firebase-admin/firestore';
import { requireAuth } from '../middleware/auth.js'; // same middleware /api/calls uses

export function registerBriefsRoutes(app) {
  app.get('/api/briefs', requireAuth, async (c) => {
    const user = c.get('user');
    const db = getFirestore(); // Admin SDK — bypasses client security rules

    const [prepsSnap, briefsSnap] = await Promise.all([
      db.collection('preps').where('userId', '==', user.uid).get(),
      db.collection('prepBriefs').where('userId', '==', user.uid).get(),
    ]);

    const preps = prepsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const prepBriefDocs = briefsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return c.json({ preps, prepBriefDocs });
  });
}
```

**Wire it up** in the worker entry (e.g. `worker/index.js`):
```javascript
import { registerBriefsRoutes } from './routes/briefs.js';
// ...after other route registrations:
registerBriefsRoutes(app);
```

> ⚠️ Verify the user-filter field name. If briefs are keyed by `ownerId` or `uid` instead of `userId`, change both `.where(...)` calls. Check one existing doc in Firestore console before deploying.

---

### Change 2 — Frontend fetcher: `web/api-store.js`

Add alongside `fetchCalls` / `fetchAccounts` / `fetchDeals`:

```javascript
export async function fetchBriefs(getToken) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken ? await getToken() : undefined;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}/api/briefs`, { headers, credentials: 'include' });
  if (!res.ok) throw new Error(`briefs fetch failed: ${res.status}`);
  const { preps = [], prepBriefDocs = [] } = await res.json();
  return { prepDocs: preps, prepBriefDocs };
}
```

---

### Change 3 — `web/app.js` (line ~541): API fallback in `queryRemotePrepCollections`

**Before** (current early return):
```javascript
async function queryRemotePrepCollections() {
  if (!isFirebaseAuthEnabled() || !fb?.auth?.currentUser || !fb?.db) {
      return { prepDocs: [], prepBriefDocs: [] };
  }
  // ... existing Firestore reads
}
```

**After**:
```javascript
async function queryRemotePrepCollections() {
  if (!isFirebaseAuthEnabled() || !fb?.auth?.currentUser) {
      return { prepDocs: [], prepBriefDocs: [] };
  }

  // SE users have no client Firestore SDK — fall back to worker API (Admin SDK).
  if (!fb?.db) {
      try {
          return await fetchBriefs(getToken);
      } catch (err) {
          console.warn('[briefs] API fallback failed:', err);
          return { prepDocs: [], prepBriefDocs: [] };
      }
  }

  // ... existing Firestore reads (managers/admins)
}
```

**Imports to add at top of `web/app.js`**:
```javascript
import { fetchBriefs } from './api-store.js';
```
(Adjust path if `api-store.js` is imported elsewhere with a different relative path — match the existing `fetchCalls` import if one exists.)

**Verify `getToken` is in scope** inside `queryRemotePrepCollections`. If it isn't, pass it in as a parameter from the caller, or import the same token getter that `api-store.js` callers use.

---

## 2. File Paths & Line Numbers

| # | File | Location | Change |
|---|------|----------|--------|
| 1 | `worker/routes/briefs.js` | new file | Add `/api/briefs` route |
| 2 | `worker/index.js` | near other `register*Routes(app)` calls | Register briefs routes |
| 3 | `web/api-store.js` | after `fetchDeals` | Add `fetchBriefs(getToken)` |
| 4 | `web/app.js` | line ~541 (`queryRemotePrepCollections`) | Split early-return; add API fallback |
| 5 | `web/app.js` | top-of-file imports | `import { fetchBriefs } from './api-store.js'` |

---

## 3. Risk Assessment

**Overall: LOW**

**Why low**:
- Additive only — no existing endpoint or Firestore read path is touched.
- Fallback fires **only** when `fb.db` is null (SE users). Managers/admins keep their existing Firestore client SDK path byte-for-byte.
- Failure is graceful: API error → `console.warn` + empty arrays → identical to today's behavior. No regression.
- Auth pattern is identical to `/api/calls` etc. — Bearer token + cookie credentials, same `requireAuth` middleware.

**Risks to verify before merge**:

1. **Field name mismatch** (medium): If briefs are stored with `ownerId` / `uid` / `createdBy` instead of `userId`, the `.where()` returns nothing. Check one doc in Firestore console first.
2. **Admin SDK init** (low): Confirm the worker already initializes Admin SDK for `/api/calls` etc. If yes, `getFirestore()` reuses it. If no, add init in `worker/index.js`.
3. **`getToken` scope** (low): If `getToken` isn't already imported in `web/app.js`, the call will throw at runtime. Codex should grep for existing `getToken` usage in `app.js` and reuse it.
4. **No pagination** (low for now): Returns all briefs in one shot. Fine while counts are small; revisit if a user exceeds ~500 briefs.
5. **Security rules bypass** (low, by design): Admin SDK ignores Firestore security rules — same as every other `/api/*` endpoint. Auth is enforced by `requireAuth` middleware, not Firestore rules. This is the existing security model, not a new exposure.

**No-go conditions**: If briefs docs don't contain any user-ownership field at all (e.g. they're keyed only by deal/account ID), the `.where('userId', '==', ...)` query returns empty. In that case, pivot to joining through `/api/deals` for the user's deal IDs, then query briefs by `dealId in [...]`. Check the schema first.

---

**Ship order**: (1) verify field name in Firestore console → (2) deploy worker route → (3) smoke-test `curl -H "Authorization: Bearer <token>" https://portalapi.benjaminsquare.com/api/briefs` → (4) merge frontend changes.