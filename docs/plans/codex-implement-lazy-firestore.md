# Codex: Implement Firestore SDK Lazy Load

## Task
Remove the eager import of `firebase-firestore.js` from the boot path. Load it lazily only for manager/admin users.

## Files to modify

### 1. `web/app.js` — `ensureFirebaseSdk()` function (line ~2690)

**Changes:**
- Remove `fsMod` from the `Promise.all` destructuring on line 2693
- Remove the `import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")` on line 2696
- In the `fb` object literal (lines 2703-2726), set all Firestore method properties to `null` (already done by our commit a529d67, but verify)
- Set `fb.db = null` and add `fb.fsMod = null`
- After `initDomainStore(fb)` and the role check, if role is `manager` or `admin`, dynamically import `firebase-firestore.js` and:
  - Assign the module to `fb.fsMod`
  - Call `fb.fsMod.getFirestore(app)` and assign to `fb.db`
  - Wire up all Firestore methods (collection, addDoc, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit, documentId, select, serverTimestamp, writeBatch)
  - Call `initDomainStore(fb)` again to re-init with db available
- For SEs: `fb.fsMod` and `fb.db` stay null — no WebChannel transport ever created

### 2. `web/domain/api-store.js` — createApiStore function (line ~176)

Already has `fb?.db ? createFirestoreStore(fb) : null` — verify this is correct after our changes.

### 3. `web/domain/store.js` — resolveReadMode function (line ~31)

Already returns "api" when fb.db is null — no change needed.

## Verification
After implementation, build with `npm run build` and check:
- `grep -c 'firestore.js' dist/ -r` — should be 0 for SE path
- Manual: serve as SE, check Network tab for firebase-firestore.js requests

## Rules
- Do NOT change dummy-mode paths (when firebaseConfig.projectId is empty)
- Do NOT break the manager/admin Firestore lazy-init path
- Keep all existing error handling
