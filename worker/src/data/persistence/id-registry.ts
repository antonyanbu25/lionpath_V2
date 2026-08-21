/**
 * id_registry helpers — public_id (Firestore-era string) <-> bigint PK.
 *
 * Resolution always happens inside the caller's transaction so a row insert
 * and its FK resolutions are atomic (Design A).
 */

import type { PgClient } from "./postgres-pool";

export type EntityType =
  | "org_unit"
  | "app_user"
  | "account"
  | "contact"
  | "deal"
  | "deal_contact"
  | "activity"
  | "pre_call"
  | "post_call"
  | "scorecard"
  | "product_signal";

/** Resolve a public_id to an internal bigint. Throws when unmapped — callers
 * must never guess an FK; an unmapped FK means the parent was not migrated. */
export async function resolveInternalId(
  client: PgClient,
  entityType: EntityType,
  publicId: string,
): Promise<number> {
  const r = await client.query(`SELECT resolve_internal_id($1, $2) AS id`, [entityType, publicId]);
  const id = r.rows[0]?.id;
  if (id == null) {
    throw Object.assign(
      new Error(`id_registry: no mapping for ${entityType}/${publicId} — migrate the parent first`),
      { status: 409 },
    );
  }
  return Number(id);
}

/** Register a mapping (idempotent). */
export async function registerId(
  client: PgClient,
  entityType: EntityType,
  publicId: string,
  internalId: number,
): Promise<void> {
  const existingPublicId = await client.query(
    `SELECT internal_id FROM id_registry
     WHERE entity_type = $1 AND public_id = $2`,
    [entityType, publicId],
  );
  if (existingPublicId.rows[0]) return;

  const moved = await client.query(
    `UPDATE id_registry
     SET public_id = $2
     WHERE entity_type = $1 AND internal_id = $3
       AND NOT EXISTS (
         SELECT 1 FROM id_registry
         WHERE entity_type = $1 AND public_id = $2
       )`,
    [entityType, publicId, internalId],
  );
  if ((moved.rowCount ?? 0) > 0) return;

  await client.query(`SELECT register_id($1, $2, $3)`, [entityType, publicId, internalId]);
}

/** Insert helper: run an INSERT ... ON CONFLICT (public_id) DO NOTHING
 * RETURNING id; on conflict, SELECT the existing id. Registers the mapping
 * either way. */
export async function upsertReturningId(
  client: PgClient,
  entityType: EntityType,
  table: string,
  insertSql: string,
  params: unknown[],
  publicId: string,
): Promise<number> {
  const r = await client.query(insertSql, params);
  let id = r.rows[0]?.id as number | string | undefined;
  if (id == null) {
    const existing = await client.query(`SELECT id FROM ${table} WHERE public_id = $1`, [publicId]);
    id = existing.rows[0]?.id;
  }
  if (id == null) {
    throw new Error(`upsertReturningId: ${table}/${publicId} returned no id`);
  }
  const num = Number(id);
  await registerId(client, entityType, publicId, num);
  return num;
}
