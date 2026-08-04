# Release 2.1 — Session restore, accounts/contacts cache

**Branch:** `2.1`  
**Base:** `2.9` + `feature/fix-prep-typo-domain` (already merged in history)  
**Portal build:** `2.1` (`web/index.html` meta + `app.js?v=2.1`, `precall.css?v=2.1`)

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
| **Kept from 2.9** | LinkedIn-only DISC, fixed four maturity axes, fixed six channel chips, no unknowns add buttons, no AI banner |

**Files:** `web/precall-brief-v9.js`, `web/precall.css`, `web/scripts/test-precall-render.mjs`

## VPS deploy

```bash
cd /opt/se-singha-paathai/deploy/vps && bash upgrade-now.sh
```

Or see [docs/VPS_DEPLOY.md](./VPS_DEPLOY.md).

## Verify

```bash
bash /opt/se-singha-paathai/deploy/vps/verify-deploy.sh
```

Expect `portal-build" content="2.1"` and `precall.css?v=2.1` on the live portal HTML.
