/**
 * Fire-and-forget LLM usage records for admin cost dashboards.
 */

import type { LlmRequest, LlmUsage } from "../providers/types";
import { firestoreAdminReady, getDb, type FirestoreEnv } from "./firestore-admin";

export interface LlmUsageRecord extends LlmUsage {
  passName: string;
  userId: string;
  callId?: string;
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

/** Persist one usage row — never throws; never blocks the caller. */
export function recordLlmUsage(
  env: FirestoreEnv | undefined,
  record: Omit<LlmUsageRecord, "createdAt">,
): void {
  if (!record.userId?.trim()) return;
  if (!firestoreAdminReady(env)) return;

  void (async () => {
    try {
      const db = await getDb(env);
      await db.collection("llmUsage").add({
        callId: record.callId || null,
        userId: record.userId,
        passName: record.passName,
        model: record.model,
        promptTokens: record.promptTokens,
        outputTokens: record.outputTokens,
        cachedTokens: record.cachedTokens,
        groundingQueries: record.groundingQueries,
        latencyMs: record.latencyMs,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.warn("[llm-usage] write failed:", err instanceof Error ? err.message : err);
    }
  })();
}
