#!/usr/bin/env node
/**
 * Recompute daily usage rows for yesterday and today, or for an explicit
 * date range when you need to pull a report for a different window --
 * this script is meant to be run manually whenever a report is needed, not
 * on a schedule.
 *
 * Usage:
 *   node worker/scripts/rollup-user-usage.mjs
 *   node worker/scripts/rollup-user-usage.mjs --from=2026-09-01 --to=2026-09-09
 *   node worker/scripts/rollup-user-usage.mjs --date=2026-09-05
 *
 * Uses DATABASE_URL as janus_app. The schema must already be applied.
 */

import { loadEnv } from "./lib/load-env.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";
import pg from "pg";

export function defaultUsageDates(now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterday = new Date(today);
  yesterday.setUTCDate(today.getUTCDate() - 1);
  return [yesterday.toISOString().slice(0, 10), today.toISOString().slice(0, 10)];
}

/** All YYYY-MM-DD dates from `from` to `to`, inclusive, both UTC. */
export function dateRange(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`Invalid date in range: from=${from} to=${to}`);
  }
  if (start > end) throw new Error(`--from (${from}) must not be after --to (${to})`);
  const dates = [];
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/** Parse --date=YYYY-MM-DD or --from=YYYY-MM-DD --to=YYYY-MM-DD from argv. Returns null if neither is given. */
export function parseCliDates(argv) {
  const flags = {};
  for (const arg of argv) {
    const m = /^--(\w+)=(.+)$/.exec(arg);
    if (m) flags[m[1]] = m[2];
  }
  if (flags.date) return [flags.date];
  if (flags.from || flags.to) {
    if (!flags.from || !flags.to) {
      throw new Error("Pass both --from and --to (or use --date=YYYY-MM-DD for a single day).");
    }
    return dateRange(flags.from, flags.to);
  }
  return null;
}

