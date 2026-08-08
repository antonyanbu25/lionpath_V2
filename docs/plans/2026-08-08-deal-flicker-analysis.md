# Analysis — Deal-page tile flicker (ARR/TC/AI attach/Traction loads "old then new")

Date: 2026-08-08 | Branch: 2.1 | Repo: /root/lionpath_V2

## The user's report
When analyzing a call, the deal page score strip shows the OLD/empty tile first, then the
NEW tile replaces it. Specifically:
- **ARR** shows placeholder, then "$948" appears.
- **TC** shows "Pending", then the real status.
- **AI attach** shows empty, then "Customer is interested in using AI for live translation..."
- **Traction** shows something else (placeholder), then "Advancing".
- The **score** comes only after a point.
This is a visible flicker — NOT seamless. Everything else is basically ready; this is the last
thing to make it deploy-ready.

## Root cause

`web/deal-view.js` `loadDealRecordDetail` renders in MULTIPLE passes, each REPLACING the
entire container HTML via `applyDealViewHtml`:

1. **Loading shell** — `renderDealLoadingShell` (line 1954).
2. **Partial detail** — `onPartialDetail` (line 1958) emits a detail with
   `technicalCommit: null, latestSignal: null, daysInStage: null, stageMedianDays: null,
   callRows: [], arrLines: engagementDetail.arrLines || [], dealSummary: null`. This renders
   `renderDealRecord(partial)` — the score strip shows **TC "Pending"**, **Traction "—"**,
   **ARR placeholder**, **no AI attach**, **score "—"** (because `callRows` is empty, so
   `averageCallQuality` returns null).
3. **Full detail** — after `enrichDealRecordExtras` (which loads technicalCommit, latestSignal,
   arrLines, productGaps, whatWorks via Promise.all) resolves, `renderDealRecord(detail)` is
   applied with the REAL data (ARR $948, TC Pending→real, AI attach, Traction "Advancing").
4. **Realtime subscription** — `subscribeDealDetail` callback (line 1990) fires with the
   onSnapshot data and calls `applyDealViewHtml` + `renderDealRecord(next)` AGAIN.

Every one of these calls `applyDealViewHtml(container, ...)` which REPLACES the whole
`container.innerHTML`. So the browser repaints the tile from scratch each time:
shell → empty/partial → full → realtime-refined. That's the flicker.

The score appears "after a point" because `callRows` (needed for `averageCallQuality`) is
loaded in the partial as `[]` and only populated later, so the score tile is "—" until the
full detail arrives.

## The fix (for GLM-5.2 to decide)

The goal: render the tile ONCE with real data, and let the realtime subscription REFINE it
in-place WITHOUT a full re-render flicker.

### Option A — Remove the partial-detail render; single swap to full detail
Delete the `onPartialDetail` early-render. Keep the loading shell until
`enrichDealRecordExtras` resolves, then render the full record once. The realtime subscription
still refines in place. Downside: the tile shows the loading shell slightly longer (but it's
one clean swap, not a flicker). This is the simplest, most reliable fix.

### Option B — Render partial with proper loading placeholders, then merge in place
Keep the early render but make the partial show SHIMMER placeholders (not "Pending"/"—" as if
final), and have the realtime/full-detail update only the changed DOM nodes (patch-in-place)
instead of replacing innerHTML. This is more complex (DOM patching) but gives the fastest
first paint.

### Option C — Coordinate so full detail and realtime refine merge into ONE render
Wait for both `enrichDealRecordExtras` AND the first realtime snapshot, then render once.
Avoids the "old then new" entirely. The realtime subscription then only patches deltas.

## Recommendation
**Option A is the safe deploy-ready choice** (one clean swap, no flicker), possibly combined
with a lightweight version of Option C (render once when the first realtime snapshot arrives,
so the data is complete). The key change: **stop calling `applyDealViewHtml` (full
innerHTML replace) more than once during initial load.** The realtime subscription should
patch only the score strip / arr module, or at most do ONE refine after the initial full
render, not a full re-render each snapshot.

## Files involved
- `web/deal-view.js` — `loadDealRecordDetail` (onPartialDetail, enrichDealRecordExtras),
  `applyDealViewHtml` usage, `renderDealScoreStrip`, the `subscribeDealDetail` /
  `subscribeArrLinesByDeal` callbacks.
- The score strip is `renderDealScoreStrip` (line 766) — it needs `callRows` for the score and
  `latestSignal`/`technicalCommit`/`arrLines` for the tiles.

## Verification
- Open a deal → score strip shows the loading shell once, then a SINGLE swap to the full tile
  (ARR $948, TC, AI attach, Traction Advancing, score all populated at once). No intermediate
  "TC Pending / Traction — / no ARR" flicker.
- Realtime updates (e.g. a new post-call) refine the strip in place WITHOUT a full-page flicker.
