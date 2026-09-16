# FAILPROOF Fix Plan — Dashboard flicker, task board, #calls load, dark mode (GLM-5.2)

Branch: 2.1 | Repo: /root/lionpath_V2 | Implementer: Codex (gpt-5.5)

Execute in this order (each = separate commit):
1. DARK MODE (CSS-only, largest, isolated)
2. TASK BOARD (hide heading + quick-add, Recommended on top)
3. #CALLS loading shell (dismiss when records render, enrich in place)
4. DASHBOARD FLICKER (in-place row patch + coalesce the 3 section-rebuild sources)

## FIX 4 — DARK MODE (web/styles.css, web/lifecycle.css, any web/components/*.css)

### Phase A — Variable audit (FIRST)
The color system lives in `web/dew-theme.css` (styles.css line 1 says "colors live in
dew-theme.css"). Dark theme `[data-theme="dark"]` (dew-theme.css:102) defines:
`--dew-surface:#1f1c18`, `--dew-surface-subtle:#252219`, `--dew-surface-faint:#1a1815`,
`--dew-text:#f0ebe3`, `--dew-text-secondary:#b0a898`, `--dew-text-muted:#8a8072`,
`--dew-border:rgba(236,231,222,0.14)`. There is NO `--surface-hover` token — that's the
"too bright" root cause (hovers fall back to light `--surface-muted` from the light block).

Add to the `[data-theme="dark"]` block in dew-theme.css:
```
--surface-hover: #2d2a24;   /* slightly lighter than --dew-surface-subtle */
--surface-active: #343029;  /* pressed/active state */
--surface-elevated-2: #28251f;
```
Then use `var(--surface-hover)` / `var(--surface-active)` in ALL dark overrides below.

### Phase B — Sidebar hovers (THE reported bug: hover too bright / unreadable)
For EACH set background:var(--surface-hover), color:var(--text-primary):
1. `.nav-item:hover` (line 908 light / 911 dark — VERIFY dark uses var(--surface-hover), not
   #ebe5da; replace if light hex).
2. `.sidebar-toggle:hover` (line 2045) — ADD dark override.
3. `fw-button.sidebar-collapse:hover` — ADD dark override.
4. `.sidebar-user:hover` (line 760 dark override exists — VERIFY uses dark var).
5. `.sidebar-history-item:hover` — ADD dark override.
6. `.user-menu-panel--sidebar .user-menu-item:hover` — ADD dark override.
7. `fw-button.sidebar-logout:hover` — ADD dark override.
8. `.sidebar-history-item` base — verify dark bg is var(--surface-card), not light hex.

### Phase C — Nav items
`.nav-item` base color var(--text-primary); `.nav-item.active` bg var(--surface-active) color
var(--text-primary); `.nav-item .nav-icon` use currentColor/var(--text-muted).

### Phase D — Buttons
`.btn-primary:hover`→var(--surface-active); `.btn-secondary:hover`,
`.btn-ghost:hover`, `fw-button:hover`→var(--surface-hover) color var(--text-primary);
`.btn:disabled`→var(--surface-muted)/var(--text-muted).

### Phase E — Cards / KPI tiles
`.card:hover`, `.kpi-tile:hover`, `.dash-card:hover`→var(--surface-hover);
`.kpi-tile` base var(--surface-card); `.kpi-tile .kpi-value` color var(--text-primary).

### Phase F — Inputs/selects/textareas
`input:hover/:focus`, `textarea:hover/:focus`, `select:hover/:focus`→var(--surface-muted)
color var(--text-primary) border var(--border-subtle); `select option`→var(--surface-card);
`input::placeholder`→var(--text-muted); `.form-control:hover`; `input:disabled`.

### Phase G — Dropdowns
`.dropdown-menu`→var(--surface-card) border var(--border-subtle);
`.dropdown-item:hover`→var(--surface-hover); `.dropdown-item--active`→var(--surface-active).

### Phase H — Tooltips
`.tooltip`, `[data-tooltip]:hover::before/::after`→var(--surface-active) color
var(--text-primary) border var(--border-subtle).

### Phase I — Modals
`.modal-backdrop`→rgba(0,0,0,0.7); `.modal-content`→var(--surface-card);
`.modal-header`→var(--surface-muted); `.modal-close:hover`→var(--surface-hover).

### Phase J — Tables
`table th`→var(--surface-muted); `table td` color var(--text-primary) border
var(--border-subtle); `table tr:hover td`→var(--surface-hover); zebra even→var(--surface-muted).

### Phase K — Task rows
`.task-row` base var(--surface-card); `.task-row:hover`→var(--surface-hover);
`.task-row--completed` color var(--text-muted); `.task-title` var(--text-primary).

### Phase L — Misc
`a:hover` color var(--text-primary); `.badge` var(--surface-active);
`.divider/hr` border var(--border-subtle); `.toast` var(--surface-card);
`.empty-state` var(--text-muted).

### Phase M — lifecycle.css + component css
Grep `:hover` and `background:` — for EVERY light-hex hover/bg add a `[data-theme="dark"]`
override using var(--surface-hover)/var(--text-primary). Grep `color:` for dark hex on
surfaces → var(--text-primary).

## FIX 2 — TASK BOARD (web/tasks.js renderTaskBoard ~line 757)
1. Remove the `"What should I do now?"` heading (line ~761).
2. Remove `${renderQuickAddRow(calls)}` (line ~762). Keep the function definition (other
   paths may use it) but stop calling it from renderTaskBoard.
3. Recommended becomes the first section (line ~767). Active + Completed stay below.
Verify: no heading, no "Add a task…/Due date/Link to call/Add" form, Recommended first.

## FIX 3 — #CALLS loading shell (web/calls-list-view.js renderCallsListView ~917)
1. After `listAnalysesForSession` resolves and records are available, render the list rows
   with each record's own data (deal/account name if present, else "—").
2. Dismiss the "Loading activities" shell at that point — do NOT wait for enrichment.
3. `enrichDealsAndAccounts` runs in background; patch deal/account cells in place by row
   data attribute when the maps resolve. Do NOT re-render the whole list.

## FIX 1 — DASHBOARD FLICKER (web/dashboard.js)
Chosen: BOTH coalesce + in-place row patch.
1. Add module-level `let __recentActivityRenderScheduled=false;` + `scheduleRecentActivityRender()`
   that uses `queueMicrotask` to run `updateRecentActivitySection` ONCE per tick even if
   applyRemoteCallsToLaunchpad, applyRemoteBriefsToLaunchpad, and refreshLaunchpadRemote all fire.
2. Replace the 3 direct `updateRecentActivitySection()` / `section.outerHTML` call sites
   (~1412, ~1375, ~1538) with `scheduleRecentActivityRender()`.
3. Rewrite `updateRecentActivitySection` to patch ROWS in place:
   - Preserve data-assembly logic; only change rendering.
   - Compute a per-row signature (`data-sig`).
   - Diff existing rows (`[data-row-id]`): skip if same sig, replace only changed row
     outerHTML, insert new, remove gone.
   - Update header count via textContent; never assign section.outerHTML.
   - Empty state via textContent/class toggle, not rebuild.
4. Use event delegation on section (register once) for row clicks — don't re-register per render.
Verify: `grep -n outerHTML` web/dashboard.js → only single-row replace, not whole section;
`updateRecentActivitySection()` called only by scheduler; console.count = 1 per tick.

## Constraints
- Do NOT change data-assembly logic, only rendering.
- Commit after each fix (4 commits). Push to origin/2.1 when done.

## Verification (all must pass)
- Dark: toggle dark, hover every sidebar/nav/button/card/input/dropdown/tooltip/modal/table/
  task-row → dark hover bg + readable light text. No light-hex hover remains. Light mode
  unchanged. Run: `grep -rn ":hover" web/*.css` → every light hover has dark override.
- Task: no "What should I do now?" heading, no quick-add form, Recommended on top, Active/
  Completed below.
- #calls: with 50+ records the shell dismisses in ~1-2s when rows render; enrichment fills in
  place; a handful of batched `in` queries not N gets.
- Flicker: KPI + recent-activity update in place, one render per tick, no section teardown.
- `npm run build` passes. Run web test scripts (test-dashboard, test-deal-view, test-tasks,
  test-calls-list-view).