export const ROLLUP_USER_USAGE_SQL = `
WITH target_days AS (
  SELECT unnest($1::date[]) AS usage_date
),
post_counts AS (
  SELECT a.occurred_at::date AS usage_date, a.owner_user_id AS user_id, count(*)::int AS post_calls
  FROM post_call pc
  JOIN activity a ON a.id = pc.activity_id
  JOIN target_days d ON d.usage_date = a.occurred_at::date
  GROUP BY a.occurred_at::date, a.owner_user_id
),
pre_counts AS (
  SELECT a.occurred_at::date AS usage_date, a.owner_user_id AS user_id, count(*)::int AS pre_calls
  FROM pre_call pr
  JOIN activity a ON a.id = pr.activity_id
  JOIN target_days d ON d.usage_date = a.occurred_at::date
  GROUP BY a.occurred_at::date, a.owner_user_id
),
ai_counts AS (
  SELECT ar.created_at::date AS usage_date,
         ar.user_id,
         count(*)::int AS ai_runs,
         COALESCE(sum(ar.input_tokens), 0)::bigint AS input_tokens,
         COALESCE(sum(ar.output_tokens), 0)::bigint AS output_tokens,
         COALESCE(sum(ar.cost_usd), 0)::numeric(12,6) AS cost_usd
  FROM ai_run ar
  JOIN target_days d ON d.usage_date = ar.created_at::date
  WHERE ar.user_id IS NOT NULL
  GROUP BY ar.created_at::date, ar.user_id
),
score_counts AS (
  SELECT a.occurred_at::date AS usage_date,
         s.owner_user_id AS user_id,
         round(avg(s.composite_score)::numeric, 2)::numeric(4,2) AS avg_score
  FROM scorecard s
  JOIN activity a ON a.id = s.activity_id
  JOIN target_days d ON d.usage_date = a.occurred_at::date
  WHERE s.is_current = true
    AND s.owner_user_id IS NOT NULL
    AND s.composite_score IS NOT NULL
  GROUP BY a.occurred_at::date, s.owner_user_id
),
login_counts AS (
  SELECT l.logged_in_at::date AS usage_date,
         l.user_id,
         count(*)::int AS logins,
         min(l.logged_in_at) AS first_login_at,
         max(l.logged_in_at) AS last_login_at
  FROM user_usage_logins l
  JOIN target_days d ON d.usage_date = l.logged_in_at::date
  WHERE l.user_id IS NOT NULL
  GROUP BY l.logged_in_at::date, l.user_id
),
touched_users AS (
  SELECT usage_date, user_id FROM post_counts
  UNION
  SELECT usage_date, user_id FROM pre_counts
  UNION
  SELECT usage_date, user_id FROM ai_counts
  UNION
  SELECT usage_date, user_id FROM score_counts
  UNION
  SELECT usage_date, user_id FROM login_counts
),
rollup AS (
  SELECT tu.usage_date,
         u.id AS user_id,
         lower(u.email) AS email,
         COALESCE(pc.post_calls, 0) AS post_calls,
         COALESCE(pr.pre_calls, 0) AS pre_calls,
         COALESCE(ai.ai_runs, 0) AS ai_runs,
         COALESCE(ai.input_tokens, 0) AS input_tokens,
         COALESCE(ai.output_tokens, 0) AS output_tokens,
         COALESCE(ai.cost_usd, 0)::numeric(12,6) AS cost_usd,
         sc.avg_score,
         COALESCE(lc.logins, 0) AS logins,
         lc.first_login_at,
         lc.last_login_at
  FROM touched_users tu
  JOIN app_user u ON u.id = tu.user_id
  LEFT JOIN post_counts pc ON pc.usage_date = tu.usage_date AND pc.user_id = tu.user_id
  LEFT JOIN pre_counts pr ON pr.usage_date = tu.usage_date AND pr.user_id = tu.user_id
  LEFT JOIN ai_counts ai ON ai.usage_date = tu.usage_date AND ai.user_id = tu.user_id
  LEFT JOIN score_counts sc ON sc.usage_date = tu.usage_date AND sc.user_id = tu.user_id
  LEFT JOIN login_counts lc ON lc.usage_date = tu.usage_date AND lc.user_id = tu.user_id
)
INSERT INTO user_usage_daily (
  usage_date, user_id, email, post_calls, pre_calls, ai_runs,
  input_tokens, output_tokens, cost_usd, avg_score, logins,
  first_login_at, last_login_at, updated_at
)
SELECT usage_date, user_id, email, post_calls, pre_calls, ai_runs,
       input_tokens, output_tokens, cost_usd, avg_score, logins,
       first_login_at, last_login_at, now()
FROM rollup
ON CONFLICT (usage_date, user_id) DO UPDATE SET
  email = EXCLUDED.email,
  post_calls = EXCLUDED.post_calls,
  pre_calls = EXCLUDED.pre_calls,
  ai_runs = EXCLUDED.ai_runs,
  input_tokens = EXCLUDED.input_tokens,
  output_tokens = EXCLUDED.output_tokens,
  cost_usd = EXCLUDED.cost_usd,
  avg_score = EXCLUDED.avg_score,
  logins = EXCLUDED.logins,
  first_login_at = EXCLUDED.first_login_at,
  last_login_at = EXCLUDED.last_login_at,
  updated_at = now()
RETURNING usage_date, user_id, email, post_calls, pre_calls, ai_runs,
          input_tokens, output_tokens, cost_usd, avg_score, logins,
          first_login_at, last_login_at
`;

export async function rollupUserUsage(client, dates = defaultUsageDates()) {
  if (!Array.isArray(dates) || dates.length === 0) {
    throw new Error("rollupUserUsage requires at least one YYYY-MM-DD date.");
  }
  await client.query("BEGIN");
  try {
    await client.query(
      `SELECT
         set_config('app.user_id', '0', true),
         set_config('app.org_unit_path', '', true),
         set_config('app.is_admin', 'true', true)`,
    );
    await client.query("DELETE FROM user_usage_daily WHERE usage_date = ANY($1::date[])", [dates]);
    const result = await client.query(ROLLUP_USER_USAGE_SQL, [dates]);
    await client.query("COMMIT");
    return result.rows;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

export async function runCli() {
  loadEnv();
  const url = (process.env.DATABASE_URL || "").trim();
  if (!url) {
    console.error("Set DATABASE_URL for janus_app.");
    process.exit(1);
  }
  if (/^postgres(ql)?:\/\/postgres[:@]/i.test(url)) {
    console.error("DATABASE_URL must use janus_app, not the postgres superuser.");
    process.exit(1);
  }

  const pool = new pg.Pool(pgClientConfig(url));
  const client = await pool.connect();
  try {
    const dates = parseCliDates(process.argv.slice(2)) ?? defaultUsageDates();
    const rows = await rollupUserUsage(client, dates);
    console.log(`Rolled up ${rows.length} user_usage_daily rows for ${dates.join(", ")}.`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
