/**
 * Cost control env parsing — shared by token budget and usage anomaly modules.
 */

export interface CostControlEnv {
  DAILY_TOKEN_BUDGET_ENABLED?: string;
  DAILY_TOKEN_BUDGET_PER_USER?: string;
  /** Tokens reserved per LLM call before the provider runs (parallel-pass guard). */
  DAILY_TOKEN_BUDGET_RESERVE?: string;
  SUMMARISE_ANOMALY_ENABLED?: string;
  /** Alert when Pass 7 tokens-per-call exceed rolling p95 × this multiplier. */
  SUMMARISE_ANOMALY_MULTIPLIER?: string;
  /** Days of summarise usage used to compute rolling p95 baseline. */
  SUMMARISE_ANOMALY_BASELINE_DAYS?: string;
  /** Optional webhook (Slack/PagerDuty) for cost alerts — POST JSON body. */
  COST_ALERT_WEBHOOK_URL?: string;
}

function envStr(env: CostControlEnv | undefined, key: keyof CostControlEnv): string {
  const fromEnv = env?.[key];
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  const fromProcess = process.env[key as string];
  return typeof fromProcess === "string" ? fromProcess.trim() : "";
}

function parsePositiveInt(raw: string, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

function parseFlag(raw: string, defaultEnabled: boolean): boolean {
  if (!raw) return defaultEnabled;
  const lower = raw.toLowerCase();
  if (lower === "0" || lower === "false" || lower === "no" || lower === "off") return false;
  return true;
}

/** Default 8M tokens/user/day — ~4 full post-call runs at typical transcript sizes. */
export const DEFAULT_DAILY_TOKEN_BUDGET = 8_000_000;

/** Conservative reservation per LLM call to limit parallel-pass overshoot. */
export const DEFAULT_TOKEN_RESERVE = 120_000;

export function dailyTokenBudgetEnabled(env?: CostControlEnv): boolean {
  return parseFlag(envStr(env, "DAILY_TOKEN_BUDGET_ENABLED"), true);
}

export function dailyTokenBudgetLimit(env?: CostControlEnv): number {
  return parsePositiveInt(envStr(env, "DAILY_TOKEN_BUDGET_PER_USER"), DEFAULT_DAILY_TOKEN_BUDGET);
}

export function dailyTokenBudgetReserve(env?: CostControlEnv): number {
  return parsePositiveInt(envStr(env, "DAILY_TOKEN_BUDGET_RESERVE"), DEFAULT_TOKEN_RESERVE);
}

export function summariseAnomalyEnabled(env?: CostControlEnv): boolean {
  return parseFlag(envStr(env, "SUMMARISE_ANOMALY_ENABLED"), true);
}

export function summariseAnomalyMultiplier(env?: CostControlEnv): number {
  return parsePositiveInt(envStr(env, "SUMMARISE_ANOMALY_MULTIPLIER"), 2);
}

export function summariseAnomalyBaselineDays(env?: CostControlEnv): number {
  return parsePositiveInt(envStr(env, "SUMMARISE_ANOMALY_BASELINE_DAYS"), 14);
}

export function costAlertWebhookUrl(env?: CostControlEnv): string {
  return envStr(env, "COST_ALERT_WEBHOOK_URL");
}

/** UTC date key YYYY-MM-DD for daily budget docs. */
export function utcDateKey(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Compute percentile (0–100) from a numeric sample. Exported for tests. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}
