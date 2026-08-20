/**
 * PostgreSQL connection pool — Node runtime only (VPS / Cloud Run).
 *
 * Connects as janus_app via DATABASE_URL (Cloud SQL Auth Proxy or PgBouncer
 * on 127.0.0.1:6432 in production). Never point this at the postgres
 * superuser — the health check below refuses superuser connections.
 *
 * pg is imported dynamically (same pattern as firestore-admin.ts) so the
 * Cloudflare Workers bundle never tries to load a Node TCP driver.
 */

import { isNodeRuntime } from "../../video/capability";
import type { Env } from "../../env";

export type PgPool = import("pg").Pool;
export type PgClient = import("pg").PoolClient;

let pool: PgPool | null = null;
let poolPromise: Promise<PgPool> | null = null;

export interface PostgresEnv {
  DATABASE_URL?: string;
  PG_POOL_MAX?: string;
}

export function postgresReady(env?: PostgresEnv): boolean {
  if (!isNodeRuntime()) return false;
  const url = (env?.DATABASE_URL || process.env.DATABASE_URL || "").trim();
  return !!url;
}

export function assertPostgresAvailable(env?: PostgresEnv): void {
  if (!isNodeRuntime()) {
    throw Object.assign(new Error("PostgreSQL requires Node runtime (VPS or Cloud Run)."), {
      status: 503,
    });
  }
  if (!postgresReady(env)) {
    throw Object.assign(new Error("PostgreSQL not configured (set DATABASE_URL for janus_app)."), {
      status: 503,
    });
  }
  const url = env?.DATABASE_URL || process.env.DATABASE_URL || "";
  // Fail fast on the classic misconfiguration: worker running as superuser.
  if (/^postgres(ql)?:\/\/postgres[:@]/.test(url)) {
    throw Object.assign(
      new Error("DATABASE_URL must use the janus_app role, not the postgres superuser."),
      { status: 500 },
    );
  }
}

function pgPoolOptions(connectionString: string) {
  // SSL is driven by sslmode in the connection string, not a hardcoded IP.
  // rejectUnauthorized: false is the public-IP QA path only; production uses
  // the Auth Proxy / private IP with a proper CA (see pg-client-config.mjs).
  const wantsSsl = /sslmode=(require|verify-ca|verify-full|prefer)/i.test(connectionString);
  let cs = connectionString;
  if (wantsSsl && !/uselibpqcompat=/i.test(cs)) {
    cs += `${cs.includes("?") ? "&" : "?"}uselibpqcompat=true`;
  }
  return {
    connectionString: cs,
    ssl: wantsSsl ? ({ rejectUnauthorized: false } as const) : undefined,
  };
}

export async function getPool(env?: Env | PostgresEnv): Promise<PgPool> {
  assertPostgresAvailable(env);
  if (pool) return pool;
  if (poolPromise) return poolPromise;
  poolPromise = (async () => {
    const pg = await import("pg");
    const connectionString = env?.DATABASE_URL || process.env.DATABASE_URL || "";
    const maxRaw = (env as PostgresEnv)?.PG_POOL_MAX || process.env.PG_POOL_MAX || "10";
    const max = parseInt(maxRaw, 10);
    const instance = new pg.Pool({
      ...pgPoolOptions(connectionString),
      max: Number.isFinite(max) && max > 0 ? max : 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // PgBouncer transaction mode: no session state may leak between clients.
      // All RLS-scoped work goes through withSessionContext (BEGIN/COMMIT).
      allowExitOnIdle: false,
    });
    instance.on("error", (err: Error) => {
      console.error("postgres pool error:", err.message);
    });
    pool = instance;
    return instance;
  })();
  try {
    return await poolPromise;
  } finally {
    poolPromise = null;
  }
}

/** Test hook — dispose the singleton between test runs. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
