# Lionpath — Loading Performance & Render Churn Fixes

**Branch:** `fix/loading-perf-2.1`
**Date:** 2026-08-08
**Scope:** `web/app.js`, `web/dashboard.js`, `web/call-view.js`
**Status:** Implemented, tested, ready for review

---

## Summary

Three user-reported performance/UX bugs on the live app (GCP Cloud Run + Firebase + Gemini)
were diagnosed and fixed. All changes are surgical and confined to the browser portal layer
(`web/`). No changes were made to the domain layer, Firestore writes, or the `worker/` API.

The fixes were implemented in parallel by two Codex agents (gpt-5.6-sol, multi-agent v2),
each owning a disjoint set of files to avoid merge conflicts, then merged onto this branch.

---

## Bug 1 — "Loading your workspace…" hangs on refresh

### What was wrong
`web/app.js` `showApp()` (line ~2125) **awaited** two network-bound operations before
hiding the loading screen:
- `await syncSessionWithDomainStore(currentSession)` (line 2177) — a Firestore round-trip
- `await applyInitialRouteFromHash(currentSession)` (line 2194) — initial route render

The loading screen (`#app-loading`) stayed visible until both finished. On a cold refresh
with a slow Firestore read, that produced the long "Loading your workspace…" delay.

### What changed
`web/app.js` — `showApp()`:
- Moved `syncSessionWithDomainStore` to a **non-blocking** `void ...().then(...)` that
  updates `currentSession` + `refreshUserMenuFromSession()` in the background when it
  resolves (mirrors how `loadPersistedHistory` was already handled at line 2190).
- The shell + initial route now render immediately from the cached session; the session
  enrich happens in the background and reconciles the UI when ready.

### Outcome
The loading screen dismisses as soon as the local session + initial route are ready,
instead of waiting on a network round-trip. The app appears fast; the session enrich
(which only affects role/menu details) lands a moment later without blocking paint.

---

## Bug 2 — Dashboard loads data twice (KPI tiles + Recent activity flash)

### What was wrong
`web/dashboard.js` `renderSeLaunchpad()` (line ~1791) renders local data first, then
fires `void refreshLaunchpadRemote(...)` (line 1884) which **replaced the entire KPI grid
and Recent-activity section** with remote data:
- `grid.outerHTML = renderLaunchKpis(...)` (line 1490)
- `section.outerHTML = renderRecentCallsSideWithItems(...)` (line 1496)

This caused a visible double-load: tiles populated once (local), then flashed/re-populated
again (remote).

### What changed
`web/dashboard.js` — `refreshLaunchpadRemote()`:
- KPI grid: replaced the full `outerHTML` swap with `patchLaunchKpis(...)`, which updates
  only the KPI value text nodes that **actually differ** (via `patchLaunchKpiValue`, which
  returns early when the value is unchanged). No DOM mutation when numbers match.
- Recent activity: added a `recentActivitySignature()` (FNV-1a hash over the item set)
  stored in a `data-activity-signature` attribute. The section is only re-rendered when the
  signature changes — i.e. when the activity set genuinely differs. Identical data → no flash.

### Outcome
The dashboard still renders instantly from local data, then reconciles with remote data —
but the reconcile now **patches in place** and skips DOM writes when nothing changed. The
visible double-load flash is gone.

---

## Bug 3 — Opening an analyzed post-call loads 3 times then stops

### What was wrong
Opening a call from All Calls triggered multiple re-renders of the call panel:
- `switchView("calls", {callId, drillDown:true})` → `renderCallPanel()`
- `setOnCallRecordHydrated(...)` → `scheduleCallRecordPanelRefresh(id, {immediate:true})`
- `lionpath:call-record-updated` event → `scheduleCallRecordPanelRefresh(...)`
- post-call save handler → `if (currentView === "calls") void renderCallPanel()`
- the 900ms `scheduleCallRecordPanelRefresh` timer

Each `renderCallPanel` re-ran `renderCallView`, which **re-showed the loading skeleton and
re-fetched the full call bundle** (multiple Firestore reads). The `callPanelRenderGen` guard
prevented stale renders from painting, but each new call still re-triggered the skeleton +
bundle fetch — so the user saw the loading shell flash ~3 times, then it "stopped" when the
last render's bundle resolved.

### What changed
`web/app.js` — `renderCallPanel()` + `scheduleCallRecordPanelRefresh()`:
- Added a **coalescing guard** (`callPanelRendersInFlight` map + `dirtyCallPanelRenders`
  set). If a render for the same call id is already in flight, a new request is marked
  dirty and coalesced — the in-flight render picks up the latest record when it finishes,
  then one deferred refresh runs. No stacked concurrent renders.
- `scheduleCallRecordPanelRefresh` now clears the timer state properly and routes through
  the same coalescing path.

`web/call-view.js` — `renderCallView()` (line ~2934):
- Before showing the loading skeleton, checks whether the container already has a rendered
  `.call-record[data-call-id]` for the **same** call id. If so, it **skips the skeleton
  re-show** and keeps the existing DOM, only re-painting the final record when the bundle
  resolves. Spine/animations are only wired on a fresh skeleton.

### Outcome
Opening a call shows **one** loading pass (the first), then updates in place on subsequent
refreshes — no more 3× skeleton flash. The call record appears once and reconciles quietly.

---

## Files changed

| File | Bug(s) | Change |
|------|--------|--------|
| `web/app.js` | 1, 3 | Non-blocking session enrich in `showApp`; call-panel render coalescing |
| `web/dashboard.js` | 2 | Patch-in-place KPI updates; signature-gated recent-activity re-render |
| `web/call-view.js` | 3 | Skip skeleton re-show when the same call is already rendered |

---

## Verification

- `node web/scripts/test-launchpad-render.mjs` — **passed** (dashboard render smoke test)
- `node web/scripts/test-postcall-render.mjs` — **passed** (all 13 render cases)
- `node web/scripts/test-call-view.mjs` — **passed**
- `node web/scripts/test-calls-list-view.mjs` — **passed**
- `node web/scripts/test-dashboard-launchpad-sync.mjs` — **passed**
- `git diff --check` — clean

> **Note on `npm test`:** the full suite stops on a **pre-existing** failure in
> `web/scripts/test-accounts-ui-build.mjs` ("account-view: deal team card missing").
> This failure exists on the clean baseline commit `d01fb47` and is **not** caused by
> these changes. It is a separate issue in `web/account-view.js` (a file not touched here)
> and should be tracked/fixed independently.

---

## Commits

- `60011f5` — fix: avoid call view skeleton flash on refresh (`web/call-view.js`)
- `de4bbd4` — Fix loading and dashboard render churn (`web/app.js`, `web/dashboard.js`)
- `c14a695` — Merge branch `fix/bugB-callview` into `fix/loading-perf-2.1`

---

## Next steps / not in scope

- The pre-existing `test-accounts-ui-build.mjs` failure (account-view "Deal team" card)
  is a separate bug — recommend a follow-up fix.
- The 2nd-brain review also flagged deeper items (dual-write failure swallowing,
  `getOrCreateLifecycle` race, helper duplication) — these are architectural and were
  intentionally **not** bundled into this performance-fix branch to keep the change
  surgical and low-risk. They should be planned separately.
