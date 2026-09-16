# SQL Cutover Runbook — Firestore → Cloud SQL

Per [ADR-008](./adr/008-firestore-to-sql-decision.md). The `PERSISTENCE_MODE` env flag on the worker controls routing: `firestore` (legacy, default) → `dual` (SQL-primary + outbox projection to Firestore) → `sql` (SQL only).

## Prerequisites (all gated, do not skip)

| Gate | Verify with |
|------|-------------|
| Cloud SQL instance + janus DB provisioned | Live QA: `8.231.110.188:5432` (public IP — see [CLOUDSQL_SECURITY.md](./CLOUDSQL_SECURITY.md)) |
| DDL applied (phases 00–13) | `node worker/scripts/apply-janus-schema.mjs` as postgres (`DATABASE_URL_MIGRATIONS` in `worker/.dev.vars`) |
| `janus_app` password in Secret Manager / `.dev.vars` | `node worker/scripts/verify-db-env.mjs` |
| Grants hold | `node janus/tests/grants_smoke.test.mjs` (uses `DATABASE_URL`) |
| RLS fails closed | `node janus/tests/rls_fails_closed.test.mjs` |
| View RLS enforced (security_invoker) | `node janus/tests/view_rls.test.mjs` |
| Reference data seeded (roles, rubric) | migration seeds `app_role` + `rubric 'default'`; verify `SELECT count(*) FROM app_role; SELECT count(*) FROM rubric;` |
| Partitions current | `node janus/scripts/manage-partitions.mjs --check` (postgres migrations URL) |
| Partition cron scheduled | `deploy/cloudsql/partition-cron.sh dev` |
| Backfill completed | `node worker/scripts/migrate-firestore-to-sql.mjs --export ...` |
| Outbox projector scheduled | Cloud Scheduler → `POST /api/internal/outbox/project` every minute |

## Stage 1 — dual (staging first)

```bash
gcloud run services update prep-portal-api \
  --set-secrets DATABASE_URL=janus-database-url-staging:latest \
  --set-env-vars PERSISTENCE_MODE=dual \
  --add-cloudsql-instances PROJECT:REGION:janus-pg-staging
```

Soak checks:
- `sync_outbox` pending count stays near zero: `SELECT count(*) FROM sync_outbox WHERE status='pending' AND next_retry_at < now() - interval '5 minutes';`
- No `failed` rows accumulating: `SELECT count(*) FROM sync_outbox WHERE status='failed';`
- Spot-check parity: a deal updated via the UI appears in both `deal` (SQL) and `deals` (Firestore) within a minute.

## Stage 2 — sql (staging, then prod)

```bash
gcloud run services update prep-portal-api --set-env-vars PERSISTENCE_MODE=sql
```

- Firestore writes stop; the outbox projector can be paused.
- Read-models: dashboards read `v_team_metrics` / `v_org_metrics` / `v_deal_traction` / `v_account_rollup` / `v_se_launchpad` (12_read_model_views.sql); the nightly Firestore read-model rebuild job is retired.
- Legacy localStorage/KV/file history reads stay retired (already complete per DOMAIN_MODEL.md).

## Rollback

- `dual` → `firestore`: flip the env flag; Firestore is still current via the projector.
- `sql` → `dual`: flip the flag and resume the projector. Only safe while the projector has been keeping Firestore in sync — after the projector is decommissioned, rollback requires a reverse backfill and is a deliberate operation, not a flag flip.

## Post-cutover cleanup (tracked separately)

- Decommission `web/domain/firestore-store.js` (already gated to local dev / explicit opt-in).
- Drop the `firestore_projection` integration row and retire the projector route.
- Remove `applyDomainWrite` legacy Firestore paths once all clients are on SQL-backed endpoints.
