/**
 * Per-model USD rates for LLM usage cost estimates (admin dashboard).
 * Rates change — verify against Google's pricing page before updating:
 * https://ai.google.dev/gemini-api/docs/pricing
 */

export interface ModelRate {
  /** USD per 1M input/prompt tokens */
  promptPer1M: number;
  /** USD per 1M output/candidate tokens */
  outputPer1M: number;
  /** USD per 1M cached input tokens (when billed separately) */
  cachedPer1M?: number;
}

/** Normalized lookup keys — match effective model ids sent to APIs. */
export const MODEL_RATES: Record<string, ModelRate> = {
  "gemini-3.1-flash-lite": { promptPer1M: 0.075, outputPer1M: 0.3, cachedPer1M: 0.01875 },
  "gemini-3.5-flash": { promptPer1M: 0.15, outputPer1M: 0.6, cachedPer1M: 0.0375 },
  "gemini-3.6-flash": { promptPer1M: 0.15, outputPer1M: 0.6, cachedPer1M: 0.0375 },
  "text-embedding-004": { promptPer1M: 0.004, outputPer1M: 0 },
  "claude-sonnet-5": { promptPer1M: 3, outputPer1M: 15 },
};

const DEFAULT_RATE: ModelRate = { promptPer1M: 0.15, outputPer1M: 0.6 };

export function resolveModelRate(model: string): ModelRate {
  const key = (model || "").trim().toLowerCase();
  if (MODEL_RATES[key]) return MODEL_RATES[key];
  for (const [prefix, rate] of Object.entries(MODEL_RATES)) {
    if (key.startsWith(prefix)) return rate;
  }
  return DEFAULT_RATE;
}

export function estimateTokenCostUsd(
  model: string,
  tokens: { promptTokens: number; outputTokens: number; cachedTokens: number },
): number {
  const rate = resolveModelRate(model);
  const cachedRate = rate.cachedPer1M ?? rate.promptPer1M;
  const billablePrompt = Math.max(0, tokens.promptTokens - tokens.cachedTokens);
  return (
    (billablePrompt / 1_000_000) * rate.promptPer1M +
    (tokens.cachedTokens / 1_000_000) * cachedRate +
    (tokens.outputTokens / 1_000_000) * rate.outputPer1M
  );
}
