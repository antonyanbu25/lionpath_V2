/**
 * ai_run telemetry writes — cost modelling for every LLM call.
 *
 * Populated from the single chokepoint `recordLlmUsage`
 * (worker/src/data/llm-usage.ts). Every LLM call site (the central provider
 * wrapper in providers/index.ts, plus the direct-fetch paths in embeddings,
 * vision, transcript-infer, and the gemini-batch orchestrator) already calls
 * recordLlmUsage, so routing the SQL insert through that one function
 * captures every path without touching the call sites.
 *
 * Design notes:
 *   - The insert runs in its own short fire-and-forget transaction under
 *     withSystemContext (usr_janus_ai sentinel, admin scope). Usage is
 *     telemetry, not a domain row, so it must never participate in a caller's
 *     domain-write transaction and must never block or throw back to the LLM
 *     call. All errors are logged and swallowed.
 *   - run_type is best-effort: the real worker passName set (~15 free-text
 *     values) is wider than run_type_enum even after widening (10c), so the
 *     mapper returns NULL rather than guessing. ai_run.run_type is nullable
 *     (16_ai_run_telemetry.sql) and pass_name carries the original label.
 *   - activity_id is resolved from callId (a Firestore-era post_call/prep
 *     public_id) via id_registry as activity public_id `act_${callId}` when
 *     possible; resolution failure is NOT fatal — a NULL activity_id is
 *     better than a dropped cost row.
 *   - cost_usd is computed by the caller (llm-usage.ts wires cost-rates.ts)
 *     so this module stays free of rate-table concerns; insertAiRun just
 *     persists the value it is given.
 */

import type { PgClient } from "./postgres-pool";
import { withSessionContext } from "./session-context";
import { resolveInternalId } from "./id-registry";
import { getPool, type PostgresEnv } from "./postgres-pool";

/** Values accepted by ai_run.run_type (must match run_type_enum in 00/10c). */
export type RunType =
  | "pre_call"
  | "analysis"
  | "detail"
  | "scoring"
  | "signal_extract"
  | "embeddings"
  | "vision"
  | "transcript_infer"
  | "cluster_label"
  | "contact_enrich"
  | "research_cache"
  | "other";

/**
 * Best-effort mapping from the free-text worker `passName` to run_type_enum.
 * Returns NULL when no clean mapping exists — NEVER force a wrong value, the
 * enum constraint is non-negotiable. The original passName is preserved in
 * ai_run.pass_name so cost queries can group by the real label regardless.
 */
export function mapPassNameToRunType(passName: string | undefined): RunType | null {
  if (!passName) return null;
  const p = passName.trim().toLowerCase();
  if (!p) return null;

  if (p === "embeddings" || p === "embedding" || p.startsWith("embeddings")) return "embeddings";
  if (p === "video/vision" || p === "vision" || p.startsWith("video/vision")) return "vision";
  if (p === "video/summary-timeline" || p === "video/transcript-infer" || p.startsWith("video/transcript")) return "transcript_infer";
  if (p === "cluster-label" || p.startsWith("cluster-label")) return "cluster_label";
  if (p === "contact-enrich" || p === "contact/enrich" || p.startsWith("contact-enrich") || p.startsWith("contact/enrich")) return "contact_enrich";
  if (p === "research-cache" || p.startsWith("research-cache")) return "research_cache";

  if (
    p === "research" || p === "gap-research" || p === "company-news" ||
    p === "rivals" || p === "rivals-context" || p === "extract-facts" ||
    p === "linkedin-pdf" || p === "se-context-extract" || p === "demo-guidance" ||
    p === "demo-thesis" || p === "synthesize"
  ) {
    return "pre_call";
  }

  if (p === "analyze" || p === "classify" || p === "summarise" || p === "summaries" ||
    p === "linkedin-identity" || p === "deck-validate" || p === "mom" || p.startsWith("mom")) {
    return "analysis";
  }
  if (p === "arr-inputs" || p === "arr" || p.startsWith("arr-")) return "detail";
  if (p === "qualify" || p === "qualification") return "detail";
  if (p === "commit" || p === "technical-commit" || p.startsWith("commit")) return "detail";
  if (p === "gaps" || p === "product-gaps" || p.startsWith("gaps")) return "signal_extract";
  if (p === "speaker-attribution" || p.startsWith("speaker-attribution")) return "analysis";
  if (p === "scorecard" || p === "scorecard-verify" || p.startsWith("scorecard")) return "scoring";

  return null;
}

