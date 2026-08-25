/**
 * Pass 7 (summarise) usage anomaly detection.
 * Alerts when tokens-per-post-call exceed rolling p95 × multiplier (default 2×).
 */

import {
  costAlertWebhookUrl,
  percentile,
  summariseAnomalyBaselineDays,
  summariseAnomalyEnabled,
  summariseAnomalyMultiplier,
  type CostControlEnv,
} from "../cost-control-config";
import { logWarn } from "../logger";
import { firestoreAdminReady, getDb, getDoc, queryBy, setDoc, type FirestoreEnv } from "./firestore-admin";
import type { LlmUsageRecord } from "./llm-usage";

const PASS7_PASS_NAME = "summarise";
const BASELINE_DOC = "summarise";
const BASELINE_COLLECTION = "llmUsageBaselines";
const ALERT_COLLECTION = "costAlerts";

type AnomalyEnv = FirestoreEnv & CostControlEnv;

interface BaselineCache {
  p95TokensPerCall: number;
  sampleCount: number;
  refreshedAt: number;
}

let cachedBaseline: BaselineCache | null = null;
const BASELINE_TTL_MS = 6 * 60 * 60 * 1000;

function anomalyActive(env?: AnomalyEnv): boolean {
  return firestoreAdminReady(env) && summariseAnomalyEnabled(env);
}

async function computeSummariseP95(env: AnomalyEnv): Promise<BaselineCache> {
  const days = summariseAnomalyBaselineDays(env);
  const startMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const rows = await queryBy(
    "llmUsage",
    [
      { field: "passName", op: "==", value: PASS7_PASS_NAME },
      { field: "createdAt", op: ">=", value: startMs },
    ],
    { field: "createdAt", direction: "desc" },
    5000,
    env,
    ["callId", "promptTokens", "outputTokens"],
  );

  const byCall = new Map<string, number>();
  for (const row of rows) {
    const callId = typeof row.callId === "string" ? row.callId.trim() : "";
    if (!callId) continue;
    const tokens =
      (Number(row.promptTokens) || 0) + (Number(row.outputTokens) || 0);
    byCall.set(callId, (byCall.get(callId) || 0) + tokens);
  }

  const samples = [...byCall.values()].filter((n) => n > 0);
  const p95 = samples.length ? percentile(samples, 95) : 0;

  return {
    p95TokensPerCall: p95,
    sampleCount: samples.length,
    refreshedAt: Date.now(),
  };
}

async function getSummariseBaseline(env: AnomalyEnv): Promise<BaselineCache> {
  const now = Date.now();
  if (cachedBaseline && now - cachedBaseline.refreshedAt < BASELINE_TTL_MS) {
    return cachedBaseline;
  }

  try {
    const db = await getDb(env);
    const snap = await db.collection(BASELINE_COLLECTION).doc(BASELINE_DOC).get();
    const data = snap.data();
    const refreshedAt = Number(data?.refreshedAt) || 0;
    if (snap.exists && now - refreshedAt < BASELINE_TTL_MS) {
      cachedBaseline = {
        p95TokensPerCall: Number(data?.p95TokensPerCall) || 0,
        sampleCount: Number(data?.sampleCount) || 0,
        refreshedAt,
      };
      return cachedBaseline;
    }
  } catch {
    // fall through to recompute
  }

  const computed = await computeSummariseP95(env);
  cachedBaseline = computed;

  void setDoc(
    BASELINE_COLLECTION,
    BASELINE_DOC,
    {
      passName: PASS7_PASS_NAME,
      p95TokensPerCall: computed.p95TokensPerCall,
      sampleCount: computed.sampleCount,
      baselineDays: summariseAnomalyBaselineDays(env),
      refreshedAt: computed.refreshedAt,
    },
    env,
  ).catch((err) => {
    logWarn("[usage-anomaly] baseline persist failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return computed;
}

async function summariseTokensForCall(
  env: AnomalyEnv,
  callId: string,
): Promise<number> {
  const rows = await queryBy(
    "llmUsage",
    [
      { field: "callId", op: "==", value: callId },
      { field: "passName", op: "==", value: PASS7_PASS_NAME },
    ],
    undefined,
    20,
    env,
    ["promptTokens", "outputTokens"],
  );

  return rows.reduce(
    (sum, row) => sum + (Number(row.promptTokens) || 0) + (Number(row.outputTokens) || 0),
    0,
  );
}

async function postCostAlertWebhook(env: AnomalyEnv, payload: Record<string, unknown>): Promise<void> {
  const url = costAlertWebhookUrl(env);
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    logWarn("[usage-anomaly] webhook failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function emitSummariseAnomalyAlert(
  env: AnomalyEnv,
  params: {
    callId: string;
    userId: string;
    tokensTotal: number;
    p95Baseline: number;
    threshold: number;
    sampleCount: number;
  },
): Promise<void> {
  const alertId = `${params.callId}_summarise`;
  const existing = await getDoc(ALERT_COLLECTION, alertId, env);
  if (existing) return;

  const payload = {
    type: "summarise_usage_anomaly",
    passName: PASS7_PASS_NAME,
    callId: params.callId,
    userId: params.userId,
    tokensTotal: params.tokensTotal,
    p95Baseline: params.p95Baseline,
    threshold: params.threshold,
    multiplier: summariseAnomalyMultiplier(env),
    sampleCount: params.sampleCount,
    alertedAt: Date.now(),
  };

  logWarn("[cost-alert] Pass 7 summarise anomaly", {
    callId: params.callId,
    tokensTotal: params.tokensTotal,
    threshold: params.threshold,
    p95Baseline: params.p95Baseline,
  });

  await setDoc(ALERT_COLLECTION, alertId, { id: alertId, ...payload }, env);
  void postCostAlertWebhook(env, payload);
}

/**
 * Fire-and-forget check after a summarise usage row is written.
 * Requires callId on the usage record (post-call Pass 7).
 */
export function checkPass7UsageAnomaly(
  env: AnomalyEnv | undefined,
  record: Omit<LlmUsageRecord, "createdAt">,
): void {
  if (!anomalyActive(env)) return;
  if (record.passName !== PASS7_PASS_NAME) return;
  const callId = record.callId?.trim();
  const userId = record.userId?.trim();
  if (!callId || !userId) return;

  void (async () => {
    try {
      const baseline = await getSummariseBaseline(env!);
      if (baseline.sampleCount < 5 || baseline.p95TokensPerCall <= 0) {
        return;
      }

      const multiplier = summariseAnomalyMultiplier(env);
      const threshold = Math.round(baseline.p95TokensPerCall * multiplier);
      const tokensTotal = await summariseTokensForCall(env!, callId);

      if (tokensTotal <= threshold) return;

      await emitSummariseAnomalyAlert(env!, {
        callId,
        userId,
        tokensTotal,
        p95Baseline: baseline.p95TokensPerCall,
        threshold,
        sampleCount: baseline.sampleCount,
      });
    } catch (err) {
      logWarn("[usage-anomaly] check failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}

/** Test hook — reset in-memory baseline cache. */
export function resetSummariseBaselineCache(): void {
  cachedBaseline = null;
}
