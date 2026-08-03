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
