/**
 * Director-level analytics via BigQuery (optional — requires extension + credentials).
 */

import type { Env } from "../env";

export interface BigQueryEnv extends Pick<Env, "FIREBASE_PROJECT_ID" | "FIREBASE_SERVICE_ACCOUNT_JSON"> {
  BIGQUERY_PROJECT_ID?: string;
  BIGQUERY_DATASET?: string;
}

export function bigQueryConfigured(env: BigQueryEnv): boolean {
  const project = (env.BIGQUERY_PROJECT_ID || env.FIREBASE_PROJECT_ID || process.env.BIGQUERY_PROJECT_ID || "").trim();
  const dataset = (env.BIGQUERY_DATASET || process.env.BIGQUERY_DATASET || "lionpath_analytics").trim();
  const creds = (env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  return !!(project && dataset && creds);
}

export async function queryDirectorCallVolume(env: BigQueryEnv, days = 30): Promise<{ day: string; calls: number }[]> {
  if (!bigQueryConfigured(env)) {
    throw Object.assign(new Error("BigQuery not configured. See docs/BIGQUERY_EXPORT.md."), { status: 503 });
  }

  const projectId = (env.BIGQUERY_PROJECT_ID || env.FIREBASE_PROJECT_ID || process.env.BIGQUERY_PROJECT_ID || "").trim();
  const dataset = (env.BIGQUERY_DATASET || process.env.BIGQUERY_DATASET || "lionpath_analytics").trim();

  let BigQueryCtor: new (opts: { projectId: string }) => {
    query: (opts: { query: string; params: Record<string, unknown> }) => Promise<[unknown[]]>;
  };
  try {
    // Optional runtime dependency — install @google-cloud/bigquery when enabling director analytics.
    // @ts-expect-error optional package
    const mod = await import("@google-cloud/bigquery");
    BigQueryCtor = mod.BigQuery;
  } catch {
    throw Object.assign(
      new Error("Install @google-cloud/bigquery in worker for director analytics."),
      { status: 503 },
    );
  }

  const bq = new BigQueryCtor({ projectId });
  const sql = `
    SELECT
      DATE(TIMESTAMP_MILLIS(CAST(JSON_VALUE(data, '$.createdAt') AS INT64))) AS day,
      COUNT(*) AS calls
    FROM \`${projectId}.${dataset}.callSummaries_raw_*\`
    WHERE _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    GROUP BY day
    ORDER BY day DESC
    LIMIT @days
  `;

  const [rows] = await bq.query({ query: sql, params: { days } });
  return (rows as Array<{ day: { value: string } | string; calls: number }>).map((row) => ({
    day: typeof row.day === "object" && row.day && "value" in row.day ? row.day.value : String(row.day),
    calls: Number(row.calls || 0),
  }));
}
