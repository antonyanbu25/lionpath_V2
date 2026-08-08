# Fix: Make call records render instantly like briefs (optimistic render)

Branch: fix/call-optimistic-render (from 2.1)

## The problem
Briefs render instantly because they read only from localStorage. Call records are SLOW
because `renderCallView` → `loadCallBundle` AWAITS a long chain of Firestore reads BEFORE
painting anything:
- getCall / getPostCall (call-view.js:2345-2349)
- listProductGapsByPostCall, listWhatWorksByPostCall, listTcDeltasByCall, listMeddpiccDeltasByCall (2360-2378)
- listDealsForAccount (2408)
- getDeal, getTechnicalCommitByDeal, getAccount (2426-2436)
- getGapCluster (2515-2521)
- enrichScorecardFromStore (2472)

Only AFTER all these resolve does `paintCallRecord` run (call-view.js:3008). So the QIP
score, technical commit, call notes, timeline all appear slowly — they're gated behind
Firestore round-trips. The user sees the loading shell + "Summarising next steps…" while
these reads happen.

## The fix — optimistic render (the briefs pattern)
Paint the call record IMMEDIATELY from the local record (already in localStorage via
getPostCallAnalysis), then enrich the Firestore-dependent parts in the background and
patch them in when they resolve. This is exactly how briefs work.

### In web/call-view.js renderCallView (line ~2939-3016):
1. After resolving the local `record`, paint the call record IMMEDIATELY using a
   local-only bundle (buildLocalCallBundle already exists — call-view.js:554) instead of
   showing the loading shell and waiting for loadCallBundle.
2. Then kick off `loadCallBundle` in the background (fire-and-forget) and, when it
   resolves, re-paint with the enriched bundle (only if still the same call via canApply).
3. This means the user sees the call content instantly (title, notes, scorecard from
   local data), and the Firestore-enriched parts (deal linkage, technical commit, product
   gaps, account) fill in a moment later.

### Key detail — don't block on the loading shell
Currently line 2991-2995 shows `renderCallLoadingShell` then awaits `loadCallBundle`.
Change so that:
- If the local record has enough data to render (it always does — it's the analyzed
  record), paint it immediately with `paintCallRecord` using a local bundle.
- Only show the loading shell if there's genuinely no local data.

### Preserve the existing guards
Keep the `canApply()` / `callRecordMatches()` / `callPanelRenderGen` guards so stale
async renders don't overwrite the DOM. The coalescing in app.js renderCallPanel already
handles concurrent renders.

## Files to change
- web/call-view.js — renderCallView: optimistic paint from local, background enrich

## Verification
- node web/scripts/test-call-view.mjs — must pass
- node web/scripts/test-postcall-render.mjs — must pass
- node web/scripts/test-launchpad-render.mjs — must pass
- npm run build (web) — must pass
- git diff --check — clean

## Notes
- Surgical, minimal. Do NOT change the domain layer or Firestore writes.
- Do NOT change the post-call pipeline.
- The goal is: call opens instantly (like briefs), Firestore enrichment fills in after.
