/**
 * Internal cron route — daily user-usage rollup (P11 / J-023).
 *
 * POST /api/internal/usage/rollup
 * Header: X-Cron-Secret: $INTERNAL_CRON_SECRET
 * Body (optional): { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
 *
 * J-023 recorded user_usage_daily holding 2 rows against 172 login events.
 * The rollup itself is correct — worker/scripts/rollup-user-usage.mjs works and
 * is idempotent. It was simply invoked by nothing: it exists only as a CLI, and
 * a CLI needs somebody to be at a terminal.
 *
 * This route is the missing invocation surface. It reuses the script's exported
 * rollupUserUsage rather than re-implementing the SQL, so the scheduled path
 * and the manual path cannot drift — a second copy of an aggregation query is
 * exactly how you get two different answers to "how much did we use".
 *
 * Idempotent: the rollup DELETEs the requested dates and recomputes them
 * inside one transaction, so re-running a day replaces it rather than
 * double-counting. Safe to retry.
 *
 * Defaults to the range the script defaults to (the last complete day plus
 * today), so the common case needs no body at all.
 */

import type { Env } from "../env";
import { json } from "../http";
import { verifyInternalCronAuth } from "./internal-batch";
import { getPool, postgresReady } from "../data/persistence/postgres-pool";
import { isNodeRuntime } from "../video/capability";

/** ISO calendar date, as the rollup's date columns expect. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleUsageRollupPost(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!verifyInternalCronAuth(request, env)) {
    return json({ error: "Unauthorized." }, 401, cors);
  }
  if (!postgresReady(env)) {
    return json({ error: "Usage rollup requires DATABASE_URL." }, 503, cors);
  }
  // Same gate the other internal cron routes use: the rollup reaches the
  // filesystem through scripts/lib/load-env.mjs, so it is Node-only.
  if (!isNodeRuntime()) {
    return json({ error: "Usage rollup requires the Node runtime." }, 503, cors);
  }

  // Imported lazily, and from scripts/ rather than src/, on purpose. The
  // README documents `node worker/scripts/rollup-user-usage.mjs` and
  // scripts/test-user-usage.mjs imports it under bare node, so the logic
  // cannot move into a .ts module without breaking both. Types come from the
  // hand-written rollup-user-usage.d.mts alongside it.
  //
  // If a `wrangler deploy` ever fails resolving this, that is why: the edge
  // build has no scripts/ directory. The isNodeRuntime gate above means the
  // call is unreachable there, so the fix is to exclude it from that bundle,
  // not to duplicate the SQL.
  const { rollupUserUsage, defaultUsageDates, dateRange } = await import(
    "../../scripts/rollup-user-usage.mjs"
  );

  let dates: string[];
  try {
    const body = (await request.json().catch(() => ({}))) as { from?: string; to?: string };
    if (body.from || body.to) {
      // Both or neither — a one-sided range is far more likely to be a caller
      // bug than an intent to roll up a single open-ended span.
      if (!body.from || !body.to) {
        return json({ error: "Provide both from and to, or neither." }, 400, cors);
      }
      if (!ISO_DATE.test(body.from) || !ISO_DATE.test(body.to)) {
        return json({ error: "from and to must be YYYY-MM-DD." }, 400, cors);
      }
      if (body.from > body.to) {
        return json({ error: "from must not be after to." }, 400, cors);
      }
      dates = dateRange(body.from, body.to);
      // A scheduled job asking for an unbounded backfill is a mistake worth
      // refusing rather than discovering as a long-running transaction.
      if (dates.length > 92) {
        return json(
          { error: `range too large (${dates.length} days, max 92). Backfill in chunks.` },
          400,
          cors,
        );
      }
    } else {
      dates = defaultUsageDates();
    }
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Invalid request body." },
      400,
      cors,
    );
  }

  // Deliberately a raw pooled client, NOT withUnrestrictedSystemContext:
  // rollupUserUsage opens its own BEGIN/COMMIT and sets its own app.* session
  // variables. Wrapping it would nest a transaction inside the helper's, and
  // the script's COMMIT would then commit the OUTER transaction — so a later
  // failure could no longer roll back what the rollup had already written.
  // Let the script own its transaction; just hand it a connection.
  try {
    const pool = await getPool(env);
    const client = await pool.connect();
    let rows: unknown[];
    try {
      rows = await rollupUserUsage(client, dates);
    } finally {
      client.release();
    }
    return json({ ok: true, dates, days: dates.length, users: rows.length }, 200, cors);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Usage rollup failed." },
      500,
      cors,
    );
  }
}
