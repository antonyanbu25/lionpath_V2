# Fix: Stuck hydration progressMessage + dashboard double-render

Branch: fix/stuck-hydration-dash (from 2.1)
Diagnosis source: glm-5.2 review (verified against actual code)

## SYMPTOM 1 — "Summarising next steps…" stuck forever on old analyzed calls

ROOT CAUSE: A persisted `progressMessage` in the record's `result.hydration.progressMessage`
is written to localStorage + Firestore during the post-call pipeline (postcall.js:3961),
and is only ever cleared to "" at postcall.js:4182 (inside the pass6 success branch). If the
pipeline is interrupted (refresh/navigation/error) after 3961 but before 4182, the message
persists forever. On every open, call-view.js reads it back verbatim and renders it.

FIX (read-time sanitisation, one place): In `web/call-view.js` `resolveRecordHydration`
(around line 484-492), drop a persisted progressMessage when the record's own data shows
the pipeline is not running (i.e. effectivePending is empty). Reuse the existing
`resolveEffectiveHydrationPending` logic.

```js
function resolveRecordHydration(record) {
  const h = record?.result?.hydration || {};
  const pending = Array.isArray(h.pending) ? h.pending : [];
  const effectivePending = resolveEffectiveHydrationPending(record, pending);
  let progressMessage = typeof h.progressMessage === "string" ? h.progressMessage : "";
  if (progressMessage && effectivePending.length === 0) {
    progressMessage = "";
  }
  return {
    pending: effectivePending,
    errors: h.errors && typeof h.errors === "object" ? h.errors : {},
    progressMessage,
  };
}
```

This covers all historical stuck records. Do NOT touch the pipeline.

## SYMPTOM 2 — Dashboard shows "8" then "21 calls analyzed" (double render)

ROOT CAUSE: Two independent render paths both paint the KPI grid:
- Path A: renderSeLaunchpad paints local-only count ("8") first, then refreshLaunchpadRemote
  patches in place to "21".
- Path B: after loadPersistedHistory completes, app.js:2236-2238 calls
  refreshDashboardFromStorage() → renderSeLaunchpad AGAIN (full container.innerHTML reset),
  painting "21" a second time.

FIX (two parts):
(a) In `web/dashboard.js` renderLaunchKpis / kpiValue (around line 1134-1149): when
    `remotePending.calls` is true and there's a cached snapshot, render the calls KPI in
    `--pending` shimmer state instead of committing the stale local number. The
    `launch-kpi-value--pending` shimmer already exists; the gate is too narrow (only goes
    pending when value is 0). Make it go pending when remote is in flight and local count
    is stale (less than cached/remote).
(b) In `web/app.js` (around line 2236-2238): only call refreshDashboardFromStorage() after
    loadPersistedHistory if no dashboard render is already in flight. Add a guard flag so
    the second full renderSeLaunchpad is suppressed when refreshLaunchpadRemote is still
    patching.

## Files to change
- web/call-view.js — Symptom 1 (resolveRecordHydration)
- web/dashboard.js — Symptom 2a (kpiValue pending gate)
- web/app.js — Symptom 2b (suppress redundant second render)

## Verification
- node web/scripts/test-call-view.mjs — must pass
- node web/scripts/test-launchpad-render.mjs — must pass
- node web/scripts/test-dashboard-launchpad-sync.mjs — must pass
- node web/scripts/test-postcall-render.mjs — must pass
- npm run build (web) — must pass
- git diff --check — clean

## Notes
- Surgical, minimal changes. Do NOT touch the post-call pipeline or worker.
- Do NOT change Firestore write behavior.
