# Open integration PR (starts GitHub CI)

CI runs on **pull requests targeting `main`**, not on feature-branch pushes alone.

## One-click compare

https://github.com/Antony-sagayaraj/SE-Labs/compare/main...integrate/precall-assume-identity?expand=1

## Suggested PR title

`Staging RC: pre-call fixes + assume identity (integrate/precall-assume-identity)`

## Suggested PR body

```markdown
## Summary
- Merge **assume identity hardening** onto current `main`
- Port **pre-call staging fixes** (scoped CRM reads, overlay-only brief generation, nav/tabs, timings)
- Rollback base: `70897d751cc87c776622b5806282018ca014b561`

## Deploy
Co-deploy **web + worker** to staging after merge.

## Local gates (passed on branch tip)
- `node worker/scripts/test-ci-foundation.mjs`
- `cd worker && npm run test:assume-identity && npm test -- --tag=unit` (109/109)
- `cd web && npm test -- --tag=unit` (147/147)

## Docs
- [INTEGRATION_RELEASE_GATE.md](./docs/INTEGRATION_RELEASE_GATE.md)
- [INTEGRATION_PRECALL_ASSUME_IDENTITY_FILE_MAP.md](./docs/INTEGRATION_PRECALL_ASSUME_IDENTITY_FILE_MAP.md)
```

After the PR is open, use the **Checks** tab (jobs: `secrets`, `sql`, `test` × worker/web/rules).

## After you click Create PR (verify CI)

1. On the PR page, open **Checks** (or wait for the yellow pending dot).
2. Confirm these workflows/jobs appear and finish:
   - **CI / secrets**
   - **CI / sql**
   - **CI / test (worker)**
   - **CI / test (web)**
   - **CI / test (rules)**
3. If any job fails, fix on `integrate/precall-assume-identity`, push, and re-check the PR.

Branch list **Check status** stays blank until a PR exists or you use **Actions → Run workflow** (manual).

## After CI is green (merge + staging)

1. **Merge** the PR into `main` (squash or merge per team norm).
2. **Rollback pointer** if needed: `70897d751cc87c776622b5806282018ca014b561`.
3. **Co-deploy web + worker** to staging.
4. Smoke: precall brief (overlay only, no Brief pipeline card), assume identity, scoped CRM APIs — see [INTEGRATION_RELEASE_GATE.md](./INTEGRATION_RELEASE_GATE.md).

## Manual CI without a PR

Actions → **CI** → **Run workflow** → branch `integrate/precall-assume-identity` → optional ref `integrate/precall-assume-identity`.
