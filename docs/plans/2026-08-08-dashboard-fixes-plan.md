# FAILPROOF Fix Plan — Dashboard counters, recent-activity clicks, #calls speed, KPI/ARR flicker (GLM-5.2)

Branch: 2.1 | Repo: /root/lionpath_V2 | Implementer: Codex (gpt-5.5)

## Order (strict): A+C → B → D → E

## A) Dashboard "calls analyzed" counter — owner-id resolution
**File: web/app.js** — `buildSubscribeRemoteCalls` (lines ~701-723) and `buildSubscribeRemotePreps` (~670)

Root cause: read path queries `postCalls where ownerId == user.uid` (Firebase auth UID), but
the write path writes `ownerId = ctx.ownerId` (internal id from authIndex, e.g.
`usr_dummy_...`). Mismatch → counter never increments.

1. Find the canonical owner resolver the write path uses (the function that produces
   `ctx.ownerId`). Export it if not exported.
2. In `buildSubscribeRemoteCalls`: resolve the owner id ONCE before building the query (await
   if async), use it in `where('ownerId','==', <resolved>)`. Do NOT use raw `user.uid`.
3. In `buildSubscribeRemotePreps`: unify both branches to use the resolved internal id.
4. Add a dev-only assert: if resolved id === `user.uid`, `console.warn('[owner-id] resolved
   to firebase uid — write path mismatch')`.
5. Do NOT change the write path.

## C) Briefs counter — same owner-id fix in buildSubscribeRemotePreps (covered by A step 3).

## B) Recent activity not clickable
**File: web/dashboard.js** — `refreshLaunchpadRemote` (line ~1538) and `updateRecentActivitySection` (~1787)

Both replace `section.outerHTML = ...` then call `wireRecentActivitySection` but NOT
`wireCallLinks`. The fresh `.dash-call-link` rows have no click handler.

1. After `section.outerHTML = ...`, re-acquire the new section node.
2. Call `wireRecentActivitySection(newSection, ...)` AND `wireCallLinks(newSection, opts.onOpenCall)`
   (match the same onOpenCall arg the initial render at ~1951 uses).

## D) #calls page slow
**File: web/calls-list-view.js** — `enrichDealsAndAccounts` (~line 723)

N+1 Firestore reads (per-record getDeal). Blocks the "Loading activities" shell.

1. Collect unique dealIds + accountIds first.
2. Batch-fetch: use store batch method if present (`getDocsByIdInChunks`, `getAll`), else chunk
   ids by 10 and run `where(documentId(),'in',chunk)` queries, Promise.all across chunks.
3. Render rows immediately with placeholders; enrich asynchronously (patch deal/account cells
   in place). The loading shell dismisses once rows render, not after enrichment.
4. If render-then-enrich is too invasive, at minimum replace the N+1 loop with the batch fetch.

## E) KPI grid + ARR tile flicker

### E.1 Dashboard KPI grid (web/dashboard.js, line ~1408)
Replace `grid.outerHTML = renderLaunchKpis(...)` with in-place patching: for each KPI, call the
existing `patchLaunchKpiValue(grid, kpiKey, newValue)` helper (~line 1336). Only fall back to
full re-render if the set of KPI keys changes (it won't in practice). Same node identity across
snapshots → no flicker.

### E.2 Deal ARR tile (deal-view module — mountDealArrModule / subscribeArrLinesByDeal)
The ARR module double-mounts (once on detail resolve, again on subscribeArrLinesByDeal) →
"bigger rectangle then smaller" layout shift.
1. Guard mount: if already mounted for the same deal id, call the module's update method
   instead of re-mounting.
2. Decouple: mount ONCE (loading state) on detail resolve; subscribeArrLinesByDeal callback
   calls update(), never re-invokes mountDealArrModule.
3. On deal-id change (SPA navigation to different deal), tear down + remount fresh.
4. Give the ARR loading skeleton a fixed min-height matching the populated tile so layout
   doesn't shift.

## Constraints
- Do NOT change the write path.
- Do NOT touch firestore.rules.
- Commit after each phase (or one squashed commit
  `fix(dashboard,calls,deal): owner-id resolution, recent-activity wiring, KPI/ARR in-place patch, calls-list batching`).
- Push to origin/2.1 when done.

## Verification (must all pass before commit)
- A/C: dashboard "calls analyzed" + "briefs" counters increment within ~1s of a new write.
  No cross-user leakage.
- B: after a realtime refresh, clicking a recent-activity row opens the call (3+ rows). Initial
  render rows still clickable.
- D: #calls with 50+ records — "Loading activities" shell dismisses in ~1-2s; Firestore shows a
  handful of batched `in` queries, not 50+ gets.
- E.1: KPI grid node identity stable across snapshots (no flicker).
- E.2: ARR tile mounts ONCE (console.log count = 1 on a deal load); no "bigger then smaller"
  layout shift.
- Run the web build (`npm run build`) and the deal/dashboard/calls test scripts.
