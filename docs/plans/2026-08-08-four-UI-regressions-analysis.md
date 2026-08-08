# Analysis — 4 UI regressions on branch 2.1 (dashboard + activities + precall)

Date: 2026-08-08 | Branch: 2.1 | Repo: /root/lionpath_V2 | Author: Gideon (from code inspection)

## User report
1. Pre-call: after generating, the brief is truncated / will not scroll down to see all content.
2. All Calls / Activities list: rows not clickable after navigating back (was clickable before).
3. Same for dashboard Recent Activity rows.
4. Dashboard KPI tiles show inconsistent values every load (97 tasks / 4 calls / 0 briefs varies).

## Root cause 1 — Calls/Activities list rows not clickable on first render (HIGH)
File: `web/calls-list-view.js`
- `renderCallsListView` sets `container.innerHTML` with feed rows (line ~1151) but on the INITIAL paint it only calls `wireCallListFilters(...)` (line 1200).
- `wireCallListClicks(...)` (which attaches the `click`/`keydown` handlers that call `opts.onSelectCall`/`opts.onSelectBrief`) is called ONLY inside the `paint` function (line 1141), which runs on a filter change / re-render.
- Result: first time you open All Activities, every `.act-feed-row` has `data-call-id` but no click handler → not clickable. Clicking a filter re-renders via `paint`, which wires them → "it was clickable if I came back." The wiring is inverted: it should be attached after the initial innerHTML, unconditionally.

## Root cause 2 — dashboard Recent Activity rows not clickable after coalesce refactor (HIGH)
File: `web/dashboard.js` — commit 370010a "Coalesce dashboard recent activity updates".
- The refactor changed `updateRecentActivitySection` to do in-place row diffing instead of `section.outerHTML = ...`.
- Initial dashboard paint (`renderSeLaunchpadOnce`) calls `wireCallLinks(container, opts.onOpenCall)` AND `wireRecentActivitySection(container, opts)` (lines 2067-2068) — so the FIRST paint wires fine.
- BUT the coalesced `scheduleRecentActivityRender` → `updateRecentActivitySection` later replaces/inserts row nodes via `row.replaceWith(nextRow)` / `card.insertBefore(nextRow, cursor)`. Newly inserted `.dash-call-link` buttons are created as fresh DOM but are NOT re-wired — the delegated listener in `wireRecentActivitySection` relies on `event.target.closest(".dash-call-link")` and `container._recentActivityOpts`.
- Key bug: `updateRecentActivitySection` reads `opts` from the closure passed at schedule time, but the delegated handler uses `container._recentActivityOpts` which may be stale/empty. Also new rows inserted by the diff may be `fw-button` elements (custom element) whose `closest()` works but the delegated handler on the SECTION only catches clicks that bubble to the section — should be fine — UNLESS the row is replaced after the container's delegated listener was attached but the new node is a shadow-DOM fw-button that swallows the event. The likely failure: after coalesce re-render, call rows lose click wiring because `wireCallLinks` is not re-invoked on the newly inserted nodes (the old code did `wireCallLinks(newSection, ...)`; the new code does not).
- Net: dashboard Recent Activity call rows stop being clickable after a coalesced refresh fires.

## Root cause 3 — KPI values inconsistent across loads (MEDIUM-HIGH)
File: `web/dashboard.js`
- KPIs come from 3 independent sources that settle at different times:
  - tasks = `aggregateTaskMetrics(listTasks(email))`
  - calls = `buildLaunchpadCallMetricsFromRecords(callRecords)` where callRecords come from `listPostCallAnalyses(email)` (local) reconciled against `opts.fetchRemoteHistory()` (Worker) and the Firestore onSnapshot.
  - briefs = `loadAllLocalBriefs().length`
- `renderSeLaunchpadOnce` first paints from LOCAL data + `readKpiSnapshot` cache, then async remote sync + Firestore snapshot re-render overwrite. Each of these runs on its own timing → the numbers you see depend on which render "wins."
- The `writeKpiSnapshot`/`readKpiSnapshot` cache is written at multiple points (lines 1402, 1431, 1550, 1922, 2078) with different data sources, so the "cached" value loaded next time can be older/newer than local.
- There is no single source of truth and no idempotent reconcile — so the same user sees 97/4/0 one load and different numbers the next. This is the core "shows different values every time" complaint.

## Root cause 4 — Pre-call brief truncated / won't scroll after generation (MEDIUM)
Files: `web/precall.css`, `web/precall.js`
- `#prep-result-view` has `flex:1; min-height:0; overflow:hidden` (line 974-980). The scroll container is an inner tab panel. `#prep-tabs` has `flex:1 1 auto; min-height:0; overflow:hidden` (line 1084-1092).
- After generation, `revealPrepResultView` animates the result in. If the parent `#view-precall` or the tab panel chain doesn't establish a bounded height with `overflow:auto` on the actual content scroll region, the long brief content is clipped with no scrollbar.
- The `:has(#prep-result-view:not([hidden]))` rule (line 140) sets `max-height:none` on the view, which can make the flex chain grow beyond the viewport while the outer app container clips it — the content is there but the scroll region isn't reachable. Need the innermost scrollable body to be the one with `overflow:auto` + bounded height, and the outer to allow it.

## Files to fix (for GLM-5.2 to give the plan, Codex gpt-5.5 to implement)
1. `web/calls-list-view.js` — attach `wireCallListClicks` on initial render (and after paint).
2. `web/dashboard.js` — re-wire call links / delegated activity clicks after coalesced in-place row updates; make `container._recentActivityOpts` authoritative at click time.
3. `web/dashboard.js` — KPI consistency: single-source reconcile (one function computes task/calls/briefs from reconciled local+remote and is the ONLY writer of the snapshot; skip snapshot write while remote pending; on render, prefer the freshest reconciled source, not a stale cache).
4. `web/precall.css` / `web/precall.js` — make the result content scroll region bounded with `overflow:auto` and reachable after generation reveal.
