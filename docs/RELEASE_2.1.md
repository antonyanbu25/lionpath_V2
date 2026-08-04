# Release 2.1 — Session restore, accounts/contacts cache

**Branch:** `2.1`  
**Base:** `2.0.8.2` + `feature/fix-prep-typo-domain` (already merged in history)  
**Portal build:** `2.1` (`web/index.html` meta + `app.js?v=2.1.6`, `precall.css?v=2.1.2`, `precall-brief-v9.js?v=2.1.3`)

## Fixes

| Issue | Fix |
|-------|-----|
| Refresh redirects to login with valid session | Restore local/dummy session when Firebase has no user; boot waits for `showApp` before `showLogin` |
| Contacts flash then disappear | Merge history preview contacts in `listContactsForSession`; load history before nav |
| Accounts empty despite prep/post-call | Include prep briefs + post-call history rows; derive account name from prospect email; do not cache empty lists |
| Prep research on typo email domains | From `feature/fix-prep-typo-domain` — company name prioritized over email domain in worker + form hints |

## Pre-call Know tab UI polish (reference alignment)

Aligned the generated brief **Know your Customer** tab to the approved `newportalui.html` wireframe. Worker still generates `icpFit` in the JSON; it is no longer rendered in the SE-facing Know tab.

| Change | Detail |
|--------|--------|
| **ICP Fitment removed** | No `.prep-v9-icp-card` on Know tab (legacy Discovery tab unchanged) |
| **Grid row 1** | About the company \| Recent news (unchanged) |
| **Grid row 2** | Where they sit versus their industry \| How big is this fish? |
| **Grid row 3** | Their support stack \| What we could not find (right column omitted when no gaps) |
| **Maturity band colors** | Pastel fills from reference: large `#e8c4bd`, partial `#eddcbb`, parity/close `#cfe0d9` (Gap text column stays removed) |
| **Fish benchmark bars** | Horizontal range rail (`#f4f0e8`), rival band (`#e8e0d0`), prospect dot (`#a58a5c`) per `prep.rivals.axes` |
| **Kept from 2.0.8.2** | LinkedIn-only DISC, fixed four maturity axes, fixed six channel chips, no unknowns add buttons, no AI banner |

**Files:** `web/precall-brief-v9.js`, `web/precall.css`, `web/scripts/test-precall-render.mjs`

## Pre-call: LinkedIn validation, Recent news, fish sizing

| Feature | Detail |
|---------|--------|
| **LinkedIn PDF required** | `buildPayload()` blocks submit until every prospect email has an attached LinkedIn PDF (`emailsMissingLinkedInPdf` in `web/prep-linkedin-pdf.js`) |
| **Recent news pipeline** | **Parallel:** Gemini grounded search + web crawl (Google News RSS + DuckDuckGo, merged up to 5). Redirect URL resolution before citation verify. **Newsroom fallback** when RSS/DDG return 0. **No** research-fact or SE-context backfill. Each item: headline + **Read article →** (RSS HTML stripped — no `&lt;a href=` detail lines). |
| **Fish sizing pipeline** | **Parallel:** grounded rival comparison + AE context extraction when notes present. Web benchmark bars first; non-overlapping AE metrics append with **INPUT** badge. Context-only card when web finds nothing. Incumbent/integration/requirement lines excluded. |

**Worker files:** `worker/src/prep/company-news.ts`, `worker/src/prep/rivals.ts`, `worker/src/prep/rivals-context.ts`, `worker/src/research/providers/company-news-search.ts`, `worker/src/prep/index.ts`, `worker/src/schema.ts`

**Web files:** `web/precall.js`, `web/prep-linkedin-pdf.js`, `web/precall-brief-v9.js`, `web/recent-news.js`, `web/precall.css`, `web/app.js`

**Tests:** `worker/scripts/test-company-news.ts` (32 checks), `worker/scripts/test-rivals-context.ts`, `web/scripts/test-precall-render.mjs` (74 checks)

**Ops:** Recent news and fish sizing run during `POST /api/prep/synthesize` — redeploy **worker + web** (`upgrade-now.sh`). Generate a **new** brief to pick up pipeline changes; history entries keep old `recentNews` unless regenerated.

## VPS deploy

```bash
cd /opt/se-singha-paathai/deploy/vps && bash upgrade-now.sh
docker compose logs worker | grep company-news   # optional: gemini=X web=Y merged=Z
```

Or see [docs/VPS_DEPLOY.md](./VPS_DEPLOY.md).

## Verify

```bash
bash /opt/se-singha-paathai/deploy/vps/verify-deploy.sh
```

Expect `portal-build" content="2.1"` and current cache-bust query strings on the live portal HTML (`app.js?v=2.1.6` or later).
