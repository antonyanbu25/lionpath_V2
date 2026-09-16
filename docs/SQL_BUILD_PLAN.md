# SQL Build Plan — Phase 2 (live instance)

Branch: `feat/sql-foundation` · Target: Janus v9.3 on Cloud SQL @ `8.231.110.188` (public IP, QA-only until VPC peering).

**Supersedes** the generic `deploy/cloudsql/provision.sh` path for this environment — instance already exists; credentials live in gitignored [`worker/.dev.vars`](../worker/.dev.vars).

## Done (Phase A foundation)

- [x] `janus/schema/` phases 00–12 + tests
- [x] Persistence layer (`worker/src/data/persistence/`)
- [x] ADR-007, ADR-008, CUTOVER_SQL runbook
- [x] `worker/.dev.vars` populated (`DATABASE_URL_MIGRATIONS`, `DATABASE_URL`, `PERSISTENCE_MODE=firestore`)
- [x] `worker/scripts/verify-db-env.mjs` — confirms env parse without zsh

## In progress (Phase B — build)

| # | Task | Status | Gate |
|---|------|--------|------|
| B1 | Wire `DATABASE_URL` / `PERSISTENCE_MODE` through `node-server.ts` + shared `load-dev-vars.mjs` | **Done** | `verify-db-env.mjs` OK |
| B2 | `worker/scripts/apply-janus-schema.mjs` — apply phases 00–12 via TCP (no `\ir`) | **Script ready** | `apply-janus-schema.mjs --dry-run` lists 13 files |
| B3 | DDL on live instance + partition check | **Pending approval** | `node worker/scripts/apply-janus-schema.mjs` |
| B4 | `grants_smoke` + `rls_fails_closed` | Pending | both exit 0 as `janus_app` |
| B5 | `docs/CLOUDSQL_SECURITY.md` + update `CUTOVER_SQL.md` for public-IP QA | **Doc ready** | boss escalation ready |
| B6 | Fix worker `tsc --noEmit` (39 errors) | Pending | 0 errors + `npm run test:fast` |
| B7 | Local `PERSISTENCE_MODE=dual` soak | Pending | domain-write hits SQL + outbox |
| B8 | Cloud Run secrets + dual mode | Pending | after B4–B7 |

## Credentials (never commit)

| File | Purpose |
|------|---------|
| [`worker/.dev.vars`](../worker/.dev.vars) | Local + `dev:node` (gitignored) |
| GCP Secret Manager `janus-database-url-dev` | Cloud Run `janus_app` URL |
| GCP Secret Manager `janus-database-url-migrations` | Cron/partition jobs only |

Verify anytime: `node worker/scripts/verify-db-env.mjs`

## Security (QA instance)

- Public IP `8.231.110.188`, authorized `0.0.0.0/0` — **dev/QA only**
- VPC peering blocked: needs **Service Networking Admin** on provisioning SA → see [`CLOUDSQL_SECURITY.md`](./CLOUDSQL_SECURITY.md)
- Worker must use `janus_app`, never `postgres` superuser

## Execution order (Kimi K3 build session)

```
✅ B1 wire env
✅ B2 schema script (dry-run OK)
→ B3 apply DDL (requires approval: node worker/scripts/apply-janus-schema.mjs)
→ B4 smoke tests (grants_smoke, rls_fails_closed, manage-partitions --check)
✅ B5 security doc (CLOUDSQL_SECURITY.md)
∥ B6 TS fixes (39 errors)
→ B7 dual soak (PERSISTENCE_MODE=dual in .dev.vars)
→ B8 Cloud Run
```

### Kimi K3 — next commands (in order)

1. `node worker/scripts/apply-janus-schema.mjs` — DDL on `8.231.110.188` (postgres role)
2. `node janus/tests/grants_smoke.test.mjs` — loads `.dev.vars` via `DATABASE_URL`
3. `node janus/tests/rls_fails_closed.test.mjs`
4. `node janus/scripts/manage-partitions.mjs --check` — postgres migrations URL
5. Set `PERSISTENCE_MODE=dual` in `.dev.vars`, run `npm run dev:node`, exercise a domain write
