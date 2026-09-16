# Release 2.0.5

**Base:** `lionpath/2.0.4` @ `9dde6c8`  
**Branch:** `2.0.5`  
**Date:** 2026-07-22  

## Summary

Integrates local Kaia enrich hardening onto the refactored 2.0.4 tree (worker `routes.ts`, web shared modules, SSO/accounts fixes, customer reference links, research orchestrator).

## Added / changed

- `worker/src/kaia/*` — share link parse, fetch, cache, sanitize, prep injection, prospect excerpt matching
- `POST /api/kaia/share-content` registered in `worker/src/routes.ts`
- `POST /api/fetch-kaia-summary` kept as legacy alias (same fetch stack)
- `worker/src/contact/enrich-limits.ts` + enrich prompt caps
- `worker/src/prep/input-hash.ts` + `web/prep-input-hash.js` (playbook v2, Kaia ref, context fingerprint)
- Precall: single client fetch → `kaiaContent` / enrich gate tests
- Combined web/worker unit tests; live Gemini probe: `cd worker && npm run test:prep-payloads` (requires `GEMINI_API_KEY`)

## Validation

```bash
cd worker && npm test
cd web && npm test
```

Manual: Firebase SSO → Accounts; prep with Engage Kaia URL; contact enrich DISC source badges.
