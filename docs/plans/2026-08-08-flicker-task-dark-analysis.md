# Analysis — Dashboard flicker regression, task board layout, #calls slow, dark-mode

Date: 2026-08-08 | Branch: 2.1 | Repo: /root/lionpath_V2

## 1) Dashboard flicker got WORSE after the last fix (5+ items flickering now)

The last fix (`5931091`) made the KPI grid patch in place, but the SIDEBAR "Recent activity"
section still flickers heavily. Root cause: `web/dashboard.js` replaces the whole
`.dash-side-recent` section via `section.outerHTML = ...` on EVERY realtime snapshot, and there
are MULTIPLE sources firing near-simultaneously:

- `applyRemoteCallsToLaunchpad` (line ~1412) → `updateRecentActivitySection` → `section.outerHTML`
- `applyRemoteBriefsToLaunchpad` (line ~1375) → `updateRecentActivitySection` → `section.outerHTML`
- `refreshLaunchpadRemote` (line ~1538) → `section.outerHTML`

So on a single data change, the recent-activity section gets torn down and rebuilt 2-3 times,
plus the KPI grid patches. That's the "flickering more than 5 items" — every recent-activity
row + the section chrome repaints repeatedly.

**Fix:** make `updateRecentActivitySection` patch rows in place (compare signature; only update
changed rows) OR debounce/coalesce the three sources into one render. Do NOT replace the whole
section per snapshot.

## 2) Task board — hide "What should I do now?" + quick-add, bring "Recommended" up

`web/tasks.js` `renderTaskBoard` (line ~757) renders:
- "What should I do now?" heading (line 761)
- `renderQuickAddRow(calls)` — the "Add a task… / Due date / Link to call / Add" form (line 762)
- Then `renderRecommendedSection` + Active + Completed (lines 767-777)

User wants, for THIS build:
- Hide the "What should I do now?" heading.
- Hide the quick-add row (Add a task / dd-mm-yyyy / Link to call).
- Bring the "Recommended" section up / show it prominently (it's already below the form; with
  the form gone, Recommended becomes the top section naturally).

**Fix:** in `renderTaskBoard`, skip the heading + `renderQuickAddRow` (render the sections
directly). Recommended becomes the first visible section. Keep Active/Completed below it.

## 3) #calls page still shows "Loading activities…" too long

`web/calls-list-view.js` `renderCallsListView` (line ~917) still blocks the loading shell until
`listAnalysesForSession` + `enrichDealsAndAccounts` resolve. The last fix batched the deal/account
fetches (good), but the shell still doesn't dismiss until ALL records + enrichment finish.

**Fix:** render the list rows with the records' own data as soon as records are available
(don't await enrichment); dismiss the "Loading activities" shell at that point; enrich deal/account
cells in place after. Or at minimum, don't show the shell for the full enrichment duration.

## 4) Dark-mode not optimized (many elements too bright / unreadable on hover)

User reports: in dark mode, on sidebar hover it's SO bright you can't read anything. Many
elements not dark-mode optimized.

`web/styles.css` has `[data-theme="dark"]` overrides for some elements (nav-item hover line 911,
sidebar-user hover line 760) but many hover states still use light backgrounds. Examples:
- `.nav-item:hover { background: #ebe5da; }` (line 908) — light cream, has dark override (911).
- `.sidebar-toggle:hover { background: var(--surface-muted); }` (line 2045) — may not be dark-safe.
- `fw-button.sidebar-collapse:hover`, `.sidebar-user:hover`, `.sidebar-history-item:hover`,
  `.user-menu-panel--sidebar .user-menu-item:hover`, `fw-button.sidebar-logout:hover`.

**Fix:** GLM-5.2 must walk EVERY hover state and interactive element across styles.css +
lifecycle.css + any component CSS, and give exact `[data-theme="dark"]` override rules that use
dark-surface variables (not light hex). Also fix text contrast on hover (e.g. white text on the
bright hover bg is unreadable).

## Ask GLM-5.2
Give a FAILPROOF, bug-free plan for Codex (gpt-5.5) covering:
1. Dashboard recent-activity flicker — in-place patch / coalesce the three section-rebuild sources.
2. Task board — hide "What should I do now?" + quick-add; Recommended on top.
3. #calls — dismiss loading shell when records render, enrich in place.
4. Dark-mode — walk every UI element (esp. sidebar hovers, nav, buttons, cards, inputs, selects,
   tooltips, modals) and give exact [data-theme="dark"] overrides so nothing is unreadable/bright.
