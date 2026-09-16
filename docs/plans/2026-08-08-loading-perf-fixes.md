# Fix: Loading performance & double/triple-render bugs (branch 2.1)

## Context
Lionpath SE coaching portal. `web/` static portal + client domain layer, `worker/` Node API.
Three user-reported bugs on the live app (GCP Cloud Run + Firebase + Gemini):

1. **Refresh shows "Loading your workspace…" for a long time** before the app appears.
2. **Dashboard loads data twice** — first local, then a second load in the "Calls analyzed" KPI tiles and "Recent activity" section.
3. **Opening an analyzed post-call from All Calls loads 3 times then stops.**

## Root causes (verified by reading the code)

### Bug 1 — slow "Loading your workspace…"
`web/app.js` `showApp()` (line ~2125):
- Line 2141: `show($("app-loading"), true)` — loading screen shown.
- Line 2177: `await syncSessionWithDomainStore(currentSession)` — **awaited**, blocks the loading screen on a network round-trip to Firestore.
- Line 2194: `await applyInitialRouteFromHash(currentSession)` — **awaited**, blocks loading on the initial route render.
- Line 2201: `await paintAuthenticatedShell()` — this is what hides the loading screen (line 1555 `show($("app-loading"), false)`).

So the loading screen stays up until session-enrich AND initial-route both finish. On a cold refresh with a slow Firestore read, that's the visible delay.

**Fix:** Don't block the loading screen on `syncSessionWithDomainStore`. Render the shell + initial route immediately from the cached session, then enrich the session in the background (fire-and-forget, like `loadPersistedHistory` already is at line 2190). Move `syncSessionWithDomainStore` to a non-blocking `void ...().then(...)` that updates `currentSession` + `refreshUserMenuFromSession()` when it resolves. Keep `applyInitialRouteFromHash` awaited (it's fast, local) but ensure `paintAuthenticatedShell()` runs promptly.

### Bug 2 — dashboard double-load
`web/dashboard.js` `renderSeLaunchpad()` (line ~1791):
- Renders local data first (lines 1811-1874): KPIs + recent activity from `listPostCallAnalyses` / `loadAllLocalBriefs`.
- Line 1884: `void refreshLaunchpadRemote(container, email, opts)` — fires a **second** async load that re-fetches remote history and re-renders the KPI grid (`grid.outerHTML = renderLaunchKpis(...)` line 1490) and the recent-activity section (`section.outerHTML = renderRecentCallsSideWithItems(...)` line 1496).

So the user sees the tiles populate once (local), then flash/re-populate again (remote). That's the "second data load."

**Fix:** Make the remote refresh **patch in place** instead of replacing the whole grid/section, and only update values that actually changed. Specifically:
- In `refreshLaunchpadRemote`, instead of `grid.outerHTML = renderLaunchKpis(...)` (line 1490), update only the KPI value text nodes that differ (compare old vs new numbers; skip if equal). Same for the recent-activity section (line 1496): only re-render if the item set actually changed.
- Add a guard so if the remote data is identical to what's already rendered, no DOM mutation happens (no visible flash).
- This keeps the "instant local render then reconcile" pattern but removes the visible double-load flash.

### Bug 3 — post-call opens, loads 3 times, then stops
`web/app.js`:
- `switchView("calls", {callId, drillDown:true})` → line 1028 `void renderCallPanel()`.
- `renderCallPanel()` (line 1442) → `renderCallView()` in `web/call-view.js` (line 2934), which shows `renderCallLoadingShell` (line 2983) then `loadCallBundle` (line 2988) then `paintCallRecord` (line 2998).
- Multiple triggers re-invoke `renderCallPanel`:
  - Line 2723 `setOnCallRecordHydrated((id) => scheduleCallRecordPanelRefresh(id, { immediate: true }))` → line 1430 `void renderCallPanel()`.
  - Line 2726 `lionpath:call-record-updated` event → `scheduleCallRecordPanelRefresh` → render.
  - Line 2854 (after `loadPersistedHistory` in the post-call save handler) `if (currentView === "calls") void renderCallPanel()`.
  - Line 2714 (prep save handler) same.
  - Line 1437 `scheduleCallRecordPanelRefresh` 900ms timer → render.

Each `renderCallPanel` call re-runs `renderCallView`, which re-shows the loading shell and re-runs `loadCallBundle` (multiple Firestore reads). The `callPanelRenderGen` guard (`shouldApply: () => gen === callPanelRenderGen`) prevents *stale* renders from painting, but each new call still **re-triggers the full loading shell + bundle fetch**, so the user sees the loading shell flash repeatedly (3 times) and it "stops" when the last render's bundle resolves.

**Fix:**
- **Debounce/coalesce** `renderCallPanel` for the same `selectedCallId`: if a render is already in flight for the same call id, don't start another one — just mark it dirty and let the in-flight render pick up the latest record when it finishes. Add a module-level `callPanelRenderInFlight` guard keyed by call id.
- In `renderCallView` (`call-view.js`), **don't re-show the loading shell if the container already has a rendered `.call-record` for the same call id** — only show the skeleton on the *first* paint. On subsequent refreshes, keep the existing DOM and just update the changed sections (or re-paint without the skeleton flash).
- Ensure `scheduleCallRecordPanelRefresh` with `immediate:true` (line 1428) doesn't stack multiple renders — coalesce into one.

## Files to change
- `web/app.js` — Bug 1 (showApp), Bug 3 (renderCallPanel coalescing, scheduleCallRecordPanelRefresh)
- `web/dashboard.js` — Bug 2 (refreshLaunchpadRemote patch-in-place)
- `web/call-view.js` — Bug 3 (renderCallView: skip skeleton re-show on refresh)

## Verification
- `cd web && npm test` (regression suite) — must pass.
- `node web/scripts/test-launchpad-render.mjs` — dashboard render smoke test.
- `node web/scripts/test-postcall-render.mjs` — post-call render smoke test.
- Manual: refresh → loading screen dismisses quickly; dashboard tiles don't double-flash; opening a call from All Calls shows one loading pass, not three.
- `git diff` review before commit.

## Notes
- Do NOT change behavior of the domain layer or Firestore writes.
- Do NOT touch `worker/`.
- Keep changes minimal and surgical. No broad refactors.
