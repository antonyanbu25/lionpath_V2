# GLM-5.2 Action Plan: Fix call page slowness + dashboard count

## Decision rationale

### Problem 1 — Call page slowness (loadCallBundle)

The `loadCallBundle` function in `web/call-view.js` makes 6 Firestore/API enrichment calls that ALL fail. Each awaits the rejection (1-3s). The call already has complete data in `record.result` from localStorage.

**Fix approach:** After the FIRST enrichment call (`store.getCall` or `store.getPostCall`) fails, set a `storeRejected` flag and skip ALL subsequent enrichment. This eliminates 5-18s of waiting.

### Problem 2 — Dashboard shows 8 not 48

Root cause: The latest code (force-reconcile Worker KV into localStorage on first render, fix history merge authority order) was committed to GitHub but NOT deployed to the VPS. The VPS deploy ran at `20e72b2`, the fixes are at `a658562`.

**Fix approach:** Deploy latest commit. If count still shows 8 after deploy, investigate if Firestore snapshot merge reduces count.

---

## Task 1: Skip enrichment after store rejection

**File:** `web/call-view.js` — `loadCallBundle` function (starts ~line 2354)

**Change:** After `getCall`/`getPostCall` returns null, set `storeRejected = true`. Guard all subsequent enrichment checks with `!storeRejected`.

**Step 1:** Read the function.

**Step 2:** Add after the domainCall fetch (line ~2368):

```javascript
const domainCall = store.getCall
  ? await safeEnrich("getCall", () => store.getCall(record.id), null)
  : store.getPostCall
    ? await safeEnrich("getPostCall", () => store.getPostCall(record.id), null)
    : null;

const storeRejected = domainCall === null && (
  typeof store.getCall === "function" || typeof store.getPostCall === "function"
);
```

**Step 3:** Guard each `needs*` check:

```javascript
const needsProductGaps =
  !storeRejected && !pass6?.productGaps?.length && !detail.productGaps?.length && store.listProductGapsByPostCall;
const needsWhatWorks =
  !storeRejected && !pass6?.whatWorks?.length && !detail.whatWorks?.length && store.listWhatWorksByPostCall;
const needsTcDeltas =
  !storeRejected && !resultBlob.tcDeltas?.length && !detail.tcDeltas?.length && store.listTcDeltasByCall;
const needsMeddpiccDeltas =
  !storeRejected && !detail.meddpiccDeltas?.length && store.listMeddpiccDeltasByCall;
```

**Step 4:** Also guard the `listDealsByAccount` block at ~line 2426:

```javascript
if (!dealId && !pendingNewDeal && !storeRejected) {
```

**Step 5:** Commit:
```bash
git add web/call-view.js
git commit -m "fix: skip enrichment after store rejection — saves 5-18s per call load"
```

---

## Task 2: Deploy to VPS

```bash
cd /opt/se-singha-paathai/deploy/vps && bash upgrade-now.sh
```

---

## Verification

1. Hard refresh portal. Dashboard should show 48 calls.
2. Open a call — should load instantly (no 5-18s wait for enrichment failures).
3. Technical commit tab should show data (from localStorage record.result).
