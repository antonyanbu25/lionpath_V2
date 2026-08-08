# Fix: call-view technical commit + call notes not loading, dashboard flicker/double-render

Branch: 2.1  |  Diagnostic: glm-5.2 peer review + Gideon code verification (both agree)

## SYMPTOMS (user-reported)
1. "technical commit not coming" — technical commit tab empty/missing.
2. "call notes still not loaded" — call-notes section shows skeleton or "No call notes yet."
3. "dashboard metrics/numbers flicker n reload", "recent calls loading twice", "calls loading twice".
4. "any call I open the graphs and metrics numbers flicker n reload".

## ROOT CAUSES (all verified against actual code)

### BUG A (PRIMARY) — call-view.js renderCallView (~2939-3025) drops the enriched paint
The optimistic-render refactor introduced a *content* staleness guard that is wrong:
```js
const sourceSnapshot = JSON.stringify(resolvedRecord);   // line 2996
...
const freshRecord = getPostCallAnalysis(ownerEmail, targetCallId) || resolvedRecord;
if (freshRecord.id !== targetCallId) return;             // OK (identity)
if (JSON.stringify(freshRecord) !== sourceSnapshot) return;  // BUG: content compare
```
The post-call pipeline writes to local history DURING `loadCallBundle`'s Firestore await
(`updatePostCallAnalysis` writes `summarise`, `technicalCommit`, etc.). So `freshRecord`
differs from `sourceSnapshot` on the happy path — the enriched bundle (which contains the
Firestore-loaded technicalCommit + analysis.callNotes) is silently DISCARDED. The user only
ever sees the local optimistic paint, which never has Firestore-only data. This is why
technicalCommit and callNotes "don't load."

FIX: compare render *identity*, not content. Merge the enriched bundle onto the freshest
local record instead of dropping it. Add `mergeEnrichedRecord(record, bundle)`.

### BUG B — call-view.js loadCallBundle (2422-2433) skips Firestore for a truthy-but-empty technicalCommit
```js
let technicalCommit = resultBlob.technicalCommit || parallel.embeddedTechnicalCommit || null;
...
!technicalCommit && store.getTechnicalCommitByDeal   // only fetches Firestore when falsy
```
`resultBlob.technicalCommit` can be a truthy-but-empty object (e.g. `{ status: 'pending' }`
written during the pipeline). So `!technicalCommit` is false, Firestore is never consulted,
and the real commit never loads.
FIX: treat an empty/partial technicalCommit as absent — fetch Firestore when
`!hasRealTechnicalCommit(technicalCommit)`.

### BUG C — app.js showApp (~2223-2253) + dashboard.js: duplicate dashboard renders
- app.js:2223 fires `loadPersistedHistory()` (void) AND app.js:2240 awaits it again →
  `refreshSidebarRecentWork` / `refreshDashboardFromStorage` run twice (also at 2153, 2881-2886, 2911).
- dashboard.js renderSeLaunchpad (1847) does full `container.innerHTML` reset, then
  refreshLaunchpadRemote patches. No single-flight → KPI numbers flicker (8 → 21), recent
  calls re-render twice.
FIX:
  (C1) app.js: remove the duplicate `void loadPersistedHistory()` at ~2223 (keep the awaited one).
  (C2) dashboard.js: single-flight + coalesce `renderSeLaunchpad` (one re-render after the
       in-flight one settles, using latest data).

### BUG D — call-view.js resolveEffectiveHydrationPending (500-527): skeleton forever
- `summarise` stays pending unless `callNotes` non-empty → call-notes section renders a
  skeleton forever when summarise soft-failed but Firestore has notes.
- `commit` stays pending unless `result.technicalCommit` present → technical commit tab
  skeleton forever after a soft-fail.
FIX: drop a key from pending once data is present OR the Firestore lookup completed (even
with a miss). Also thread the enriched bundle's callNotes into the notes resolution.

## FILES TO CHANGE
- web/call-view.js — BUG A, B, D
- web/app.js — BUG C1
- web/dashboard.js — BUG C2
- web/firebase-config.js + web/index.html + worker/src/build-id.ts — bump 2.1.36 → 2.1.37
  (cache-bust; these were bumped to 2.1.36 in commit 44e37c2 but the fixes above are new)

## VERIFICATION (must pass, real output)
- node web/scripts/test-call-view.mjs
- node web/scripts/test-call-view-animate.mjs
- node web/scripts/test-launchpad-render.mjs
- node web/scripts/test-dashboard-launchpad-sync.mjs
- node web/scripts/test-postcall-render.mjs
- npm run test:build (web)
- git diff --check clean

## CONSTRAINTS
- Surgical, minimal. Do NOT touch the post-call pipeline (web/postcall.js) or the worker.
- Do NOT change Firestore write behavior.
- Do NOT change buildLocalCallBundle's synchronous nature (needed for the optimistic paint).
- Commit on branch 2.1 with a clear message. Push origin/2.1 when green (server pushes as skut264).
