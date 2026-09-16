# Integration file map — Pre-Call + Assume Identity

Generated for `integrate/precall-assume-identity` (staging release gate).

## Baseline SHAs (2026-09-14)

| Ref | SHA |
|-----|-----|
| `origin/main` | `70897d751cc87c776622b5806282018ca014b561` |
| `origin/feat/assume-identity-hardening` | `532384ff42c9d78985e825b0d84583ff08b11743` |
| `fix/precall-fixes` | `3bc7423c32a50d143ba63c69b937915a4de2cdeb` |

`fix/precall-fixes` has **no merge-base** with `origin/main` (orphan history). Pre-Call is applied via tree checkout/patch, not branch merge.

## Pre-Call delta vs `origin/main` (20 functional paths)

- README.md
- web/account-deal-preview.js
- web/app.js
- web/domain/api-store.js
- web/domain/dual-write-retry-guard.js
- web/domain/dual-write.js
- web/domain/migrate-meddpicc-to-deals.js
- web/postcall-contact-resolve.js
- web/precall.js
- web/prep-crm-resolve.js
- web/scripts/test-manifest.mjs
- web/scripts/test-prep-apply-account-deals.mjs
- web/scripts/test-prep-crm-preview.mjs
- worker/scripts/test-domain-reads-precall.ts
- worker/scripts/test-manifest.mjs
- worker/scripts/test-route-authorization.ts
- worker/src/prep/index.ts
- worker/src/prep/types.ts
- worker/src/routes.ts
- worker/src/routes/domain-reads.ts

## Assume Identity (3 commits on `origin/feat/assume-identity-hardening`)

Core code paths (see branch diff from merge-base `d7b485d`):

- worker/src/routes/assume-identity.ts
- worker/src/auth.ts
- worker/src/request-context.ts
- worker/src/data/audit-log.ts
- worker/scripts/test-assume-identity-*.mjs
- worker/scripts/test-domain-reads-auth.mjs
- web/assume-identity-client.js
- web/login-as-ui.js
- web/index.html
- web/app.js (partial)
- web/domain/api-store.js (assume-expired dispatch)
- worker/src/routes/domain-reads.ts (`filterAccountsForReader` export — must not replace main PG stack)

## Overlap (manual semantic merge required)

- README.md
- web/app.js
- web/domain/api-store.js
- web/domain/dual-write.js
- web/precall.js
- web/scripts/test-manifest.mjs
- worker/scripts/test-manifest.mjs
- worker/scripts/test-route-authorization.ts
- worker/src/routes.ts
- worker/src/routes/domain-reads.ts
