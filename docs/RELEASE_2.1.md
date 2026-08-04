# Release 2.1 â€” Dedup, RAG omni-search, Know tab polish

**Branch:** `2.1`  
**Base:** `2.0.8.2` + prior 2.1 prep fixes  
**Portal build:** `2.1.12` (`web/index.html` meta + `app.js?v=2.1.12`)  
**Worker build:** `2.1.5` (`worker/src/build-id.ts`)

## Account / deal deduplication

| Issue | Fix |
|-------|-----|
| Repeat search creates duplicate accounts | `upsertAccountFromPrep` honours `accountId`, domain lookup, slug; preserves name when CRM-selected |
| Repeat pre-call search shows "new account" | `prep-crm-resolve.js` reuses domain-store account on repeat email search (`ed48285`) |
| `createNewDeal` ignored on prep | `getOrCreateLifecycle` archives old spine and calls `createDealWithExplicitTitle` |
| Post-call ignores `accountId` / `createNewAccount` | `linkPostCallToLifecycle` passes flags through to upsert |
| UI always says "new account/deal" | Badges: **Existing account** vs **New account Â· on generate/confirm** |

**Files:** `web/domain/account-service.js`, `web/domain/lifecycle-service.js`, `web/domain/dual-write.js`, `web/prep-crm-resolve.js`, `web/postcall.js`

**Test:** `node web/scripts/test-contact-deal-mapping.mjs` (13 checks)

## RAG omni-search

| Feature | Detail |
|---------|--------|
| Filter chips | All, Accounts, Deals, Contacts, Briefs, Calls, Tasks |
| Recently searched / viewed | Per-user localStorage with Clear |
| Hybrid ranking | Local token match â†’ `POST /api/search/rag` Gemini embedding rerank |
| Index scope | Accounts, contacts, deals, briefs, calls, open tasks |
| Speed | Sync localStorage index before Firestore; instant token hits + async RAG rerank (`3aeab26`) |
| Panel alignment | Dropdown anchored to topbar search input (`1258713`) |
| Open from search | Account/contact/deal navigation clears stale deal context and passes `accountId` for fallback (`2.1.12`) |

**Files:** `web/search-service.js`, `web/global-search.js`, `web/app.js`, `worker/src/search/rag-search.ts`, `worker/src/routes.ts`

## Session restore, accounts/contacts cache

| Issue | Fix |
|-------|-----|
| Refresh redirects to login with valid session | Restore local/dummy session when Firebase has no user; boot waits for `showApp` before `showLogin` |
| Contacts flash then disappear | Merge history preview contacts in `listContactsForSession`; load history before nav |
| Accounts empty despite prep/post-call | Include prep briefs + post-call history rows; derive account name from prospect email; do not cache empty lists |
| Prep research on typo email domains | From `feature/fix-prep-typo-domain` â€” company name prioritized over email domain in worker + form hints |

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
| **Recent news pipeline** | **Parallel:** Gemini grounded search + web crawl (Google News RSS + DuckDuckGo, merged up to 5). Redirect URL resolution before citation verify. **Newsroom fallback** when RSS/DDG return 0. **No** research-fact or SE-context backfill. Each item: headline + **Read article â†’** (RSS HTML stripped â€” no `&lt;a href=` detail lines). |
| **Fish sizing pipeline** | **Parallel:** grounded rival comparison + AE context extraction when notes present. Web benchmark bars first; non-overlapping AE metrics append with **INPUT** badge. Context-only card when web finds nothing. Incumbent/integration/requirement lines excluded. |

**Worker files:** `worker/src/prep/company-news.ts`, `worker/src/prep/rivals.ts`, `worker/src/prep/rivals-context.ts`, `worker/src/research/providers/company-news-search.ts`, `worker/src/prep/index.ts`, `worker/src/schema.ts`

**Web files:** `web/precall.js`, `web/prep-linkedin-pdf.js`, `web/precall-brief-v9.js`, `web/recent-news.js`, `web/precall.css`, `web/app.js`

**Tests:** `worker/scripts/test-company-news.ts` (32 checks), `worker/scripts/test-rivals-context.ts`, `web/scripts/test-precall-render.mjs` (74 checks)

**Ops:** Recent news and fish sizing run during `POST /api/prep/synthesize` â€” redeploy **worker + web** (`upgrade-now.sh`). Generate a **new** brief to pick up pipeline changes; history entries keep old `recentNews` unless regenerated.


## Brief list, Research Extras, and context routing

| Feature | Detail |
|---------|--------|
| **All briefs list** | Dashboard Brief Generated KPI opens searchable all-briefs under Pre-call; back nav; `#precall/briefs`, `#precall/briefs/:id` |
| **Research Extras** | SE/context Additional Context shows **High** confidence |
| **Context field router** | Disambiguates support team vs employee headcount vs end-user volume |
| **Brief UI** | Unknown alignment section removed |

**Files:** `web/briefs-list-view.js`, `web/app.js`, `web/precall.js`, `web/precall-brief-v9.js`, `worker/src/prep/context-field-router.ts`, `web/prep-se-context.js`, `web/prep-source-canon.js`

**Tests:** `web/scripts/test-briefs-list-view.mjs`, `web/scripts/test-prep-se-context.mjs`, `worker/scripts/test-context-field-router.ts`

**Ops:** Web + worker changes — run `upgrade-now.sh` on VPS; hard-refresh portal after deploy.
## Deploy workflow (branch 2.1)

Production VPS deploys from **Tony's repo** (`antonyanbu25/lionpath_V2`). On branch `2.1`, push only to remote **`antony`**, not `origin`. See `.cursor/rules/push-antony-2.1.mdc`.

## VPS deploy

```bash
cd /opt/se-singha-paathai
git fetch antony
git checkout 2.1
git pull antony 2.1
cd deploy/vps && bash upgrade-now.sh
docker compose logs worker | grep company-news   # optional: gemini=X web=Y merged=Z
```

Or see [docs/VPS_DEPLOY.md](./VPS_DEPLOY.md).

Deploy script checks accept `2.1`, `2.1.N`, and suffixed tags like `2.1.10-search` (`cf575bb`, `f71801b`).

## Verify

```bash
bash /opt/se-singha-paathai/deploy/vps/verify-deploy.sh
```

Expect `portal-build" content="2.1.12"` and `workerBuild` including `2.1.5`. Portal should not show the "Speed fixes not deployed" banner when both portal and worker are on 2.1.x.
