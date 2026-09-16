/**
 * Internal cron route — sync_outbox projection to Firestore (dual-write).
 *
 * POST /api/internal/outbox/project
 * Header: X-Cron-Secret: $INTERNAL_CRON_SECRET
 *
 * Claims a batch of pending sync_outbox rows (SKIP LOCKED) and applies them
 * to Firestore. Runs every minute during the dual-write window; safe to run
 * concurrently (claim_outbox_batch locks rows).
 */

import type { Env } from "../env";
import { json } from "../http";
import { verifyInternalCronAuth } from "./internal-batch";
import { postgresReady } from "../data/persistence/postgres-pool";
import { projectOutboxBatch } from "../data/persistence/outbox";
import { firestoreAdminReady } from "../data/firestore-admin";

export async function handleOutboxProjectPost(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!verifyInternalCronAuth(request, env)) {
    return json({ error: "Unauthorized." }, 401, cors);
  }
  if (!postgresReady(env) || !firestoreAdminReady(env)) {
    return json(
      { error: "Outbox projection requires DATABASE_URL and Firestore admin." },
      503,
      cors,
    );
  }
  try {
    const completed = await projectOutboxBatch(env, 50);
    return json({ ok: true, completed }, 200, cors);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Outbox projection failed." },
      500,
      cors,
    );
  }
}
