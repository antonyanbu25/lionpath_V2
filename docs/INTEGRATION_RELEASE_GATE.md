# Staging release gate — integrate/precall-assume-identity

**Rollback SHA (pre-integration `main`):** `70897d751cc87c776622b5806282018ca014b561`  
**Integration tip:** `8c6ce1a` on branch `integrate/precall-assume-identity` (overlay-only precall loading; no inline Brief pipeline card)

## RELEASE DECISION

**PUSH ONLY AFTER ADDRESSING LISTED RISKS** (open PR → review → merge to `main` → staging deploy)

Automated unit + assume-identity + CI foundation pass locally. Full GitHub CI (Playwright e2e, Firestore emulator rules, SQL gates) not executed in this session — required before treating staging as green.

---

## 1. Current git state

- Branch: `integrate/precall-assume-identity`
- Commits: merge assume-identity (`6d02e78`) + precall port (`95cf724`)
- Base: `origin/main` @ `70897d7`

## 2. Changes combined

### Pre-Call

Scoped CRM reads, api-store wiring, prep CRM UX, nav/tab dedupe, prep timings / `PREP_DEFER_RIVALS_NEWS`, dual-write retry cap.

### Assume Identity

Admin assume/exit routes, audit-before-mint, exit reauth, login-as-ui + client expired handling, domain-reads `filterAccountsForReader`.

## 3. Integration risk (mitigated)

- `domain-reads.ts`: PG stack + scoped GETs + filter export — verified by grep + `test-domain-reads-auth.mjs`
- `api-store.js`: precall scoped fetch + `dispatchAssumeIdentityExpiredIfNeeded` — wired manually after precall checkout

## 4. Rebase risk

Orphan `fix/precall-fixes` avoided; patch checkout used instead.

## 5. Issues found

| Severity | Issue | Status |
|----------|-------|--------|
| MEDIUM | GitHub CI e2e/sql/rules not run here | Open — run on PR |
| LOW | Assume + precall under assume session needs staging SSO smoke | Open — manual |

## 6. Half-baked check

No new TODO blockers in integrated paths; manifests register precall + assume tests.

## 7. Agent council (post-integration)

**FOR:** 109/109 worker unit, 147/147 web unit, assume-identity 20+3 cases, ci-foundation OK, typecheck OK, web build OK.

**AGAINST:** No browser E2E; assume-under-precall not exercised end-to-end locally.

**Strongest objection:** Staging SSO + Playwright nav/precall paths unverified.

**Resolution:** Merge via PR after GitHub CI green; run staging smoke below.

## 8. Validation results

| Command | Result |
|---------|--------|
| `node worker/scripts/test-ci-foundation.mjs` | PASS |
| `cd worker && npm run test:assume-identity` | PASS |
| `cd worker && npm test -- --tag=unit` | **109/109** |
| `cd web && npm test -- --tag=unit` | **147/147** |
| `cd web && npm run build` | PASS |
| `cd worker && npm run typecheck` | PASS |

## 9. Remaining risks

- PR CI legs (e2e, emulator, sql, secrets scan)
- Co-deploy web + worker on staging
- `PREP_DEFER_RIVALS_NEWS` env choice

## 10. Staging requirements

- Co-deploy web + worker; Firebase auth on worker; Postgres session for reads/writes
- Optional: `PREP_DEFER_RIVALS_NEWS=true`

## 11. Staging smoke test

1. Normal SE: CRM email lookup (scoped network calls), brief deep link, Demo Prep tab, nav dedupe.
2. Admin without assume: precall still works.
3. Admin assume SE: banner, CRM lookup as SE, brief open, one prep run; exit → re-auth.
4. `GET /api/config` build ids match deploy.

## 12. FINAL RECOMMENDATION

**Do not direct-push `main`.** Push `integrate/precall-assume-identity`, open PR to `main`, wait for CI, merge, deploy staging, run smoke.

**Comfort deploying this tip to staging after PR CI + smoke:** Yes, conditional on those two gates.
