# Fix: Dashboard widgets load one-by-one (sequential DOM patches)

**Root cause:** `applyRemoteCallsToLaunchpad` patches KPI values one at a time (`patchLaunchKpiValue` for calls, then after an async await, open and preps). Each is a separate DOM write. Combined with the Firestore snapshot + `refreshLaunchpadRemote` double-firing, the user sees "calls" update → pause → "tasks" → "briefs".

**Fix:** Two changes in `web/dashboard.js`.

---

### Task 1: Replace 3x patchLaunchKpiValue with a single grid replacement

**File:** `web/dashboard.js` — `applyRemoteCallsToLaunchpad` function (lines 1396-1411)

Replace the individual patches with one `grid.outerHTML` swap:

**Before:**
```javascript
  const callRecords = dedupeAnalysesByCallIdentity(listPostCallAnalyses(email));
  const callMetrics = buildLaunchpadCallMetricsFromRecords(callRecords);
  patchLaunchKpiValue(container, "calls", callRecords.length);
  const usesLegacyCoach = aggregateQualityMetrics(analysesWithQualityFromRecords(callRecords)).usesLegacyCoach;
  await updateRecentActivitySection(container, callRecords, usesLegacyCoach, opts);
  if (!container.isConnected) return;
  const taskMetrics = aggregateTaskMetrics(listTasks(email));
  const prepsCount = loadAllLocalBriefs().length;
  patchLaunchKpiValue(container, "open", taskMetrics.openTotal);
  patchLaunchKpiValue(container, "preps", prepsCount);
  writeKpiSnapshot(email, kpiSnapshotFromMetrics(taskMetrics, callMetrics, prepsCount));
```

**After:**
```javascript
  const callRecords = dedupeAnalysesByCallIdentity(listPostCallAnalyses(email));
  const callMetrics = buildLaunchpadCallMetricsFromRecords(callRecords);
  if (!container.isConnected) return;
  const taskMetrics = aggregateTaskMetrics(listTasks(email));
  const prepsCount = loadAllLocalBriefs().length;
  const grid = container.querySelector(".launch-kpi-grid");
  if (grid) {
    grid.outerHTML = renderLaunchKpis(taskMetrics, callMetrics, prepsCount);
    wireLaunchKpiNav(container, email, opts);
  }
  const usesLegacyCoach = aggregateQualityMetrics(analysesWithQualityFromRecords(callRecords)).usesLegacyCoach;
  await updateRecentActivitySection(container, callRecords, usesLegacyCoach, opts);
  if (!container.isConnected) return;
  writeKpiSnapshot(email, kpiSnapshotFromMetrics(taskMetrics, callMetrics, prepsCount));
```

Key changes:
1. Compute `taskMetrics` and `prepsCount` BEFORE the DOM write (not after the await)
2. Replace the ENTIRE KPI grid in one DOM op instead of 3 individual patches
3. Also wire the KPI nav buttons after the swap (destroyed by outerHTML)
4. Early return check before computing

---

### Task 2: Guard refreshLaunchpadRemote to not re-run when snapshot already did the work

**File:** `web/dashboard.js` — `renderSeLaunchpadOnce` function, the `refreshLaunchpadRemote` call at line ~1939

The issue: `renderSeLaunchpadOnce` sets up the realtime snapshot listener (line 1931), which fires immediately and runs `applyRemoteCallsToLaunchpad` (which now does a complete grid swap). Then at line 1939, `refreshLaunchpadRemote` fires, which does ANOTHER round of call records fetching and aggregation. This is wasteful.

Fix: If realtime snapshot is active AND it already fired (tracked via a flag), skip `refreshLaunchpadRemote`.

Add a `_realtimeFired` flag on the container:

In `wireRemoteCallsSubscribe`, set `container._realtimeFired = false` before subscribing, and the callback sets `container._realtimeFired = true` on first fire.

In `renderSeLaunchpadOnce`, after the await `refreshLaunchpadRemote`, check:
```javascript
if (container._realtimeFired) return;
await refreshLaunchpadRemote(container, email, opts);
```

But simpler: just guard `refreshLaunchpadRemote` from doing the full re-aggregation when realtime is active:

```javascript
if (typeof opts.subscribeRemoteCalls !== "function") {
  await refreshLaunchpadRemote(container, email, opts);
}
```

This skips the remote refresh entirely when the realtime snapshot listener is already active (it will fire immediately and handle everything).

---

### Verification

1. Hard refresh the dashboard
2. All three KPI cards appear at once (not sequentially)
3. Recent activity section updates after the snapshot fires
4. Navigate away and back — no double-fetch, no sequential loading