/** Row shape for an ai_run insert. cost_usd is precomputed by the caller. */
export interface AiRunRow {
  /** Firestore-era post_call/prep public_id, or NULL for unattributed calls. */
  callId?: string | null;
  /** Free-text pipeline pass label (the worker's passName). */
  passName: string;
  /** Resolved or sentinel app_user.id; NULL for fully-unattributed system calls. */
  userId?: string | null;
  model: string;
  promptTokens: number;
  outputTokens: number;
  cachedTokens: number;
  groundingQueries: number;
  latencyMs: number;
  cacheHit?: boolean;
  retryCount?: number;
  /** USD cost precomputed via cost-rates.ts (cached tokens at the cached rate). */
  costUsd?: number | null;
  /** NULL on success; an error_code_enum value on a failed/billed run. */
  errorCode?: string | null;
}

/**
 * Resolve a Firestore-era callId to the SQL activity.id via id_registry.
 * callId is the post_call/pre_call public_id; activity public_id is act_{callId}
 * (see routes.ts upsertPostCallWithSummary / createPrepBrief).
 * Returns NULL when absent or unmapped — never throws.
 */
async function resolveActivityId(client: PgClient, callId: string | null | undefined): Promise<number | null> {
  if (!callId) return null;
  const activityPublicId = callId.startsWith("act_") ? callId : `act_${callId}`;
  try {
    return await resolveInternalId(client, "activity", activityPublicId);
  } catch {
    return null;
  }
}

let cachedSentinelUserId: number | null = null;

async function getSentinelUserId(env: PostgresEnv | undefined): Promise<number> {
  if (cachedSentinelUserId != null) return cachedSentinelUserId;
  const pool = await getPool(env);
  const r = await pool.query(
    `SELECT u.id AS user_id FROM app_user u WHERE u.public_id = 'usr_janus_ai'`,
  );
  cachedSentinelUserId = r.rows[0] ? Number(r.rows[0].user_id) : 0;
  return cachedSentinelUserId;
}

/**
 * Insert one ai_run row inside its own short system-context transaction.
 * Never throws; never blocks the caller. Intended to be called fire-and-forget
 * from recordLlmUsage. Returns true on success, false on failure (logged).
 */
export async function insertAiRun(
  env: PostgresEnv | undefined,
  row: AiRunRow,
): Promise<boolean> {
  try {
    const sentinelUserId = await getSentinelUserId(env);
    const pool = await getPool(env);
    return await withSessionContext(
      { userId: sentinelUserId, orgUnitPath: null, isAdmin: true },
      async (client) => {
        const activityId = await resolveActivityId(client, row.callId);

        let userIdInternal: number | null = null;
        if (row.userId) {
          const r = await client.query(
            `SELECT ui.user_id FROM user_identity ui
             WHERE ui.auth_provider = 'firebase' AND ui.auth_uid = $1
             LIMIT 1`,
            [row.userId],
          );
          userIdInternal = r.rows[0] ? Number(r.rows[0].user_id) : null;
        }

        const runType = mapPassNameToRunType(row.passName);

        await client.query(
          `INSERT INTO ai_run
             (activity_id, run_type, pass_name, model,
              input_tokens, output_tokens, cached_tokens, grounding_queries,
              cache_hit, retry_count, user_id, cost_usd, latency_ms, error_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            activityId,
            runType,
            row.passName,
            row.model,
            row.promptTokens,
            row.outputTokens,
            row.cachedTokens,
            row.groundingQueries,
            row.cacheHit === true,
            row.retryCount ?? 0,
            userIdInternal,
            row.costUsd ?? null,
            row.latencyMs,
            row.errorCode ?? null,
          ],
        );
        return true;
      },
      env,
      pool,
    );
  } catch (err) {
    console.warn(
      "[ai-run] insert failed:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

export const aiRunRepository = {
  insert: insertAiRun,
};
