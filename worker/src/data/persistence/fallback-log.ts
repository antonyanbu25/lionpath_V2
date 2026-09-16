/**
 * Firestore-fallback telemetry.
 *
 * trySqlDomainWrite has 26 places that return { handled: false }, and each one
 * silently routes the write to Firestore instead of Postgres. Nothing in the
 * log distinguishes "landed in Postgres" from "quietly did not" — which is the
 * blind spot that made the audits necessary, and which makes a cutover
 * unverifiable: you cannot switch Firestore off until you can prove nothing is
 * still falling back to it.
 *
 * Every fallback records a row in sql_fallback_log with a stable reason code.
 * janus/scripts/coverage-report.mjs reads it and answers one question: which
 * methods still are not reaching Postgres, and why.
 *
 * Three rules this module holds to:
 *
 *   1. It must never break the request it is describing. Every failure here is
 *      swallowed to a console warning.
 *   2. It must not need the caller's transaction. A fallback is logged from a
 *      request that is abandoning the SQL path, often after a failed
 *      transaction, so this opens its own connection.
 *   3. It always logs to the console too. If Postgres is the thing that is
 *      broken, the console line is the only record that survives.
 */

import type { PostgresEnv } from "./postgres-pool";
import { getPool } from "./postgres-pool";
import { resolvePersistenceMode } from "./types";
import { getCorrelationId } from "../../request-context";

/**
 * Why a write did not reach Postgres. A code, not a message — a fix is
 * verified by the code no longer appearing, which is checkable.
 *
 * Mirrors chk_sfl_reason in 30_fallback_telemetry.sql. Adding one here
 * without adding it there makes the insert fail (and get swallowed), so keep
 * the two in step.
 */
export type FallbackReason =
  | "postgres_not_configured"
  | "no_verified_user"
  | "no_sql_session"
  | "not_authorized"
  | "missing_required_field"
  | "shape_validation_failed"
  | "unmapped_parent"
  | "no_deal_or_lifecycle"
  | "deal_provision_failed"
  | "method_not_implemented"
  | "write_error";

export interface FallbackContext {
  method: string;
  reason: FallbackReason;
  /** The id that would not resolve, the shape key that failed — specifics. */
  detail?: string | null;
  /** The ACTOR — who made the request. */
  userPublicId?: string | null;
  entityPublicId?: string | null;
  /**
   * The call OWNER, when known. In a manager/admin proxy flow this differs from
   * userPublicId, and attributing a lost write to the actor would point at the
   * wrong person's data. Optional because several skip conditions fire before
   * the owner can be resolved — which is itself useful information.
   */
  ownerPublicId?: string | null;
  /**
   * Overrides the ambient per-request correlation id. Normally left unset:
   * logFallback reads getCorrelationId() so call sites do not have to thread it.
   */
  correlationId?: string | null;
}

/** Human-readable, so a console reader understands without the schema. */
const EXPLAIN: Record<FallbackReason, string> = {
  postgres_not_configured: "no DATABASE_URL, or the database is unreachable",
  no_verified_user: "the request carried no authenticated user",
  no_sql_session: "this person has no app_user/user_identity row — run provision-identity.mjs",
  not_authorized: "the app-layer permission check refused the SQL path",
  missing_required_field: "the document lacked an id, owner, account or org unit",
  shape_validation_failed: "the jsonb shape validator rejected the payload",
  unmapped_parent: "id_registry could not resolve a parent — the parent is not in Postgres",
  no_deal_or_lifecycle: "a prep brief with neither dealId nor lifecycleId cannot be tied to a deal",
  deal_provision_failed: "the placeholder deal could not be created",
  method_not_implemented: "no SQL path has been written for this method yet",
  write_error: "the SQL write threw",
};

/**
 * Record a fallback. Fire-and-forget by design — callers must not await this
 * on the request path, and must not let it change control flow.
 */
export function logFallback(ctx: FallbackContext, env?: PostgresEnv): void {
  const mode = resolvePersistenceMode(env as { PERSISTENCE_MODE?: string } | undefined);

  // A fallback in sql mode is not a fallback. There is no Firestore behind it,
  // so the write is LOST. That deserves a louder line than a warning.
  const lost = mode === "sql";
  const head = lost
    ? `[LOST WRITE] ${ctx.method}`
    : `[sql-fallback] ${ctx.method} -> Firestore`;

  // Read from the ambient request context so no call site has to thread it.
  // NOTE: request-context.ts holds this in a module-level variable rather than
  // AsyncLocalStorage, so under concurrent requests the id can be the wrong
  // one. Still recorded — a mostly-correct correlation id beats none — but see
  // the audit package: this wants AsyncLocalStorage before it can be trusted
  // for forensic attribution.
  const correlationId = ctx.correlationId ?? getCorrelationId() ?? null;

  const line =
    `${head}  reason=${ctx.reason}  (${EXPLAIN[ctx.reason]})` +
    (ctx.entityPublicId ? `  entity=${ctx.entityPublicId}` : "") +
    (ctx.userPublicId ? `  actor=${ctx.userPublicId}` : "") +
    (ctx.ownerPublicId ? `  owner=${ctx.ownerPublicId}` : "") +
    (correlationId ? `  correlationId=${correlationId}` : "") +
    (ctx.detail ? `  detail=${ctx.detail}` : "");

  if (lost) console.error(line);
  else console.warn(line);

  // Then try to persist it. Own connection, never the caller's transaction.
  void (async () => {
    try {
      const pool = await getPool(env);
      await pool.query(
        `SELECT log_sql_fallback($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          ctx.method,
          ctx.reason,
          ctx.detail ?? null,
          ctx.userPublicId ?? null,
          ctx.entityPublicId ?? null,
          mode,
          correlationId,
          ctx.ownerPublicId ?? null,
        ],
      );
    } catch (err) {
      // If Postgres is the thing that is broken, the console line above is the
      // record. Say so once and move on.
      console.warn(
        `[sql-fallback] could not persist telemetry for ${ctx.method}/${ctx.reason}:`,
        err instanceof Error ? err.message : err,
      );
    }
  })();
}

/**
 * Convenience for the write path: log, then return the shape
 * trySqlDomainWrite's switch expects. Keeps each fallback to one line at the
 * call site so instrumenting them all does not bury the logic.
 */
export function fallback(
  ctx: FallbackContext,
  env?: PostgresEnv,
): { handled: false } {
  logFallback(ctx, env);
  return { handled: false };
}
