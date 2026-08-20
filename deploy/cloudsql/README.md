# Cloud SQL for Janus (PostgreSQL system of record)

Target architecture per [docs/adr/008-firestore-to-sql-decision.md](../../docs/adr/008-firestore-to-sql-decision.md).

## Components

| Piece | What |
|-------|------|
| Cloud SQL Postgres 15 | System of record; schema from `janus/schema/init_all.sql` |
| Cloud SQL Auth Proxy | Sidecar / local connector; TLS + IAM without managing certs |
| PgBouncer | Transaction-mode pooler (`pgbouncer.ini`) between worker and proxy |
| Secret Manager | `janus-database-url-{env}` holds the `janus_app` DATABASE_URL |

## Roles (created by DDL, passwords managed here)

| Role | LOGIN | Used by |
|------|-------|---------|
| `postgres` | yes | Migrations only (`init_all.sql`) |
| `janus_app` | yes | Worker runtime — RLS enforced |
| `janus_redactor` | no | PII redaction job (`redact_pii()`) |
| `janus_readonly` | no | Reporting / BI |

The DDL seeds `janus_app` with placeholder password `janus_app_password`.
**Always rotate it** (`provision.sh` does this) before pointing any worker at
the database. Never connect the worker as `postgres`.

## Setup order

```bash
export PROJECT_ID=se-singha-paathi REGION=us-central1
./provision.sh dev                 # instance + db + secret

gcloud sql connect janus-pg-dev --user=postgres
\i janus/schema/init_all.sql       # phases 00-06 + 07 grants + 08 RLS + 09 ids + 10 shapes

./provision.sh dev                 # second run rotates janus_app password
```

## Worker wiring (Cloud Run)

```
--add-cloudsql-instances PROJECT:REGION:janus-pg-dev
--set-secrets DATABASE_URL=janus-database-url-dev:latest
--set-env-vars PERSISTENCE_MODE=dual
```

The worker connects as `janus_app` through PgBouncer (transaction mode). Every
RLS-scoped request runs inside `BEGIN; SET LOCAL app.user_id=...;
SET LOCAL app.org_unit_path=...; SET LOCAL app.is_admin=...; ... COMMIT;`
— see `worker/src/data/persistence/session-context.ts`.

## Verification gates

1. `janus/tests/grants_smoke.test.mjs` — `janus_app` can SELECT/INSERT.
2. `janus/tests/rls_fails_closed.test.mjs` — missing session vars deny, not permit.
3. `janus/scripts/manage-partitions.mjs --check` — next-period partitions exist.
