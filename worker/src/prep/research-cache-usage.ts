/**
 * Record a zero-token usage row when the 30-day research bundle cache skips playbook LLM calls.
 * Enables admin dashboards to measure cache hit rate for pilot cohorts re-running prep.
 */

import type { FirestoreEnv } from "../data/firestore-admin";
import { recordLlmUsage } from "../data/llm-usage";
import { resolveResearchModel } from "../providers/pass-models";
import type { ProviderEnv } from "../providers/types";

export function recordResearchCacheHit(
  env: (ProviderEnv & FirestoreEnv) | undefined,
  ctx: { userId?: string; callId?: string },
): void {
  recordLlmUsage(env, {
    userId: ctx.userId,
    callId: ctx.callId,
    passName: "research",
    model: resolveResearchModel(env || {}),
    promptTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    groundingQueries: 0,
    latencyMs: 0,
    cacheHit: true,
  });
}
