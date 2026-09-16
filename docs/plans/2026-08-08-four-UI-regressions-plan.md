# Implementation Plan — Lionpath SE Portal Branch 2.1 (4 UI Regressions)

**Architect:** GLM-5.2 | **Implementer:** Codex (gpt-5.5) | **Repo:** `/root/lionpath_V2` | **Branch:** `2.1`

---

## FIX A — `web/calls-list-view.js` — Wire click handlers on initial render

### Problem
`renderCallsListView` sets `container.innerHTML` (≈line 1151) then calls only `wireCallListFilters(...)` (≈line 1200). `wireCallListClicks(...)` is called exclusively inside `paint()` (≈line 1141), which only fires on filter change. First-render rows are dead.

### Exact steps

1. **Open** `web/calls-list-view.js`. Locate `renderCallsListView` function.

2. **Find** the block after the initial `container.innerHTML = ...` assignment (≈line 1151) where `wireCallListFilters(container, opts)` is called (≈line 1200).

3. **Add** a call to `wireCallListClicks` immediately after `wireCallListFilters`:

```js
wireCallListFilters(container, opts);
wireCallListClicks(container, opts);   // ← ADD THIS LINE
```

4. **Verify** that `paint()` (≈line 1141) already calls `wireCallListClicks(container, opts)` after it re-sets `innerHTML`. It does — leave it. This ensures filter re-renders stay wired.

5. **Verify** the function signature of `wireCallListClicks` matches `(container, opts)` and that it queries `.act-feed-row` elements and attaches `click` + `keydown` handlers calling `opts.onSelectCall` / `opts.onSelectBrief`. Do not change its internals.

6. **Grep guard** — after edit, run:
```bash
grep -n "wireCallListClicks" web/calls-list-view.js
```
Expected: ≥3 hits — the function definition, the call inside `paint()`, and the new call after `wireCallListFilters`.

---

## FIX B — `web/dashboard.js` — Re-wire call links after coalesced row diff

### Problem
`scheduleRecentActivityRender` → `updateRecentActivitySection` does in-place row diffing (`row.replaceWith(nextRow)`, `card.insertBefore(nextRow, cursor)`). Newly inserted `.dash-call-link` nodes are never passed to `wireCallLinks`. The delegated handler reads `container._recentActivityOpts` which can be stale.

### Exact steps

#### Step B1 — Make `wireCallLinks` idempotent

1. **Locate** `wireCallLinks(container, handler)` in `web/dashboard.js`.

2. **Change** the querySelectorAll call to skip already-wired elements:

```js
// BEFORE:
const links = container.querySelectorAll(".dash-call-link");

// AFTER:
const links = container.querySelectorAll('.dash-call-link:not([data-call-wired="1"])');
```

3. **After** attaching handlers to each `el` in the loop, add:

```js
el.setAttribute("data-call-wired", "1");
```

This makes `wireCallLinks` safe to call repeatedly on the same container — only un-wired nodes get handlers.

#### Step B2 — Ensure `container._recentActivityOpts` is always current

1. **Locate** `wireRecentActivitySection(container, opts)` (≈line 2068).

2. **At the very top of the function body**, add (or ensure present):

```js
container._recentActivityOpts = opts;
```

This must run on EVERY call to `wireRecentActivitySection`, not just the first. If the function currently guards with `if (container._recentActivityOpts) return;` or similar, remove that guard — the assignment must always execute.

3. **Verify** the delegated click handler inside `wireRecentActivitySection` reads `container._recentActivityOpts` at event-dispatch time (inside the listener callback), NOT from a closure-captured variable. If it captures `opts` in a closure, change it to read `container._recentActivityOpts` inside the listener body:

```js
// Inside the delegated click listener:
const currentOpts = container._recentActivityOpts;
if (!currentOpts) return;
const link = event.target.closest(".dash-call-link");
if (!link) return;
const callId = link.getAttribute("data-call-id");
if (callId && currentOpts.onOpenCall) {
  currentOpts.onOpenCall(callId);
}
```

