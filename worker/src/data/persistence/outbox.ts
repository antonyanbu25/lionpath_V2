/**
 * OutboxProjector — Design B: SQL-primary dual-write.
 *
 * The worker never writes Firestore and Postgres independently. Business rows
 * land in Postgres inside the request transaction together with a sync_outbox
 * row; this projector claims pending rows (claim_outbox_batch, SKIP LOCKED)
 * and applies them to Firestore so legacy readers keep working during the
 * transition.
 *
 * Failure semantics: a failed projection leaves the row 'processing' until
 * next_retry_at passes; the next claim re-attempts. After MAX_ATTEMPTS the
 * row is marked 'failed' for manual triage — never silently dropped.
 */

import { getPool, type PostgresEnv } from "./postgres-pool";
import { getDb, type FirestoreEnv } from "../firestore-admin";

const MAX_ATTEMPTS = 8;
const FIRESTORE_INTEGRATION_PUBLIC_ID = "int_firestore_projection";

interface OutboxClaim {
  outbox_id: number;
  entity_type: string;
  entity_id: string;
  integration_id: number;
  operation: "create" | "update" | "delete";
  payload: Record<string, unknown>;
  attempts: number;
}

/** Firestore collection per entity_type for the projection. */
const COLLECTION_BY_ENTITY: Record<string, string> = {
  account: "accounts",
  contact: "contacts",
  deal: "deals",
  deal_contact: "dealContacts",
  activity: "activities",
  pre_call: "prepBriefs",
  post_call: "postCalls",
  scorecard: "scorecards",
  product_signal: "productGaps",
};

async function applyToFirestore(
  claim: OutboxClaim,
  env: FirestoreEnv,
): Promise<void> {
  const collection = COLLECTION_BY_ENTITY[claim.entity_type];
  if (!collection) {
    throw new Error(`outbox: no Firestore collection mapped for entity_type=${claim.entity_type}`);
  }
  const db = await getDb(env);
  const ref = db.collection(collection).doc(String(claim.entity_id));
  if (claim.operation === "delete") {
    await ref.delete();
    return;
  }
  await ref.set({ ...claim.payload, id: claim.entity_id }, { merge: true });
}

/**
 * Claim and project one batch. Returns the number of rows completed.
 * Intended to be called on a loop from an internal cron route.
 */
export async function projectOutboxBatch(
  env: PostgresEnv & FirestoreEnv,
  limit = 20,
): Promise<number> {
  const pool = await getPool(env);
  const client = await pool.connect();
  let claims: OutboxClaim[] = [];
  try {
    const r = await client.query(`SELECT * FROM claim_outbox_batch($1)`, [limit]);
    claims = r.rows as OutboxClaim[];
  } finally {
    client.release();
  }

  let completed = 0;
  for (const claim of claims) {
    try {
      await applyToFirestore(claim, env);
      await pool.query(`UPDATE sync_outbox SET status = 'completed' WHERE id = $1`, [
        claim.outbox_id,
      ]);
      completed++;
    } catch (err) {
      // claim_outbox_batch already incremented attempts; use it as-is (QA #9).
      const attempts = claim.attempts;
      const failed = attempts >= MAX_ATTEMPTS;
      const backoffMs = Math.min(2 ** attempts * 1000, 30 * 60 * 1000);
      await pool.query(
        `UPDATE sync_outbox
         SET status = $2,
             next_retry_at = now() + ($3 || ' milliseconds')::interval
         WHERE id = $1`,
        [claim.outbox_id, failed ? "failed" : "pending", String(backoffMs)],
      );
      console.error(
        `outbox projection failed id=${claim.outbox_id} entity=${claim.entity_type}/${claim.entity_id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return completed;
}

/** Resolve the integration.id for the Firestore projection row (seeded by
 * 11_deal_contact.sql). Cached per process. */
let firestoreIntegrationId: number | null = null;

export async function getFirestoreProjectionIntegrationId(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
): Promise<number> {
  if (firestoreIntegrationId != null) return firestoreIntegrationId;
  const r = await client.query(`SELECT id FROM integration WHERE public_id = $1`, [
    FIRESTORE_INTEGRATION_PUBLIC_ID,
  ]);
  const id = r.rows[0]?.id;
  if (id == null) {
    throw new Error(
      `integration row ${FIRESTORE_INTEGRATION_PUBLIC_ID} missing — run janus/schema/11_deal_contact.sql`,
    );
  }
  firestoreIntegrationId = Number(id);
  return firestoreIntegrationId;
}
