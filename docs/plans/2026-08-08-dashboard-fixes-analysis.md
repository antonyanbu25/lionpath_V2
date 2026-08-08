# Analysis — Dashboard counters not incrementing, recent activity not clickable, #calls slow, ARR tile flicker

Date: 2026-08-08 | Branch: 2.1 | Repo: /root/lionpath_V2

## User's report (post-call analysis + deal page)
1. Deal page: the ARR tile still loads late — "first loads the bigger rectangle one then the
   smaller one (newer one) loads" — one tile loads late, rest are super fast.
2. Dashboard still flickers (the old-then-new tile issue persists there too).
3. After analyzing calls, the dashboard "calls analyzed" number does NOT go up.
4. Recent activity items on the dashboard are NOT clickable (can't open them).
5. Briefs counter does not go up after pre-call briefs.
6. `#calls` page takes a long time — shows "Loading activities" then finally loads fast.

## Root causes (from code)

### A) Dashboard "calls analyzed" counter does not increment
`web/app.js` `buildSubscribeRemoteCalls` (line 701-723) queries:
```
postCalls WHERE ownerId == user.uid   (user.uid = Firebase auth UID, e.g. the Google UID)
```
But postCalls are WRITTEN with `ownerId = ctx.ownerId` (the INTERNAL user id, e.g.
`usr_dummy_sathish_kuttan_freshworks_com` — visible in the earlier log), NOT the Firebase UID.
So the realtime snapshot for `ownerId == user.uid` matches NOTHING (or only a mismatched set),
and the "calls analyzed" count never increments when a new postCall lands.

Same problem in `buildSubscribeRemotePreps` (line ~670, queries prepBriefs by ownerId ==
internal id in one branch, uid in another — inconsistent).

**Fix:** resolve the correct owner id for the query. Use the same owner resolution the write
path uses (internal userId from authIndex / effective owner), NOT the raw Firebase `user.uid`.

### B) Recent activity not clickable
`web/dashboard.js` `refreshLaunchpadRemote` (line 1538) and `updateRecentActivitySection`
(line 1787) REPLACE `section.outerHTML` with new recent-activity rows, but only call
`wireRecentActivitySection` — they do NOT call `wireCallLinks` on the freshly-inserted rows.
So the `.dash-call-link` buttons have no click handler after a refresh → not clickable.

The initial render (line 1951) DOES call `wireCallLinks`, but the realtime/remote refresh path
(line 1538) does not.

**Fix:** call `wireCallLinks(container, opts.onOpenCall)` after `section.outerHTML = ...` in
both `refreshLaunchpadRemote` and `updateRecentActivitySection`.

### C) Briefs counter does not increment
Same root cause as (A): the prep brief count is fed by `buildSubscribeRemotePreps`, which
queries prepBriefs by an owner id that doesn't match how briefs are written. Fix the owner-id
resolution (same as A).

### D) `#calls` page slow ("Loading activities" for a long time)
`web/calls-list-view.js` `enrichDealsAndAccounts` (line 723) does N+1 Firestore reads:
- For every deal id in the records, it calls `getDeal(id)` individually (line 749).
- For every account id, it queries accounts individually.
This runs per-record (51 records → 51+ deal/account lookups) and blocks the "Loading activities"
shell until done.

**Fix:** batch the lookups. Use the store's batch methods if available (`getDocsByIdInChunks`,
`getAll`), or parallelize with concurrency limits, and/or render the list rows immediately and
enrich asynchronously (don't block the shell on enrichment).

### E) ARR tile loads late + "bigger rectangle then smaller" on deal page
Two issues on the deal page:
1. **Late ARR tile:** the ARR module (`mountDealArrModule`) is mounted after the detail
   resolves, and the realtime `subscribeArrLinesByDeal` remounts it. The "bigger rectangle then
   smaller" is the ARR module re-mounting with a different layout (loading state → populated).
2. The dashboard tile flicker (old-then-new) is the same pattern as the deal page I just fixed:
   the dashboard re-renders the KPI grid via `grid.outerHTML = renderLaunchKpis(...)` on every
   realtime snapshot (dashboard.js:1408) — a full grid replace instead of in-place patches.

**Fix for dashboard:** replace `grid.outerHTML = renderLaunchKpis(...)` (line 1408) with
targeted `patchLaunchKpis` calls (there's already a `patchLaunchKpiValue` helper at line 1336),
so the counters update in place without a full grid flicker.
**Fix for ARR tile:** avoid double-mounting the ARR module; mount once and let it update its
internal state rather than remounting the whole module on each snapshot.

## Ask GLM-5.2
Give a FAILPROOF, bug-free implementation plan for Codex (gpt-5.5) covering:
A) Dashboard calls counter — fix owner-id resolution in buildSubscribeRemoteCalls/Preps.
B) Recent activity not clickable — wireCallLinks after outerHTML refresh.
C) Briefs counter — owner-id fix.
D) #calls slow — batch deal/account enrichment, don't block the loading shell.
E) Deal-page ARR tile late/flicker + dashboard KPI grid flicker — in-place patch, single mount.
