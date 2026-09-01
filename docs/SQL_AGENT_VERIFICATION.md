# SQL Agent Verification Runbook

**Audience:** AI agents, CI jobs, and developers verifying that data is **actually** written to Cloud SQL — not just that an HTTP request returned 200.

**GCP service:** [Cloud SQL for PostgreSQL 15](https://cloud.google.com/sql/docs/postgres) (QA instance public IP documented in [CLOUDSQL_SECURITY.md](./CLOUDSQL_SECURITY.md)).

---

## The problem this solves

Agents often conclude "SQL write succeeded" when:

1. **`PERSISTENCE_MODE` is `firestore`** (default) — SQL is never touched.
2. **`trySqlDomainWrite` returns `handled: false`** — the worker **silently falls back to Firestore** and still returns HTTP 200.
3. **`DATABASE_URL` is unset** — SQL tests **skip with exit 0**, looking green.
4. **Network to Cloud SQL is blocked** — `connect ETIMEDOUT`; the app still works via Firestore.
5. **RLS session vars are missing** — direct `SELECT` as `janus_app` returns 0 rows; agents think tables are empty.

> **Rule:** Never claim "data is in SQL" without a **post-write SQL query** or a **passing gate script** that connects to the database.

---

## Verification ladder (run in order)

| Step | Command | Pass means | Fail means |
|------|---------|------------|------------|
| **0. Env parsed** | `node worker/scripts/verify-db-env.mjs` | URLs parse; host/user visible (no secrets) | Missing `DATABASE_URL` / `DATABASE_URL_MIGRATIONS` |
| **1. Network + auth** | `node worker/scripts/verify-sql-network.mjs` | TCP + `SELECT 1` as `janus_app` | **ETIMEDOUT** = network blocked; auth error = bad password/SSL |
| **2. Grants** | `node janus/tests/grants_smoke.test.mjs` | `janus_app` can read/write allowed tables | Permission or connection failure |
| **3. RLS fails-closed** | `node janus/tests/rls_fails_closed.test.mjs` | Missing session vars deny access | RLS misconfigured |
| **4. Write proof** | `cd worker && npx tsx scripts/dual-write-soak.ts` | Real `INSERT` into `account` + `sync_outbox` | Write path broken |
| **5. Full gate** | `cd worker && npm run test:sql-gates` | All of the above + view RLS + `ai_run` insert + `tsc` | Any step failed |

**One-liner (after `.dev.vars` is set):**

```bash
node worker/scripts/verify-db-env.mjs && \
node worker/scripts/verify-sql-network.mjs && \
cd worker && npm run test:sql-gates
```

---

## Step 1 — Network to Cloud SQL (required)

### What must be true

| Requirement | Detail |
|-------------|--------|
| **Host reachable** | QA: `8.231.110.188:5432` (or your instance IP / Auth Proxy socket) |
| **Authorized network** | Cloud SQL instance must allow **your current public IP** (QA uses `0.0.0.0/0` but corporate firewalls may still block outbound 5432) |
| **SSL** | Connection string must include `sslmode=require` |
| **Credentials** | `janus_app` password in `DATABASE_URL` (runtime); `postgres` in `DATABASE_URL_MIGRATIONS` (DDL only) |

### Run the network gate

```bash
node worker/scripts/verify-sql-network.mjs
```

**Expected output when network works:**

```
[PASS] TCP 8.231.110.188:5432 reachable (…ms)
[PASS] PostgreSQL auth OK as janus_app@janus (…ms)
OK — Cloud SQL network + janus_app auth verified.
```

**Common failure: `connect ETIMEDOUT`**

The TCP probe failed — **no network path to Cloud SQL** from this machine/agent sandbox. The application may still appear healthy because it writes to Firestore.

Fix options:

1. **Add your IP** to Cloud SQL authorized networks (GCP Console → SQL → Connections).
2. **VPN** to office network if DB is restricted.
3. **Cloud SQL Auth Proxy** locally:
   ```bash
   cloud-sql-proxy PROJECT:REGION:INSTANCE --port 5432
   ```
   Then point `DATABASE_URL` at `127.0.0.1:5432`.
4. **Run verification from Cloud Run / GCE / Cloud Shell** inside GCP where the instance is reachable.
5. **Cursor/agent sandbox** may block outbound 5432 — run gates on your host terminal or CI with network access.

**Common failure: TCP OK but PostgreSQL auth fails**

Network is fine; fix password, `sslmode`, or role grants. Re-run `node worker/scripts/apply-janus-schema.mjs` if schema is missing.

---

## Step 2 — Persistence mode (required for app writes)

Even with network OK, the **worker does not write CRM data to SQL** unless:

```bash
PERSISTENCE_MODE=dual   # SQL primary + Firestore projection via sync_outbox
# or
PERSISTENCE_MODE=sql    # SQL only
```

Default is **`firestore`** — SQL path is skipped entirely.

Check in `worker/.dev.vars` or Cloud Run env. `verify-sql-network.mjs` prints a **WARN** when mode is still `firestore`.

---

## Step 3 — Why HTTP 200 ≠ SQL write

`/api/domain-write` flow (`worker/src/routes.ts`):

1. `trySqlDomainWrite(...)` — attempts Postgres inside RLS transaction.
2. If `handled: false` → **`applyDomainWrite`** (Firestore) — still returns 200.

`handled: false` when:

- `PERSISTENCE_MODE` is `firestore`
- `DATABASE_URL` unset / pool unavailable
- No SQL session (`resolveSqlSession` null — user missing from `user_identity` / `app_user`)
- Authz check fails for unscoped tables (falls through to Firestore)
- Pre-migration user (console: `domain-write: no SQL session for uid`)

**Agent proof after an API write:**

```sql
-- Replace with the public_id from the write
SELECT public_id, name, updated_at FROM account WHERE public_id = '<id>';

-- dual mode: outbox row should exist
SELECT entity_type, entity_id, status, created_at
FROM sync_outbox WHERE entity_id = '<id>' ORDER BY id DESC LIMIT 3;
```

If SQL returns 0 rows but Firestore has the doc → **fallback happened**.

---

## Step 4 — RLS and session context (required for reads)

The worker connects as **`janus_app`** with Row-Level Security. Ad-hoc queries must set session vars inside a transaction:

```sql
BEGIN;
SELECT set_config('app.is_admin', 'true', true);
SELECT set_config('app.user_id', '', true);
SELECT set_config('app.org_unit_path', '', true);
SELECT count(*) FROM account;
COMMIT;
```

Without this, agents see **empty tables** even when data exists.

For writes in tests/scripts, use `withSessionContext` or `withUnrestrictedSystemContext` from `worker/src/data/persistence/session-context.ts`.

---

## Step 5 — Prerequisites checklist

Before claiming dual-write or SQL cutover works:

| Gate | Verify |
|------|--------|
| Cloud SQL instance + `janus` DB | GCP Console or `verify-sql-network.mjs` |
| Schema phases 00–18 applied | `node worker/scripts/apply-janus-schema.mjs` |
| `id_registry` backfilled (migrated DBs) | phase `15_id_registry_backfill.sql` |
| `user_identity` populated for test users | `resolveSqlSession` needs Firebase UID → `app_user` |
| `PERSISTENCE_MODE=dual` on worker | env var |
| Outbox projector running (dual mode) | `POST /api/internal/outbox/project` cron |
| Reference seeds | `app_role`, `rubric` (see [SQL_QA_VALIDATION.md](./SQL_QA_VALIDATION.md) #12–#13) |

Full cutover gates: [CUTOVER_SQL.md](./CUTOVER_SQL.md).

---

## What writes to which table

| Feature | SQL tables | Notes |
|---------|------------|-------|
| CRM domain writes | `account`, `contact`, `deal`, `activity`, `pre_call`, `post_call` | Needs `PERSISTENCE_MODE` + SQL session |
| Dual-write projection | `sync_outbox` → Firestore | Same transaction as SQL write |
| LLM cost | `ai_run` (+ Firestore `llmUsage`) | `insertAiRun`; needs `activity` FK + schema 16/18 |
| Read models | `v_team_metrics`, `v_deal_traction`, etc. | View RLS enforced |

---

## Agent do / don't

| Do | Don't |
|----|-------|
| Run `verify-sql-network.mjs` first | Assume `.dev.vars` exists without checking |
| Fail closed when `DATABASE_URL` unset (`verify-sql-network` without `--allow-skip`) | Treat skipped SQL tests as pass |
| Query SQL after writes with known `public_id` | Trust HTTP 200 alone |
| Check `PERSISTENCE_MODE` | Assume default `firestore` writes SQL |
| Read server logs for `Firestore fallback` / `no SQL session` | Ignore silent fallback |
| Use `npm run test:sql-gates` before claiming SQL works | Run only `tsc` |

---

## Environment template (`worker/.dev.vars`)

```bash
# Single-quoted URLs if password contains ! # ? &
DATABASE_URL_MIGRATIONS='postgresql://postgres:PASSWORD@8.231.110.188:5432/janus?sslmode=require'
DATABASE_URL='postgresql://janus_app:PASSWORD@8.231.110.188:5432/janus?sslmode=require'
PERSISTENCE_MODE=dual
```

Copy from [worker/.dev.vars.example](../worker/.dev.vars.example). Never commit real passwords.

---

## Related docs

- [CLOUDSQL_SECURITY.md](./CLOUDSQL_SECURITY.md) — instance posture, roles, VPC peering
- [CUTOVER_SQL.md](./CUTOVER_SQL.md) — `firestore` → `dual` → `sql` stages
- [SQL_QA_VALIDATION.md](./SQL_QA_VALIDATION.md) — silent no-op failure modes (#12–#15)
- [SQL_BUILD_PLAN.md](./SQL_BUILD_PLAN.md) — schema and persistence architecture
