# Pre-call staging verification (Phase 0)

Run after **co-deploy web + worker** from `main` or `fix/precall-crm-staging-v2`.

## Deploy sanity

1. Open staging → DevTools → Network → `GET /api/config` — note build ids match expected deploy.
2. New pre-call brief: type a corporate email slowly.
3. Confirm requests use scoped reads:
   - `GET /api/contacts?email=`
   - `GET /api/accounts?domain=` (not repeated full `GET /api/accounts` on every keystroke)
   - `GET /api/accounts/:id/deals` after match
4. If only full `/api/accounts` appears, worker is stale or scoped routes failing — fix deploy before UX fixes.

## Issue 12 trace (optional)

Paste in console on empty new-brief form; type email for known existing account:

```javascript
const log = [];
const t0 = Date.now();
const iv = setInterval(() => {
  const el = document.getElementById("prep-account-deal-preview");
  log.push({ ms: Date.now() - t0, text: el?.innerText?.slice(0, 120) || "(hidden)" });
}, 100);
setTimeout(() => { clearInterval(iv); console.table(log); }, 8000);
```

Pass: no long-lived "New account · on confirm" for existing accounts; match within ~2s; changing email to another domain resets tiles to "Checking…".

## CRM debug flag

`localStorage.DEBUG_PREP_CRM=1` then reload — console shows `[prep-crm]` timing after each lookup.

## Demo Prep tab (Issue 2)

Open a saved brief → click **Demo Prep** tab → content must switch (not stay on Discovery). Retry after hard refresh.

## Brief deep link (Issue 3)

Open brief from sidebar recent → URL hash must be `#precall/briefs/:id`. Refresh page → same brief still open.

## Brief generation latency (Issue 11)

After generate, in console: `JSON.parse(sessionStorage.getItem('prep:lastTimings')||'{}')`.

Staging worker env: set `PREP_DEFER_RIVALS_NEWS=true` to skip rivals/news during synthesize when product accepts deferred sections (see `INTEGRATION_RELEASE_GATE.md`).

## Dual-write console (Issue 4)

With SQL authoritative reads, meddpicc migration should not retry after permission failure (`meddpicc_deal_migration_v1=skipped_permission` in localStorage).

## Local list fallback (dev only)

Set `localStorage.ALLOW_LIST_FALLBACK=1` only when debugging against a worker missing scoped routes — never on staging smoke tests.