#### Step B3 — Re-wire after in-place row diff

1. **Locate** `updateRecentActivitySection` (the function that does `row.replaceWith(nextRow)` / `card.insertBefore(nextRow, cursor)`).

2. **At the END of the function**, after all diff operations are complete, add:

```js
// Re-wire any newly inserted .dash-call-link nodes (idempotent — skips already-wired)
const opts = container._recentActivityOpts;
if (opts && typeof opts.onOpenCall === "function") {
  wireCallLinks(container, opts.onOpenCall);
}
```

(Use whatever variable name holds the section/container in this function's scope. The key is: call `wireCallLinks` on the section element after the diff loop finishes.)

3. **Grep guard**:
```bash
grep -n "data-call-wired" web/dashboard.js
```
Expected: hits in `wireCallLinks` (the `:not()` selector + the `setAttribute`).

---

## FIX C — `web/dashboard.js` — Single-source KPI reconciliation

### Problem
Three independent data sources (tasks, calls, briefs) settle at different times. `writeKpiSnapshot` is called from 5 sites (lines ≈1402, 1431, 1550, 1922, 2078) with different partial data. `readKpiSnapshot` cache can be stale or ahead of local. No single reconcile function.

### Exact steps

#### Step C1 — Add module-scoped state

Near the top of `web/dashboard.js` (after imports / module-level variable declarations), add:

```js
let _remoteSyncPending = false;
let _lastReconciledKpis = null;
```

#### Step C2 — Create `computeReconciledKpis`

Add a new function (place it near `aggregateTaskMetrics` / `buildLaunchpadCallMetricsFromRecords`):

```js
function computeReconciledKpis(email, sources) {
  // sources = { localTasks, localCalls, remoteCalls, localBriefs }
  // Each property is optional — fall back to direct calls.
  const tasks = sources.localTasks ?? listTasks(email);
  const taskMetrics = aggregateTaskMetrics(tasks);

  const localCalls = sources.localCalls ?? listPostCallAnalyses(email);
  const remoteCalls = sources.remoteCalls ?? [];
  const reconciledCallRecords = reconcileCallRecords(localCalls, remoteCalls);
  const callMetrics = buildLaunchpadCallMetricsFromRecords(reconciledCallRecords);

  const briefs = (sources.localBriefs ?? loadAllLocalBriefs());
  const briefsCount = Array.isArray(briefs) ? briefs.length : briefs;

  return { tasks: taskMetrics, calls: callMetrics, briefs: briefsCount };
}
```

**Note to Codex:** If `reconcileCallRecords` does not exist as a named function, extract the existing inline reconciliation logic (the merge/dedup by call ID that currently happens ad-hoc in the remote sync callback) into this function. It should: merge local + remote by `callId`, prefer remote fields when present, keep local-only records.

#### Step C3 — Create the SINGLE snapshot writer

```js
function writeReconciledKpiSnapshot(kpis) {
  if (_remoteSyncPending) return;        // do not persist while remote is in-flight
  _lastReconciledKpis = kpis;
  writeKpiSnapshot(kpis);                // existing storage function
}
```

#### Step C4 — Create `getKpisForRender`

```js
function getKpisForRender() {
  // Prefer the most recent in-memory reconciled value
  if (_lastReconciledKpis) return _lastReconciledKpis;
  // If remote is NOT pending, the cache is safe to use
  if (!_remoteSyncPending) {
    const cached = readKpiSnapshot();
    if (cached && cached.tasks && cached.calls) return cached;
  }
  // Fallback: return null — caller computes from local only (no snapshot write)
  return null;
}
```

#### Step C5 — Replace all 5 `writeKpiSnapshot` call sites

Find each of the 5 sites (≈lines 1402, 1431, 1550, 1922, 2078). For each:

- **Identify** what data is available at that call site (local tasks? local calls? remote calls? local briefs?).
- **Replace** the direct `writeKpiSnapshot(...)` call with:

```js
writeReconciledKpiSnapshot(computeReconciledKpis(email, {
  localTasks,      // if available at this site, else omit
  localCalls,      // if available, else omit
  remoteCalls,     // if available, else omit
  localBriefs,     // if available, else omit
}));
```

Codex must inspect each site to determine which variables are in scope and pass them. The function falls back to direct calls (`listTasks`, `listPostCallAnalyses`, `loadAllLocalBriefs`) for any omitted property.

**Grep guard after this step:**
```bash
grep -n "writeKpiSnapshot" web/dashboard.js
```
Expected: exactly 1 call site — inside `writeReconciledKpiSnapshot`. All 5 original direct calls must be gone.

#### Step C6 — Gate remote sync with `_remoteSyncPending`

1. **Locate** the remote sync flow (where `opts.fetchRemoteHistory()` is called — likely in `renderSeLaunchpadOnce` or a helper it calls).

2. **Before** the remote call:
```js
_remoteSyncPending = true;
```

3. **After** the remote call resolves (in `.then` / `await` / `.finally`):
```js
_remoteSyncPending = false;
// Now compute and persist the fully reconciled KPIs
const reconciledKpis = computeReconciledKpis(email, {
  localTasks: listTasks(email),
  localCalls: listPostCallAnalyses(email),
  remoteCalls: remoteResult,   // the data returned by fetchRemoteHistory
  localBriefs: loadAllLocalBriefs(),
});
writeReconciledKpiSnapshot(reconciledKpis);
// Trigger re-render with the reconciled values
```

4. **In the Firestore `onSnapshot` handler** (for call records): after processing the snapshot data, call:
```js
const kpis = computeReconciledKpis(email, {
  localCalls: snapshotCalls,   // or however the snapshot data is named
  remoteCalls: [],
  localBriefs: loadAllLocalBriefs(),
});
writeReconciledKpiSnapshot(kpis);
```
Then re-render.

#### Step C7 — Use `getKpisForRender` in `renderSeLaunchpadOnce`

In `renderSeLaunchpadOnce`, replace the KPI read logic with:

```js
const kpis = getKpisForRender() ?? computeReconciledKpis(email, {
  // local-only fallback — do NOT write snapshot here
  localBriefs: loadAllLocalBriefs(),
});
// Render with `kpis.tasks`, `kpis.calls`, `kpis.briefs`
```

The initial paint uses local-only (or cached if remote is not pending). When remote resolves, the re-render uses fully reconciled data. The snapshot is only written after remote completes, so the cache is never stale/partial.

---

## FIX D — `web/precall.css` + `web/precall.js` — Brief content scroll

### Problem
`#view-precall:has(#prep-result-view:not([hidden]))` sets `max-height:none` (line 140), breaking the bounded-height flex chain. The innermost content panel has no `overflow:auto`, so long briefs are clipped with no scrollbar.

### Exact steps — `web/precall.css`

#### Step D1 — Fix the `:has` rule (line ≈140)

```css
/* BEFORE: */
#view-precall:has(#prep-result-view:not([hidden])) {
  max-height: none;          /* ← THIS BREAKS THE CHAIN */
  /* ...other props... */
}

/* AFTER: */
#view-precall:has(#prep-result-view:not([hidden])) {
  max-height: 100%;          /* keep bounded by parent */
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  /* ...keep other existing props... */
}
```

#### Step D2 — Ensure `#prep-result-view` is a flex column parent (line ≈974)

```css
#prep-result-view {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;             /* ← ADD if missing */
  flex-direction: column;    /* ← ADD if missing */
}
```

#### Step D3 — Ensure `#prep-tabs` is a flex column parent (line ≈1084)

```css
#prep-tabs {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  display: flex;             /* ← ADD if missing */
  flex-direction: column;    /* ← ADD if missing */
}
```

#### Step D4 — Make the tab panel content the scroll region

**Codex must identify** the innermost element that directly contains the brief text (the element whose `innerHTML` is set with the generated brief content). This is likely a child of `#prep-tabs` — possibly `.prep-tab-panel`, `.tab-content`, `[data-tab-panel]`, or similar. Inspect `precall.js` for where the generated brief HTML is injected.

Add (or amend) a CSS rule for that element:

```css
/* Replace SELECTOR with the actual innermost content container */
#prep-tabs > [role="tabpanel"],
#prep-tabs .tab-panel-body,
#prep-tabs .prep-result-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;   /* smooth scroll on mobile */
}
```

**If the tab panel uses a wrapper structure** (e.g., `#prep-tabs > .tab-nav` + `#prep-tabs > .tab-panels > .tab-panel`), ensure EVERY ancestor in the chain from `#prep-tabs` down to the scroll element has `min-height:0` and `display:flex; flex-direction:column;` so the `flex:1` child can actually shrink and scroll.

### Exact steps — `web/precall.js`

#### Step D5 — Reset scroll position on reveal

**Locate** `revealPrepResultView` (the function that unhides / animates in `#prep-result-view` after generation completes).

**At the end of the reveal** (after the element is shown, after any animation/transition completes), add:

```js
// Reset scroll to top of the brief content
const scrollRegion = document.querySelector("#prep-result-view [data-tab-panel]:not([hidden]), #prep-tabs .tab-panel-body, #prep-tabs .prep-result-content");
if (scrollRegion) {
  scrollRegion.scrollTop = 0;
}
```

**Adjust the selector** to match the actual scroll element identified in Step D4. The key behavior: after the brief is generated and revealed, the scroll region starts at the top and is scrollable.

#### Step D6 — Verify the flex chain is unbroken

Run this mental check (or grep the CSS):

```
#view-precall          → height:100%; overflow:hidden; display:flex; flex-direction:column;
  #prep-result-view    → flex:1; min-height:0; overflow:hidden; display:flex; flex-direction:column;
    #prep-tabs         → flex:1; min-height:0; overflow:hidden; display:flex; flex-direction:column;
      [scroll region]  → flex:1; min-height:0; overflow-y:auto;
```

Every link must have `min-height:0` (or `min-height:unset`) — without it, flex children won't shrink below their content size and `overflow:auto` won't activate.

---

## Anti-Regression + Verification Checklist

### Build
```bash
cd /root/lionpath_V2
npm run build          # or whatever the project build command is
# Verify: no errors, no warnings about missing modules
```

### Grep guards
```bash
# FIX A: wireCallListClicks called after initial render AND in paint
grep -n "wireCallListClicks" web/calls-list-view.js
# Expected: ≥3 hits (definition + initial-render call + paint call)

# FIX B: idempotent wiring
grep -n "data-call-wired" web/dashboard.js
# Expected: ≥2 hits (selector :not + setAttribute)

# FIX B: _recentActivityOpts always set
grep -n "_recentActivityOpts" web/dashboard.js
# Expected: assignment in wireRecentActivitySection + read in delegated handler + read in updateRecentActivitySection

# FIX C: only one writeKpiSnapshot call site
grep -n "writeKpiSnapshot" web/dashboard.js
# Expected: exactly 1 hit — inside writeReconciledKpiSnapshot

# FIX C: remote sync gating
grep -n "_remoteSyncPending" web/dashboard.js
# Expected: declaration + set true + set false + check in writeReconciledKpiSnapshot + check in getKpisForRender

# FIX D: no max-height:none on #view-precall
grep -n "max-height.*none" web/precall.css
# Expected: 0 hits on lines near #view-precall (or the :has rule)
```

### Manual test sequence

1. **FIX A — Activities list first-render clickability:**
   - Hard refresh the portal. Navigate to All Calls / Activities.
   - Without clicking any filter, click a row. **Expected:** row opens detail view.
   - Navigate away and back. Click a row again. **Expected:** still works.

2. **FIX B — Dashboard Recent Activity after coalesce:**
   - Navigate to dashboard. Wait 30+ seconds for coalesced refresh to fire (or trigger a data update).
   - Click a Recent Activity call row. **Expected:** opens call detail.
   - Repeat after another coalesce cycle. **Expected:** still works.

3. **FIX C — KPI consistency:**
   - Reload the dashboard 5 times. Note the KPI tile values each time.
   - **Expected:** all 5 loads show the same values (after remote sync completes, ≤2s).
   - Check `readKpiSnapshot()` in DevTools console — should match displayed values.

4. **FIX D — Pre-call brief scroll:**
   - Navigate to Pre-call. Generate a long brief (one that exceeds viewport height).
   - After reveal, scroll down within the brief content. **Expected:** content scrolls, scrollbar visible.
   - Scroll back to top. **Expected:** starts at top after reveal.
   - Resize browser window smaller. **Expected:** scroll still works, content not clipped.

---

## Commit Strategy

**One commit per file.** Each commit message follows conventional format.

```bash
# Ensure on branch 2.1
cd /root/lionpath_V2
git checkout 2.1
git pull origin 2.1

# --- Commit 1: FIX A ---
git add web/calls-list-view.js
git commit -m "fix(calls-list): wire click handlers on initial render

wireCallListClicks was only called inside paint() (filter re-render),
leaving first-render rows without click/keydown handlers. Call it
after the initial innerHTML + wireCallListFilters so rows are
clickable on first open.

Refs: GLM-5.2 FIX A"

# --- Commit 2: FIX B + FIX C (same file) ---
git add web/dashboard.js
git commit -m "fix(dashboard): re-wire recent activity links after coalesce + single-source KPIs

FIX B: wireCallLinks is now idempotent (data-call-wired attr).
updateRecentActivitySection calls wireCallLinks after in-place row
diff so newly inserted .dash-call-link nodes are clickable.
wireRecentActivitySection always updates container._recentActivityOpts.

FIX C: Single reconcile function computeReconciledKpis is the only
path to writeKpiSnapshot (via writeReconciledKpiSnapshot). Remote
sync gated by _remoteSyncPending — snapshot not written while remote
in-flight. getKpisForRender prefers in-memory reconciled, then cache
(only if remote not pending), then local fallback.

Refs: GLM-5.2 FIX B + FIX C"

# --- Commit 3: FIX D (CSS) ---
git add web/precall.css
git commit -m "fix(precall): bounded flex chain for brief content scroll

Remove max-height:none on #view-precall :has rule — was breaking
the bounded-height flex chain so overflow:auto on the inner content
panel never activated. Ensure #prep-result-view, #prep-tabs, and the
tab panel content form an unbroken flex:1 / min-height:0 chain with
overflow-y:auto on the innermost scroll region.

Refs: GLM-5.2 FIX D"

# --- Commit 4: FIX D (JS) ---
git add web/precall.js
git commit -m "fix(precall): reset scroll position on brief reveal

After revealPrepResultView shows the generated brief, reset the
content scroll region to scrollTop=0 so the user starts at the top.

Refs: GLM-5.2 FIX D"

# --- Push ---
git push origin 2.1
```

---

## Summary Table

| Fix | File | Root cause | Fix essence |
|-----|------|-----------|-------------|
| A | `calls-list-view.js` | `wireCallListClicks` only in `paint()` | Call it after initial `innerHTML` + `wireCallListFilters` |
| B | `dashboard.js` | Coalesced diff inserts unwired `.dash-call-link` nodes; `_recentActivityOpts` stale | Idempotent `wireCallLinks` (`data-call-wired`); re-wire after diff; always set `_recentActivityOpts` |
| C | `dashboard.js` | 5 scattered `writeKpiSnapshot` sites; no reconcile; cache races | Single `computeReconciledKpis` → `writeReconciledKpiSnapshot`; `_remoteSyncPending` gate; `getKpisForRender` preference order |
| D | `precall.css` + `precall.js` | `max-height:none` breaks flex chain; no `overflow:auto` on scroll region | Remove `max-height:none`; unbroken `flex:1/min-height:0` chain; `overflow-y:auto` on innermost; `scrollTop=0` on reveal |
