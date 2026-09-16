/**
 * Fire-and-forget LLM usage records for admin cost dashboards.
 *
 * Single chokepoint every LLM call site goes through. Two sinks, both
 * fire-and-forget, neither may throw back to the LLM call:
 *   1. Firestore `llmUsage` — legacy admin cost dashboards (dual-write window).
 *   2. PostgreSQL `ai_run` — cost-modelling system of record via insertAiRun.
 */

import type { LlmRequest, LlmUsage } from "../providers/types";
import { logWarn } from "../logger";
import { firestoreAdminReady, getDb, type FirestoreEnv } from "./firestore-admin";
import { checkPass7UsageAnomaly } from "./usage-anomaly";
import type { CostControlEnv } from "../cost-control-config";
import { estimateTokenCostUsd } from "../cost-rates";
import { aiRunRepository } from "./persistence/ai-run";
import type { PostgresEnv } from "./persistence/postgres-pool";
import { postgresReady } from "./persistence/postgres-pool";

export interface LlmUsageRecord extends LlmUsage {
  passName: string;
  /** Optional — unattributed calls are now recorded (sentinel/null attribution). */
  userId?: string;
  callId?: string;
  /** NULL on success; set on failed/billed runs captured on the failure path. */
  errorCode?: string | null;
  createdAt: number;
}

/** Optional context threaded from route handlers into pipeline LLM calls. */
export interface UsageTracking {
  userId?: string;
  callId?: string;
}

/** Merge route/pipeline usage context into an LLM request. */
export function withUsageTracking(req: LlmRequest, ctx?: UsageTracking): LlmRequest {
  if (!ctx?.userId && !ctx?.callId) return req;
  return {
    ...req,
    userId: req.userId ?? ctx?.userId,
    callId: req.callId ?? ctx?.callId,
  };
}

/**
 * Force usage attribution onto the VERIFIED session identity (P9 / J-019).
 *
 * PostCallClassifyInput.userId is documented "set by route handlers", but
 * handleAnalyzeCall used to discard requireUser's result and pass the request
 * body straight through. So ai_run.user_id was whatever the client chose to
 * send, or NULL when it sent nothing — which is most of why attribution sat at
 * 16.5%. It also meant a caller could bill its token spend to another user by
 * setting one field, the same "client value trusted as authority" shape as
 * J-025.
 *
 * Mutates in place and returns the same object, because callers pass the
 * already-parsed request body onward to the pipeline.
 *
 * `verified` is null in dummy-auth mode (no FIREBASE_PROJECT_ID), where there
 * is no verified identity to prefer and the client value is all there is. That
 * mode is guarded separately: node-server.ts hard-fails it under
 * NODE_ENV=production.
 */
export function stampVerifiedUsageIdentity<T extends { userId?: string }>(
  input: T,
  verified: { uid?: string } | null | undefined,
): T {
  const uid = verified?.uid?.trim();
  if (uid) input.userId = uid;
  return input;
}

type UsageEnv = FirestoreEnv & CostControlEnv & PostgresEnv;

/** Persist one usage row to both sinks — never throws; never blocks the caller. */
export function recordLlmUsage(
  env: UsageEnv | undefined,
  record: Omit<LlmUsageRecord, "createdAt">,
): void {
  const userId = record.userId?.trim() || undefined;
  const costUsd = estimateTokenCostUsd(record.model, {
    promptTokens: record.promptTokens,
    outputTokens: record.outputTokens,
    cachedTokens: record.cachedTokens,
  });

  if (postgresReady(env)) {
    void aiRunRepository.insert(env, {
      callId: record.callId ?? null,
      passName: record.passName,
      userId: userId ?? null,
      model: record.model,
      promptTokens: record.promptTokens,
      outputTokens: record.outputTokens,
      cachedTokens: record.cachedTokens,
      groundingQueries: record.groundingQueries,
      latencyMs: record.latencyMs,
      cacheHit: record.cacheHit === true,
      retryCount: record.retryCount ?? 0,
      costUsd,
      errorCode: record.errorCode ?? null,
    });
  }

  if (!firestoreAdminReady(env)) return;

  void (async () => {
    try {
      const db = await getDb(env);
      await db.collection("llmUsage").add({
        callId: record.callId || null,
        userId: userId ?? null,
        passName: record.passName,
        model: record.model,
        promptTokens: record.promptTokens,
        outputTokens: record.outputTokens,
        cachedTokens: record.cachedTokens,
        groundingQueries: record.groundingQueries,
        latencyMs: record.latencyMs,
        cacheHit: record.cacheHit === true,
        retryCount: record.retryCount ?? 0,
        costUsd,
        errorCode: record.errorCode ?? null,
        createdAt: Date.now(),
      });
      if (userId) {
        checkPass7UsageAnomaly(env, { ...record, userId });
      }
    } catch (err) {
      logWarn("[llm-usage] firestore write failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}
