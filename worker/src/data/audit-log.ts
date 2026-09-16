/**
 * Audit log insert helper — writes assume-identity events to the SQL
 * audit_log table (partitioned, append-only, REVOKE UPDATE/DELETE).
 */

import { withSystemContext } from "./persistence/session-context";
import { getPool, postgresReady, type PostgresEnv } from "./persistence/postgres-pool";

export interface AuditLogEntry {
  /** The actor's app_user.id (the admin, not the target). */
  userId: number;
  entityType: string;
  entityId: string;
  action: "create" | "update" | "delete" | "anonymize" | "override" | "merge";
  payload: Record<string, unknown>;
}

export async function insertAuditLog(
  env: PostgresEnv | undefined,
  entry: AuditLogEntry,
): Promise<boolean> {
  if (!postgresReady(env)) return false;
  try {
    return await withSystemContext(async (client) => {
      await client.query(
        `INSERT INTO audit_log (user_id, entity_type, entity_id, action, payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          entry.userId,
          entry.entityType,
          entry.entityId,
          entry.action,
          JSON.stringify(entry.payload),
        ],
      );
      return true;
    }, env);
  } catch (err) {
    console.error(
      "[audit-log] insert failed:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

export async function resolveAppUserIdFromAuthUid(
  authUid: string,
  env: PostgresEnv | undefined,
): Promise<number | null> {
  if (!postgresReady(env)) return null;
  try {
    const pool = await getPool(env);
    const r = await pool.query(
      `SELECT ui.user_id FROM user_identity ui
       WHERE ui.auth_provider = 'firebase' AND ui.auth_uid = $1
       LIMIT 1`,
      [authUid],
    );
    return r.rows[0] ? Number(r.rows[0].user_id) : null;
  } catch {
    return null;
  }
}
