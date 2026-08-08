# Fix: MergeSpray (TC data loss) + Dashboard Partial Reload

**Goal:** Fix two bugs stemming from the same root cause — Firestore `onSnapshot` docs overwrite richer `localStorage` records, stripping `result.technicalCommit` and other deep fields from history, and causing the dashboard to render partially on return navigation.

**Root cause:** `mergePostCallRecordsIntoLocal` (history.js:374) spreads `{ ...prev, ...call }` where `call` is a Firestore `postCalls` doc. Firestore docs carry `analysis`, `scorecard`, `id`, `createdAt`/`updatedAt`, `ownerId`, `callType`, `trustScore`, `qualityScore`, `provisional`, `rubricVersion` — but NOT the full `result` blob that contains `technicalCommit`, `tcDeltas`, `qualification`, `arrCompute`, `pass6`, `videoFacts`, `timeline`, `summarise`, and `meddpiccDeltas`.

When the Firestore snapshot fires on dashboard load or call-view open, it overwrites the local record's `result` with `undefined`, losing `result.technicalCommit`. Then `technicalCommitFromHistoryRecords` returns null, the call's TC tab shows "No technical commit yet".

Similarly, dashboard side modules (briefs, tasks side panel) sometimes render incompletely on re-navigation because the KPI snapshot cache + remote subscriptions interplay leaves the dashboard in a partial state.

**Fix approach:** Two files touched, minimal changes.

---

### Task 1: Fix mergePostCall mergePostCallRecordsIntoLocal — preserve deep fields from prev

**Objective:** When a Firestore doc (`call`) is missing deep fields that `prev` has, keep `prev`'s values instead of overwriting with undefined.

**Files:** Modify `web/history.js:374-399`

**The bug:** Line 388-394:
```javascript
byId.set(call.id, {
  ...(prev || {}),
  ...call,
  id: call.id,
  timestamp: ts,
  updatedAt: call.updatedAt || prev?.updatedAt || null,
});
```

When `call` has no `result` property, `{ ...prev, ...call }` removes `prev.result`. Same for `analysis`, `scorecard`, `pass6`, `videoFacts`, `timeline`.

**The fix:** After the base spread, selectively restore `prev` deep fields that the incoming `call` is missing or has as `null`/`undefined`. Only fields that are actually `null`/`undefined` in `call` should fall back to `prev`.

The deep fields to preserve (Firestore postCalls doc does NOT carry these):
- `result` (the entire result blob)
- `result?.technicalCommit`
- `result?.tcDeltas`
- `result?.qualification`
- `result?.arrCompute`
- `result?.pass6`
- `result?.videoFacts`
- `result?.timeline`
- `result?.summarise`
- `result?.meddpiccDeltas`
- `result?.scorecard` (yes, the local record also stores scorecard in result)
- `transcriptMeta`
- `zoomLink`
- `dealId`
- `accountId`
- `createNewDeal`
- `newDealTitle`
- `newDealType`
- `confirmedIdentities`
- `createdByUserId`

**Step 1: Read the current function**

Read `web/history.js` lines 374-399.

**Step 2: Write the deep-merge fix**

Replace the `byId.set(call.id, ...)` block with a version that preserves prev's deep fields:

```javascript
byId.set(call.id, {
  ...(prev || {}),
  ...call,
  id: call.id,
  timestamp: ts,
  updatedAt: call.updatedAt || prev?.updatedAt || null,
  // Preserve deep fields that Firestore postCalls doc doesn't carry.
  // The spread { ...prev, ...call } above would strip these when the
  // Firestore doc lacks them. Restore from prev where call is missing.
  ...(prev?.result && !call?.result ? { result: prev.result } : {}),
  ...(call?.result && !call?.result?.technicalCommit && prev?.result?.technicalCommit
    ? { result: { ...call.result, technicalCommit: prev.result.technicalCommit } }
    : {}),
  ...(call?.result && !call?.result?.tcDeltas && prev?.result?.tcDeltas
    ? { result: { ...call.result, tcDeltas: prev.result.tcDeltas } }
    : {}),
  ...(call?.result && !call?.result?.qualification && prev?.result?.qualification
    ? { result: { ...call.result, qualification: prev.result.qualification } }
    : {}),
  ...(call?.result && !call?.result?.arrCompute && prev?.result?.arrCompute
    ? { result: { ...call.result, arrCompute: prev.result.arrCompute } }
    : {}),
  ...(call?.result && !call?.result?.pass6 && prev?.result?.pass6
    ? { result: { ...call.result, pass6: prev.result.pass6 } }
    : {}),
  ...(call?.result && !call?.result?.videoFacts && prev?.result?.videoFacts
    ? { result: { ...call.result, videoFacts: prev.result.videoFacts } }
    : {}),
  ...(call?.result && !call?.result?.timeline && prev?.result?.timeline
    ? { result: { ...call.result, timeline: prev.result.timeline } }
    : {}),
  ...(call?.result && !call?.result?.summarise && prev?.result?.summarise
    ? { result: { ...call.result, summarise: prev.result.summarise } }
    : {}),
  ...(call?.result && !call?.result?.meddpiccDeltas && prev?.result?.meddpiccDeltas
    ? { result: { ...call.result, meddpiccDeltas: prev.result.meddpiccDeltas } }
    : {}),
  ...(call?.result && !call?.result?.scorecard && prev?.result?.scorecard
    ? { result: { ...call.result, scorecard: prev.result.scorecard } }
    : {}),
  ...(prev?.transcriptMeta && !call?.transcriptMeta
    ? { transcriptMeta: prev.transcriptMeta } : {}),
  ...(prev?.zoomLink && !call?.zoomLink ? { zoomLink: prev.zoomLink } : {}),
  ...(prev?.dealId && !call?.dealId ? { dealId: prev.dealId } : {}),
  ...(prev?.accountId && !call?.accountId ? { accountId: prev.accountId } : {}),
  ...(prev?.confirmedIdentities && !call?.confirmedIdentities
    ? { confirmedIdentities: prev.confirmedIdentities } : {}),
})
```

