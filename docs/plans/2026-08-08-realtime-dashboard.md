# Realtime dashboard + instant-load fix (2.1.38)

Branch: 2.1  |  Diagnostic: glm-5.2 architecture + Gideon verification

## USER PROBLEM
"Specific tiles load slow while others load fast/realtime" — tasks + briefs paint instantly (localStorage),
but the Calls-analysed tile + Recent-activity list wait on a Firestore round-trip (fetchRemoteHistory ->
syncHistoryOnLogin) before painting. After clearing cookies, skipRemoteHistory=false forces a full re-fetch.

## GOAL (glm-5.2 architecture)
1. Paint the dashboard IMMEDIATELY from local cache — all tiles same frame, no waiting on network.
2. Patch Firestore numbers in-place when they resolve (no full re-render, no flicker).
3. Make Calls + Recent-activity REALTIME via Firestore onSnapshot on postCalls scoped by ownerId,
   mirroring the EXISTING briefs pattern (subscribeRemotePreps -> wireRemotePrepsSubscribe ->
   applyRemoteBriefsToLaunchpad -> patchLaunchKpiValue).

## VERIFIED GROUNDING
- postCalls docs carry ownerId (web/domain/dual-write.js:243 ownerId).
- Existing realtime briefs pattern: app.js buildSubscribeRemotePreps (607) uses fb.query/fb.collection/
  fb.where/fb.onSnapshot; dashboard.js wireRemotePrepsSubscribe (1376) + applyRemoteBriefsToLaunchpad.
- fb object exposes fb.query/fb.collection/fb.where/fb.onSnapshot/fb.db (app.js:541-653).
- renderSeLaunchpadOnce (dashboard.js:1805) does `await buildRecentActivity(...)` BEFORE paint -> the
  staged-load. refreshLaunchpadRemote (1426) already patches in-place AFTER paint (works).
- Single-flight coalescer renderSeLaunchpad (dashboard.js:1900) already exists.

## CHANGES (surgical, vanilla JS — NO React, NO new store)

### web/app.js — add buildSubscribeRemoteCalls() next to buildSubscribeRemotePreps (line ~607)
Returns (onChange) => cleanup, mirroring buildSubscribeRemotePreps exactly:
- Guard: !isFirebaseAuthEnabled() || !fb?.auth?.currentUser || !fb?.db || typeof onChange!=='function' -> () => {}
- const user = fb.auth.currentUser
- const q = fb.query(fb.collection(fb.db, "postCalls"), fb.where("ownerId", "==", user.uid), fb.limit(200))
- return fb.onSnapshot(q, (snap) => { const calls = snap.docs.map(d => ({ id: d.id, ...d.data() })); onChange(calls); }, (err) => console.warn("[app] calls snapshot failed:", err?.message||err))
- Return a function that calls the onSnapshot unsub.
- In dashboardOpts() (app.js:725): add `subscribeRemoteCalls: buildSubscribeRemoteCalls(),` next to subscribeRemotePreps.

### web/dashboard.js — mirror the briefs realtime flow for calls
1. Add `subscribeRemoteCalls` to the opts guard in refreshLaunchpadRemote (line 1428): treat it like
   subscribeRemotePreps so realtime mode is detected.
2. Add `function stopRemoteCallsSubscribe(container)` (mirror stopRemotePrepsSubscribe) clearing container._callsUnsub.
3. Add `function wireRemoteCallsSubscribe(container, email, opts)`:
   - stopRemoteCallsSubscribe(container) first
   - if typeof opts.subscribeRemoteCalls !== 'function' return
   - container._callsUnsub = opts.subscribeRemoteCalls((remoteCalls) => { void applyRemoteCallsToLaunchpad(container, email, opts, remoteCalls); });
4. Add `async function applyRemoteCallsToLaunchpad(container, email, opts, remoteCalls)`:
   - if !container?.isConnected return
   - Build launchCallMetrics from remoteCalls (buildLaunchpadCallMetricsFromRecords(remoteCalls)); patch the "calls" KPI via patchLaunchKpiValue(container, "calls", remoteCalls.length)
   - await updateRecentActivitySection(container, remoteCalls, usesLegacyCoach, opts)
   - writeKpiSnapshot(email, kpiSnapshotFromMetrics(taskMetrics, callMetrics, prepsCount))
   - Reuse existing helpers: dedupeAnalysesByCallIdentity, aggregateQualityMetrics, listTasks, loadAllLocalBriefs, updateRecentActivitySection (1722), patchLaunchKpiValue.
5. Call wireRemoteCallsSubscribe(container, email, opts) at the END of renderSeLaunchpadOnce (next to wireRemotePrepsSubscribe at line 1887).
6. In renderLaunchpadFallback and any path that calls stopRemotePrepsSubscribe, also stopRemoteCallsSubscribe(container).

### web/dashboard.js — instant local-first paint (remove the staged load)
In renderSeLaunchpadOnce (line ~1841): change `const activityItems = await buildRecentActivity(...)` so it does
NOT block the paint. Use the existing local-only path:
- callRecords/deduped local records are already computed synchronously above (line 1823)
- build recent activity from those LOCAL records synchronously (buildRecentActivity is async because it may
  enrich; add a sync fast-path or call it with local-only opts where it resolves from local data)
- Paint immediately, then refreshLaunchpadRemote already patches remote in-place.
Do NOT remove the single-flight renderSeLaunchpad. Do NOT change Firestore write behavior.

### Cache-bust
web/firebase-config.js AUTH_BUILD_ID 2.1.37 -> 2.1.38, web/index.html portal-build + styles.css?v/... -> 2.1.38,
worker/src/build-id.ts WORKER_BUILD 2.1.37 -> 2.1.38.

## VERIFICATION (must pass, real output)
- node web/scripts/test-call-view.mjs
- node web/scripts/test-call-view-animate.mjs
- node web/scripts/test-launchpad-render.mjs
- node web/scripts/test-dashboard-launchpad-sync.mjs
- node web/scripts/test-postcall-render.mjs
- npm run build (web)
- git diff --check clean
NOTE: npm run test / test:build has a PRE-EXISTING unrelated failure (test-accounts-ui-build.mjs
"account-view: deal team card missing" — account-view.js on HEAD has 0 "Deal team" matches; NOT in scope).
Do NOT touch account-view.js.

## CONSTRAINTS
- Vanilla JS. NO React/context/zustand/react-query. Mirror the existing briefs onSnapshot pattern.
- Surgical. Do NOT touch web/postcall.js, worker logic, or Firestore write behavior.
- Do NOT commit. Leave changes staged. Report files changed + diff summary + which tests pass/fail.
