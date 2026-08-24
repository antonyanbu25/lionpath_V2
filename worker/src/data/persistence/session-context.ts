/**
 * RLS session context middleware — Blocker 2 / session-rls todo.
 *
 * Every RLS-scoped unit of work runs inside an explicit transaction with the
 * three session variables the DDL helpers read:
 *
 *   SET LOCAL app.user_id        -> current_user_id()
 *   SET LOCAL app.org_unit_path  -> current_org_path()
 *   SET LOCAL app.is_admin       -> is_admin()
 *
 * Why a transaction: PgBouncer transaction mode returns the server connection
 * to the pool after every statement; SET LOCAL only survives until COMMIT, so
 * the vars and the queries they guard must share one BEGIN ... COMMIT.
 *
 * Fail-closed contract (verified by janus/tests/rls_fails_closed.test.mjs):
 * missing vars must DENY. If orgUnitPath is unknown we pass NULL, and
 * current_org_path() (08_rls_hardening.sql) returns NULL, so org-path
 * policies match nothing.
 */

import type { PgClient, PgPool, PostgresEnv } from "./postgres-pool";
import { getPool } from "./postgres-pool";

export interface SqlSession {
  /** app_user.id (bigint) for the authenticated user. */
  userId: number;
  /** org_unit.path for the user's team/org, e.g. "/org_1/team_7/". */
  orgUnitPath: string | null;
  isAdmin: boolean;
}

/**
 * Resolve the SQL session for an authenticated request from the database
 * itself: Firebase UID -> user_identity -> app_user -> org_unit.path.
 * Returns null when the user has no SQL row yet (pre-migration) — callers
 * fall back to Firestore in dual mode.
 */
// Short-TTL per-process cache: resolveSqlSession ran a round-trip on every
// mutation. NEW-7 fix: TTL dropped from 60s to 5s — a revoked admin role or
// deactivated user must stop passing RLS within seconds, not a minute.
// Call invalidateSqlSession() on role/deactivation mutations for instant effect.
const SESSION_CACHE_TTL_MS = 5_000;
const sessionCache = new Map<string, { session: SqlSession | null; at: number }>();

/**
 * NEW-7 fix: drop the cached SQL session for a Firebase UID so the next
 * request re-resolves roles/status from the database. Call this after any
 * mutation to user_role or app_user.status for the target user.
 */
export function invalidateSqlSession(authUid: string): void {
  sessionCache.delete(authUid);
}

export async function resolveSqlSession(
  authUid: string,
  env?: PostgresEnv,
): Promise<SqlSession | null> {
  const cached = sessionCache.get(authUid);
  if (cached && Date.now() - cached.at < SESSION_CACHE_TTL_MS) return cached.session;
  const pool = await getPool(env);
  const r = await pool.query(
    `SELECT u.id AS user_id, u.org_unit_id, ou.path AS org_path,
            EXISTS (
              SELECT 1 FROM user_role ur JOIN app_role ar ON ar.id = ur.role_id
              WHERE ur.user_id = u.id AND ar.name = 'admin'
                AND ur.valid_from <= now()
                AND (ur.valid_to IS NULL OR ur.valid_to > now())
            ) AS is_admin
     FROM user_identity ui
     JOIN app_user u ON u.id = ui.user_id
     LEFT JOIN org_unit ou ON ou.id = u.org_unit_id
     WHERE ui.auth_provider = 'firebase' AND ui.auth_uid = $1
       AND u.status = 'active' AND u.deleted_at IS NULL`,
    [authUid],
  );
  const row = r.rows[0];
  if (!row) {
    sessionCache.set(authUid, { session: null, at: Date.now() });
    return null;
  }
  const session: SqlSession = {
    userId: Number(row.user_id),
    orgUnitPath: typeof row.org_path === "string" ? row.org_path : null,
    isAdmin: row.is_admin === true,
  };
  sessionCache.set(authUid, { session, at: Date.now() });
  return session;
}

/**
 * Run `fn` inside a transaction with RLS session vars applied.
 * The client is released back to the pool afterwards; never hold it.
 */
export async function withSessionContext<T>(
  session: SqlSession,
  fn: (client: PgClient) => Promise<T>,
  env?: PostgresEnv,
  poolOverride?: PgPool,
): Promise<T> {
  const pool = poolOverride ?? (await getPool(env));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // set_config(name, value, is_local=true) — parameterized; never interpolate
    // user input into SET statements.
    await client.query(
      `SELECT
         set_config('app.user_id', $1, true),
         set_config('app.org_unit_path', $2, true),
         set_config('app.is_admin', $3, true)`,
      [String(session.userId), session.orgUnitPath ?? "", session.isAdmin ? "true" : "false"],
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * System-context variant for internal jobs (outbox projector, read-model
 * rebuilds): runs as the usr_janus_ai sentinel with admin scope. Use only
 * from trusted server code paths — never from request handlers.
 *
 * M3 fix: renamed withSystemContext -> withUnrestrictedSystemContext so the
 * RLS bypass is explicit at every call site.
 */
export async function withUnrestrictedSystemContext<T>(
  fn: (client: PgClient) => Promise<T>,
  env?: PostgresEnv,
): Promise<T> {
  const pool = await getPool(env);
  const sentinel = await pool.query(
    `SELECT u.id AS user_id FROM app_user u WHERE u.public_id = 'usr_janus_ai'`,
  );
  const userId = sentinel.rows[0] ? Number(sentinel.rows[0].user_id) : 0;
  return withSessionContext(
    { userId, orgUnitPath: null, isAdmin: true },
    fn,
    env,
    pool,
  );
}

/** @deprecated Use withUnrestrictedSystemContext — the name makes the RLS bypass explicit. */
export const withSystemContext = withUnrestrictedSystemContext;
