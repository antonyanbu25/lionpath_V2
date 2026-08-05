/**
 * Director analytics API — BigQuery when configured, Firestore read-models for operational path.
 */

import { requireUser } from "../auth";
import type { Env } from "../env";
import { json } from "../http";
import { isNodeRuntime } from "../video/capability";
import { bigQueryConfigured, queryDirectorCallVolume } from "../analytics/bigquery";

export async function handleDirectorAnalyticsGet(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isNodeRuntime()) {
    return json({ error: "Director analytics requires Node runtime." }, 503, cors);
  }

  const verified = await requireUser(request, env);
  if (!verified) {
    return json({ error: "Sign-in required." }, 401, cors);
  }

  if (!bigQueryConfigured(env)) {
    return json(
      {
        error: "BigQuery export not configured.",
        setup: "docs/BIGQUERY_EXPORT.md",
        operational: "Use Firestore read-models (teamMetrics/orgMetrics) for dashboards.",
      },
      503,
      cors,
    );
  }

  try {
    const volume = await queryDirectorCallVolume(env, 30);
    return json({ source: "bigquery", callVolumeByDay: volume }, 200, cors);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg, setup: "docs/BIGQUERY_EXPORT.md" }, 503, cors);
  }
}
