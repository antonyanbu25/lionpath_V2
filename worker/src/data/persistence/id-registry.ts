/**
 * id_registry helpers — public_id (Firestore-era string) <-> bigint PK.
 *
 * Resolution always happens inside the caller's transaction so a row insert
 * and its FK resolutions are atomic (Design A).
 */

import type { PgClient } from "./postgres-pool";
import { logWarn } from "../../logger";

export type EntityType =
  | "org_unit"
  | "app_user"
  | "account"
  | "contact"
  | "deal"
  | "task"
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

  // A REMAP, not an alias — and it ORPHANS the previous public_id (H4/J-034).
  //
  // id_registry is 1:1 by construction: uq_id_registry_internal is
  // UNIQUE (entity_type, internal_id), so one internal row can hold exactly one
  // public_id and a second public_id cannot be stored alongside the first. This
  // UPDATE is the workaround for that, and its cost is that the OLD public_id
  // stops resolving. Every later child write keyed on the old id then fails as
  // `unmapped_parent`, far away from the cause and with nothing linking the two.
  // Measured: after registering a second public_id, the first no longer
  // resolves — the hazard is severe enough that it broke the concurrency
  // suite's own shared fixture when first exercised.
  //
  // NOT changed here, deliberately. Both directions break something: keeping
  // the old mapping means the INCOMING public_id cannot resolve, so writes
  // keyed on it fail instead. Choosing between "silently invalidate existing
  // references" and "loudly reject the new id" is an identity-semantics
  // decision, and a real alias would need a migration to drop the unique
  // constraint (or a separate alias table) plus every resolve path taught to
  // handle more than one. Filed rather than guessed at.
  //
  // What IS changed: the remap is no longer silent. Previously the only
  // evidence was an unmapped_parent error later, in a different request.
  const before = await client.query<{ public_id: string }>(
    `SELECT public_id FROM id_registry WHERE entity_type = $1 AND internal_id = $2`,
    [entityType, internalId],
  );
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
  if ((moved.rowCount ?? 0) > 0) {
    const orphaned = before.rows[0]?.public_id;
    if (orphaned && orphaned !== publicId) {
      logWarn("[id-registry] public_id remapped — the previous id no longer resolves", {
        entityType,
        internalId,
        orphanedPublicId: orphaned,
        newPublicId: publicId,
      });
    }
    return;
  }

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
