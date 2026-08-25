# Cloud SQL Security — Janus QA Instance

**Instance:** `8.231.110.188:5432` · Database `janus` · Branch `feat/sql-foundation`

This document covers the **current QA posture** (public IP) and the **production target** (private VPC). Use it for boss escalation on VPC peering and for cutover checklists.

## Current QA setup (temporary)

| Setting | Value | Risk |
|---------|-------|------|
| Public IP | Enabled | Internet-reachable if authorized networks allow |
| Authorized networks | `0.0.0.0/0` | **Any IP can attempt connection** — mitigated by strong passwords + SSL |
| SSL | `sslmode=require` on connection strings | Encrypts traffic; does not replace network isolation |
| App role | `janus_app` (RLS-enforced) | Worker and API must never use `postgres` superuser |
| DDL role | `postgres` via `DATABASE_URL_MIGRATIONS` | Local/scripts only; never in Cloud Run worker env |

**QA-only rule:** Do not point production Cloud Run or customer data at this instance until VPC peering and private IP are in place.

## Roles and secrets

| Role | Used by | Stored in |
|------|---------|-----------|
| `postgres` | Schema apply, partition cron, one-off migrations | `DATABASE_URL_MIGRATIONS` in `worker/.dev.vars` (local) or GCP Secret `janus-database-url-migrations` |
| `janus_app` | Worker runtime, smoke tests, dual-write | `DATABASE_URL` in `worker/.dev.vars` or GCP Secret `janus-database-url-dev` |

Never commit connection strings. Edit `worker/.dev.vars` in the IDE with **single-quoted** URLs if the password contains `!`, `?`, `#`, or spaces.

Verify parsing without exposing secrets:

```bash
node worker/scripts/verify-db-env.mjs
```

## VPC peering blocker (production path)

Private Cloud SQL requires **VPC peering** via Service Networking. Provisioning failed with insufficient IAM:

- **Missing role:** `roles/servicenetworking.networksAdmin` (Service Networking Admin) on the service account used for Cloud SQL setup
- **Symptom:** Cannot allocate private IP range / establish peering to `servicenetworking.googleapis.com`

### Escalation template (for platform/GCP admin)

> We need Cloud SQL for Janus (Postgres 15) on project `[PROJECT_ID]`. Public IP is enabled for QA only. For production we require private IP with VPC peering. Please grant **Service Networking Admin** (`roles/servicenetworking.networksAdmin`) to `[SA_EMAIL]` or run the peering allocation for range `[CIDR]` in VPC `[VPC_NAME]`. Reference: [Cloud SQL private IP](https://cloud.google.com/sql/docs/postgres/configure-private-ip).

After peering:

1. Disable public IP (or restrict authorized networks to office/VPN CIDR only).
2. Point Cloud Run at **private IP** via VPC connector or Direct VPC egress.
3. Rotate `postgres` and `janus_app` passwords post-cutover.

## Application hardening (already in schema)

- Row-level security (RLS) on tenant-scoped tables — `janus_app` cannot bypass org boundaries.
- `grants_smoke.test.mjs` and `rls_fails_closed.test.mjs` must pass before dual-write.
- Worker `postgres-pool.ts` rejects `postgres` superuser in `DATABASE_URL`.

## Pre-cutover checklist

- [ ] VPC peering + private IP (or locked authorized networks)
- [ ] Secrets in GCP Secret Manager (not `.dev.vars` on server)
- [ ] DDL applied: `node worker/scripts/apply-janus-schema.mjs`
- [ ] Smoke tests pass as `janus_app`
- [ ] `PERSISTENCE_MODE=dual` soak with outbox projection
- [ ] Firewall: Cloud Run egress → Cloud SQL only on 5432

See also: [`CUTOVER_SQL.md`](./CUTOVER_SQL.md), [`adr/008-firestore-to-sql-decision.md`](./adr/008-firestore-to-sql-decision.md).
