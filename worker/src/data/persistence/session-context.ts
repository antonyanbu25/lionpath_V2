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
const LOGIN_WRITE_THROTTLE_MS = 5 * 60_000;
const loginWriteCache = new Map<number, number>();

/**
 * NEW-7 fix: drop the cached SQL session for a Firebase UID so the next
 * request re-resolves roles/status from the database. Call this after any
 * mutation to user_role or app_user.status for the target user.
 */
export function invalidateSqlSession(authUid: string): void {
  sessionCache.delete(authUid);
}

async function recordUsageLogin(
  pool: PgPool,
  userId: number,
  email: string | null | undefined,
): Promise<void> {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return;

  const now = Date.now();
  const lastWriteAt = loginWriteCache.get(userId) ?? 0;
  if (now - lastWriteAt < LOGIN_WRITE_THROTTLE_MS) return;
  loginWriteCache.set(userId, now);

  let client: PgClient | null = null;
  try {
    client = await connectWithRetry(pool);
    await client.query("BEGIN");
    await client.query(
      `SELECT
         set_config('app.user_id', $1, true),
         set_config('app.org_unit_path', '', true),
         set_config('app.is_admin', 'true', true),
         set_config('app.email', $2, true)`,
      [String(userId), normalized],
    );
    await client.query(
      `INSERT INTO user_usage_logins (user_id, email, source)
       VALUES ($1, $2, 'web')`,
      [userId, normalized],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client?.query("ROLLBACK").catch(() => undefined);
    loginWriteCache.delete(userId);
    console.warn(
      `[usage] could not record login for app_user ${userId}:`,
      err instanceof Error ? err.message : err,
    );
  } finally {
    client?.release();
  }
}

/**
 * Bind a verified Firebase uid to an existing app_user, by email.
 *
 * Why this exists: provision-identity.mjs deliberately does NOT write
 * user_identity, because auth_uid is only knowable once the person actually
 * signs in. Without this binding step resolveSqlSession returns null forever,
 * every caller falls through to Firestore, and dual mode is a no-op for
 * everybody however well the schema is built.
 *
 * Safe to key on email: it comes from a token verified against Google's JWKS
 * (verifyFirebaseToken) and is domain-checked against ALLOWED_EMAIL_DOMAIN
 * before this is ever reached. It is not client-claimed.
 *
 * Deliberately does NOT create the app_user. A person who is not on the
 * roster gets no SQL session and falls through to Firestore — provisioning is
 * an explicit act (D1), not a side effect of somebody signing in.
 *
 * Returns the app_user.id it bound to, or null.
 */
async function bindAuthIdentity(
  pool: PgPool,
  authUid: string,
  email: string,
): Promise<number | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const match = await pool.query(
    `SELECT id FROM app_user
      WHERE lower(email) = $1 AND status = 'active' AND deleted_at IS NULL`,
    [normalized],
  );
  if (!match.rowCount || match.rowCount === 0) return null;
  if (match.rowCount > 1) {
    // idx_app_user_email_active is UNIQUE where deleted_at IS NULL, so this
    // should be unreachable. If it happens, refuse rather than pick one.
    console.error(
      `[identity] ${normalized} matches ${match.rowCount} active app_user rows — refusing to bind.`,
    );
    return null;
  }
  const userId = Number(match.rows[0].id);

  // One firebase uid per person. A second, DIFFERENT uid for the same
  // app_user means either a re-created Firebase account or an impersonation
  // attempt; both need a human, so refuse and say so loudly.
  const existing = await pool.query(
    `SELECT auth_uid FROM user_identity
      WHERE user_id = $1 AND auth_provider = 'firebase'`,
    [userId],
  );
  const conflicting = existing.rows.find((r) => r.auth_uid !== authUid);
  if (conflicting) {
    console.error(
      `[identity] ${normalized} (app_user ${userId}) is already bound to firebase uid ` +
        `${conflicting.auth_uid} and signed in as ${authUid}. Refusing to add a second ` +
        `identity — resolve manually: either the Firebase account was re-created (delete ` +
        `the stale user_identity row) or this is an impersonation attempt.`,
    );
    return null;
  }

  const inserted = await pool.query(
    `INSERT INTO user_identity (user_id, auth_provider, auth_uid)
     VALUES ($1, 'firebase', $2)
     ON CONFLICT (auth_provider, auth_uid) DO NOTHING
     RETURNING id`,
    [userId, authUid],
  );

  if ((inserted.rowCount ?? 0) > 0) {
    console.info(`[identity] bound firebase uid ${authUid} to app_user ${userId} (${normalized})`);
    // First-login binding grants somebody a SQL session and therefore
    // visibility, so D7 wants it in the trail. Best-effort: a failure here
    // must never block a login.
    try {
      await pool.query(
        `INSERT INTO audit_log (user_id, entity_type, entity_id, action, payload, source)
         VALUES ($1, 'user_identity', $2, 'create', $3, 'system')`,
        [userId, String(userId),
         JSON.stringify({ auth_provider: "firebase", auth_uid: authUid, email: normalized })],
      );
    } catch (err) {
      console.warn(
        `[identity] could not audit the binding for app_user ${userId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return userId;
}

/**
 * Resolve a session by EMAIL, without touching user_identity.
 *
 * LOCAL DEV ONLY. The dev identity header claims an email; going through
 * bindAuthIdentity would try to attach a synthetic uid to a person who
 * already has a real Firebase one, and bindAuthIdentity correctly REFUSES
 * that — it cannot tell a dev header from an impersonation attempt.
 *
 * So the dev path skips binding entirely and resolves the app_user directly.
 * Nothing is written, so it cannot corrupt a real identity mapping.
 *
 * Never called when Firebase verification is enabled.
 */
export async function resolveSqlSessionByEmail(
  email: string,
  env?: PostgresEnv,
): Promise<SqlSession | null> {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  const pool = await getPool(env);
  const r = await pool.query(
    `SELECT u.id AS user_id, lower(u.email) AS email, u.org_unit_id, ou.path AS org_path,
            EXISTS (
              SELECT 1 FROM user_role ur JOIN app_role ar ON ar.id = ur.role_id
              WHERE ur.user_id = u.id AND ar.name = 'admin'
                AND ur.valid_from <= now()
                AND (ur.valid_to IS NULL OR ur.valid_to > now())
            ) AS is_admin
     FROM app_user u
     LEFT JOIN org_unit ou ON ou.id = u.org_unit_id
     WHERE lower(u.email) = $1 AND u.status = 'active' AND u.deleted_at IS NULL`,
    [normalized],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    userId: Number(row.user_id),
    orgUnitPath: typeof row.org_path === "string" ? row.org_path : null,
    isAdmin: row.is_admin === true,
  };
}

/**
 * @param email  the VERIFIED email from the Firebase token. When supplied and
 *               the uid has no user_identity row yet, the uid is bound to the
 *               matching app_user on the spot — see bindAuthIdentity. Omitting
 *               it preserves the old behaviour (null for an unbound uid).
 */
export async function resolveSqlSession(
  authUid: string,
  env?: PostgresEnv,
  email?: string | null,
): Promise<SqlSession | null> {
  const cached = sessionCache.get(authUid);
  if (cached && Date.now() - cached.at < SESSION_CACHE_TTL_MS) return cached.session;
  const pool = await getPool(env);
  const r = await pool.query(
    `SELECT u.id AS user_id, lower(u.email) AS email, u.org_unit_id, ou.path AS org_path,
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
  let row = r.rows[0];

  // No user_identity row for this uid. If we know the verified email, try to
  // bind it to the roster row once, then re-resolve.
  if (!row && email) {
    const boundUserId = await bindAuthIdentity(pool, authUid, email);
    if (boundUserId != null) {
      const again = await pool.query(
        `SELECT u.id AS user_id, lower(u.email) AS email, u.org_unit_id, ou.path AS org_path,
                EXISTS (
                  SELECT 1 FROM user_role ur JOIN app_role ar ON ar.id = ur.role_id
                  WHERE ur.user_id = u.id AND ar.name = 'admin'
                    AND ur.valid_from <= now()
                    AND (ur.valid_to IS NULL OR ur.valid_to > now())
                ) AS is_admin
         FROM app_user u
         LEFT JOIN org_unit ou ON ou.id = u.org_unit_id
         WHERE u.id = $1 AND u.status = 'active' AND u.deleted_at IS NULL`,
        [boundUserId],
      );
      row = again.rows[0];
    }
  }

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
  void recordUsageLogin(pool, session.userId, row.email);
  return session;
}

// Transient connection failures (stale cross-region socket, pool connect
// timeout) surface with these signatures. Acquiring a client has no side
// effects, so retrying pool.connect() is always safe — it can never
// double-apply a write. We do NOT retry once fn() has begun.
const TRANSIENT_CONNECT_RE =
  /timeout|terminated|reset|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EHOSTUNREACH/i;

async function connectWithRetry(pool: PgPool, attempts = 3): Promise<PgClient> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await pool.connect();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (i === attempts - 1 || !TRANSIENT_CONNECT_RE.test(msg)) throw err;
      console.warn(`[pg] transient connect failure (attempt ${i + 1}/${attempts}): ${msg} — retrying`);
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  throw lastErr;
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
  const client = await connectWithRetry(pool);
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
/**
 * Is this account writable by the session's user, per the account RLS predicate
 * `account_writable_by_current_user` (admin OR mapped in account_se_team OR no
 * mapping exists)?
 *
 * This MUST evaluate inside withSessionContext, and the reason is not obvious:
 * the predicate calls current_user_id(), which reads `app.user_id`. Establishing
 * that variable with set_config() in the SAME SELECT target list as the predicate
 * does NOT work — PostgreSQL does not guarantee target-list evaluation order, so
 * the predicate can observe NULL and deny a write the policy would have allowed.
 * set_config(..., is_local=true) is additionally discarded at statement end unless
 * an explicit transaction is open, which a bare pool.query() does not provide.
 *
 * Both failure modes are covered by janus/tests/account_writable_session.test.mjs.
 */
export async function accountWritableBySession(
  session: SqlSession,
  accountPublicId: string,
  env?: PostgresEnv,
  poolOverride?: PgPool,
): Promise<boolean> {
  return withSessionContext(
    session,
    async (client) => {
      const result = await client.query(
        `SELECT account_writable_by_current_user(resolve_internal_id('account', $1)) AS ok`,
        [accountPublicId],
      );
      return result.rows[0]?.ok === true;
    },
    env,
    poolOverride,
  );
}

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