**Step 3: Verify the patch**

Run: `node -e "require('./web/history.js')" 2>&1 | head -5`
Expected: syntax ok (any module errors are from import chain, not our change)

**Step 4: Commit**

```bash
git add web/history.js
git commit -m "fix: preserve deep result fields in mergePostCallRecordsIntoLocal"
```

---

### Task 2: Fix dashboard — ensure recent calls from Firestore snapshot trigger full re-render

**Objective:** When the Firestore `postCalls` snapshot fires on return-navigation, make sure the dashboard's briefs count and task section also refresh, not just the calls KPI.

**Files:**
- Modify: `web/dashboard.js` (applyRemoteCallsToLaunchpad function, ~line 1391-1406)

**The issue:** When `applyRemoteCallsToLaunchpad` fires from the snapshot, it only updates:
1. Calls KPI count
2. Recent activity section

It does NOT update:
- Briefs/tasks KPI values
- Task board

When navigating back to the dashboard, the KPI snapshot cache is used (via `readKpiSnapshot` + `metricsFromKpiSnapshot`), but the remote subscription may update the calls count while leaving briefs and tasks showing stale cache values or shimmers.

**The fix:** After the remote calls merge, also refresh the tasks and preps sections. The function already has `email` and `opts`. Add two more `patchLaunchKpiValue` calls for the preps and open tasks stats.

**Step 1: Read `applyRemoteCallsToLaunchpad`**

Read `web/dashboard.js` lines 1391-1406.

**Step 2: Extend the function**

Add task and brief refreshes after the calls update:

```javascript
async function applyRemoteCallsToLaunchpad(container, email, opts, remoteCalls) {
  if (!container?.isConnected) return;
  mergePostCallRecordsIntoLocal(email, Array.isArray(remoteCalls) ? remoteCalls : []);
  const callRecords = dedupeAnalysesByCallIdentity(listPostCallAnalyses(email));
  const callMetrics = buildLaunchpadCallMetricsFromRecords(callRecords);
  patchLaunchKpiValue(container, "calls", callRecords.length);
  const usesLegacyCoach = aggregateQualityMetrics(analysesWithQualityFromRecords(callRecords)).usesLegacyCoach;
  await updateRecentActivitySection(container, callRecords, usesLegacyCoach, opts);
  if (!container.isConnected) return;
  const taskMetrics = aggregateTaskMetrics(listTasks(email));
  const prepsCount = loadAllLocalBriefs().length;
  // Update tasks and briefs KPIs from the refreshed data
  patchLaunchKpiValue(container, "open", taskMetrics.openTotal);
  patchLaunchKpiValue(container, "preps", prepsCount);
  writeKpiSnapshot(email, kpiSnapshotFromMetrics(taskMetrics, callMetrics, prepsCount));
}
```

**Step 3: Verify**

Check the function signature matches and `patchLaunchKpiValue` is a module-scoped function (it is, defined at line 1334).

**Step 4: Commit**

```bash
git add web/dashboard.js
git commit -m "fix: refresh all KPI values on remote calls snapshot, not just calls"
```

---

### Verification

1. Deploy the app
2. Analyze a call that produces technical commit data
3. Navigate to dashboard, then back to the call
4. Technical commit tab should show the data, not "No technical commit yet"
5. Navigate to dashboard, back to dashboard multiple times
6. All three KPI tiles (Tasks, Calls analyzed, Briefs) should show correct values
