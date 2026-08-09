## Firestore WebChannel + api-store Null Crash Fix

### Problem
Two issues happening simultaneously:
1. **Firebase Firestore WebChannel retry loop**: `(anonymous) @ webchannel_blob_es2018.js:56` repeating forever. Root cause: `import("firebase-firestore.js")` at app boot creates the transport as a side effect for ALL users, even SEs who don't need it.

2. **"Cannot read properties of null (reading 'readCacheEnabled')"**: When `firestoreDelegate` is null (SE users with `fb.db` null), every reference to `firestoreDelegate.something` crashes. There are 28 such references in api-store.js.

### Current State (commit 79a5fef)
- `fb.db = null` for SEs (prevents Firestore instance creation)
- `firebase-firestore.js` still imported at boot (triggers WebChannel transport)
- `firestoreDelegate = fb?.db ? createFirestoreStore(fb) : null` (correctly null for SEs)
- `readCacheEnabled` getter/setter made null-safe via optional chaining
- Null guard on the Proxy constructor at line 620

### Remaining Issues
1. Many methods in `apiReads` do `firestoreDelegate.someMethod()` without null check — crashes when null
2. `loadCallDetail` at line 227 does `await firestoreDelegate.getPostCall(key)` — crashes
3. The `import("firebase-firestore.js")` still happens for all users at boot (line 2708)

### Solution

**Approach A (recommended)** - Make all firestoreDelegate references null-safe with optional chaining:
- Every `firestoreDelegate.xxx` becomes `firestoreDelegate?.xxx`
- Every `if (firestoreDelegate.xxx)` becomes `if (firestoreDelegate?.xxx)`
- This is a mechanical change, ~28 lines, low risk

**Approach B** - Lazy-import firebase-firestore.js only for manager/admin:
- Remove firestore.js from the initial Promise.all import
- Dynamically import it only in the manager/admin lazy-init block
- Prevents WebChannel entirely for SEs
- But doesn't fix the null-reference crash in api-store.js (need Approach A too)

**RECOMMENDATION:** Do BOTH:
1. Apply Approach A (null-safe references in api-store.js) — fixes the login crash immediately
2. Apply Approach B (lazy import) — fixes the WebChannel retry permanently

### Files to Modify

**File 1: web/domain/api-store.js**
Make EVERY `firestoreDelegate.` reference use optional chaining `firestoreDelegate?.` or guard with `if (firestoreDelegate)`. This includes:
- Line 227: `await firestoreDelegate?.getPostCall(key)`
- Lines 285-300: Guard each `firestoreDelegate.listProductGapsByDeal` etc.
- Lines 331-438: All 15+ references to firestoreDelegate methods
- Line 620: Keep the existing null guard

**File 2: web/app.js**
Move the `import("firebase-firestore.js")` from the initial Promise.all (line 2708) into the manager/admin lazy-init block. This prevents WebChannel transport creation for SEs.

### Implementation Order
1. Patch api-store.js with null-safe references
2. Patch app.js with lazy import
3. Build and deploy
4. Verify: login works, no WebChannel retry, no Proxy crash, Coming Soon pages still work

### Risk
- SEs: Zero risk — they never use firestoreDelegate
- Managers/admins: The lazy init must work correctly for Firestore to function
