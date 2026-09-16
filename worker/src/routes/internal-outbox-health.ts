/**
 * Dead-letter and backlog visibility for sync_outbox (P11 / J-021).
 *
 * GET /api/internal/outbox/health
 * Header: X-Cron-Secret: $INTERNAL_CRON_SECRET
 *
 * J-021 recorded 236 pending sync_outbox rows and a projector that is not
 * running. The reason nobody noticed is that there was NOTHING TO NOTICE with:
 * `sync_outbox` has no reader other than the projector itself, so a row that
 * fails permanently, or a backlog that stops draining, is invisible. The
 * projector's own reaper (the first statement of claim_outbox_batch, which
 * re-queues rows stuck in 'processing' for >10 minutes) only runs when the
 * projector runs, so a stalled projector cannot self-report either.
 *
 * This endpoint is that reader. It is deliberately a GET with no side effects
 * so an uptime check or alerting policy can poll it without mutating the queue
 * — the projector stays the only writer.
 *
 * READ THIS BEFORE ALERTING ON pending:
 * enqueueOutbox is called only from DualWriteRepository, so with
 * PERSISTENCE_MODE=sql (the shipped default) nothing is ever enqueued and the
 * queue is inert. The 236 rows are therefore a HISTORICAL backlog from an
 * earlier dual-write window, not a live one, and a pending alert would fire
 * once and never clear. `enqueue_active` reports whether the current mode can
 * enqueue at all, so an alert can distinguish "draining has stopped" from
 * "nothing enqueues here" instead of paging someone about neither.
 */

import type { Env } from "../env";
import { json } from "../http";
import { verifyInternalCronAuth } from "./internal-batch";
import { postgresReady } from "../data/persistence/postgres-pool";
import { withUnrestrictedSystemContext } from "../data/persistence/session-context";
import { resolvePersistenceMode } from "../data/persistence/types";

export interface OutboxHealth {
  /** Row counts by status, including statuses with zero rows. */
  counts: Record<string, number>;
  /** Age in seconds of the oldest row still waiting. Null when none. */
  oldestPendingAgeSeconds: number | null;
  /** Age in seconds of the oldest permanently-failed row. Null when none. */
  oldestFailedAgeSeconds: number | null;
  /**
   * Rows the reaper would re-queue on the next projector run (>10 minutes in
   * 'processing'). Non-zero here with a zero `completed` from the projector
   * means the projector is not running at all.
   */
  stuckProcessing: number;
  /** True when the deployed persistence mode can enqueue new rows. */
  enqueueActive: boolean;
  persistenceMode: string;
}

const STATUSES = ["pending", "processing", "completed", "failed"] as const;
/**
 * Matches the reaper threshold inside claim_outbox_batch, which keys off
 * last_attempted_at — sync_outbox has no claimed_at column. Keep the two in
 * step: a larger value here silently under-reports what the reaper will take.
 */
const REAPER_THRESHOLD = "10 minutes";

export async function readOutboxHealth(env: Env): Promise<OutboxHealth> {
  const mode = resolvePersistenceMode(env);
  return withUnrestrictedSystemContext(async (client) => {
    const counts = await client.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM sync_outbox GROUP BY status`,
    );
    const ages = await client.query<{
      oldest_pending: number | null;
      oldest_failed: number | null;
      stuck_processing: number;
    }>(
      `SELECT
         EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status = 'pending')))::int
           AS oldest_pending,
         EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status = 'failed')))::int
           AS oldest_failed,
         count(*) FILTER (
           WHERE status = 'processing'
             AND last_attempted_at < now() - INTERVAL '${REAPER_THRESHOLD}'
         )::int AS stuck_processing
       FROM sync_outbox`,
    );

    const byStatus: Record<string, number> = {};
    for (const s of STATUSES) byStatus[s] = 0;
    for (const row of counts.rows) byStatus[row.status] = Number(row.n);

    const a = ages.rows[0];
    return {
      counts: byStatus,
      oldestPendingAgeSeconds: a?.oldest_pending == null ? null : Number(a.oldest_pending),
      oldestFailedAgeSeconds: a?.oldest_failed == null ? null : Number(a.oldest_failed),
      stuckProcessing: Number(a?.stuck_processing ?? 0),
      // Only the dual-write repository enqueues, so sql mode never does.
      enqueueActive: mode === "dual",
      persistenceMode: mode,
    };
  }, env);
}

export async function handleOutboxHealthGet(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!verifyInternalCronAuth(request, env)) {
    return json({ error: "Unauthorized." }, 401, cors);
  }
  if (!postgresReady(env)) {
    return json({ error: "Outbox health requires DATABASE_URL." }, 503, cors);
  }
  try {
    return json({ ok: true, ...(await readOutboxHealth(env)) }, 200, cors);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Outbox health read failed." },
      500,
      cors,
    );
  }
}
