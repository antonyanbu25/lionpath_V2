/**
 * Shared Gemini fetch retry + per-workload timeouts.
 * Retries 429/503/transient network only — never 4xx schema/validation errors.
 */

import type { LlmRequest } from "./types";

export type GeminiWorkload = "research" | "synthesize" | "postcall" | "vision" | "extraction";

const POSTCALL_PASS_NAMES = new Set([
  "scorecard",
  "gaps",
  "summarise",
  "summaries",
  "qualify",
  "commit",
  "arr-inputs",
  "analyze",
  "classify",
]);

/** Per-workload AbortController budgets — sized above observed p95 with headroom. */
export const GEMINI_TIMEOUT_MS: Record<GeminiWorkload, number> = {
  /** google_search grounding p95 ~30–35s under load */
  research: 45_000,
  /** 12k-token brief JSON p95 ~65–75s */
  synthesize: 90_000,
  /** cached transcript + structured pass p95 ~50–60s */
  postcall: 75_000,
  /** up to 10 JPEG frames p95 ~35–45s */
  vision: 60_000,
  /** smaller prep extraction schemas p95 ~20–30s */
  extraction: 45_000,
};

export const MAX_GEMINI_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

export function resolveGeminiWorkload(req: LlmRequest): GeminiWorkload {
  if (req.research) return "research";
  if (req.passName === "synthesize") return "synthesize";
  if (req.passName === "video/vision") return "vision";
  if (POSTCALL_PASS_NAMES.has(req.passName)) return "postcall";
  return "extraction";
}

export function resolveGeminiTimeoutMs(req: LlmRequest): number {
  return GEMINI_TIMEOUT_MS[resolveGeminiWorkload(req)];
}

export function isRetryableGeminiHttpStatus(status: number): boolean {
  return status === 429 || status === 503;
}

/** Never retry client/schema errors — 400-class except rate-limit edge cases. */
export function isNonRetryableGeminiHttpStatus(status: number): boolean {
  if (isRetryableGeminiHttpStatus(status)) return false;
  return status >= 400 && status < 500;
}

export function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return false;
  const msg = err.message.toLowerCase();
  return (
    err.name === "TypeError" ||
    /fetch failed|network|econnreset|etimedout|socket hang up|dns/i.test(msg)
  );
}

/** Detect schema/validation failures in thrown Gemini error messages. */
export function isGeminiSchemaErrorMessage(message: string): boolean {
  return (
    /\b400\b/.test(message) &&
    /schema|responseSchema|response_schema|invalid_argument|invalid argument/i.test(message)
  );
}

export function parseRetryAfterMs(headers: Headers): number | null {
  const raw = headers.get("retry-after")?.trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function backoffDelayMs(attempt: number, retryAfterMs?: number | null): number {
  if (retryAfterMs != null && retryAfterMs > 0) {
    return Math.min(retryAfterMs + jitterMs(), MAX_BACKOFF_MS * 4);
  }
  const exp = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return exp + jitterMs();
}

function jitterMs(): number {
  return Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GeminiFetchResult {
  response: Response;
  retryCount: number;
}

/**
 * Fetch with AbortController timeout and bounded retry (429/503/network).
 * Returns retryCount separately so usage records can attribute retry spend.
 */
export async function fetchGeminiWithRetry(
  url: string,
  init: RequestInit,
  opts: {
    timeoutMs: number;
    step?: string;
    maxRetries?: number;
  },
): Promise<GeminiFetchResult> {
  const maxRetries = opts.maxRetries ?? MAX_GEMINI_RETRIES;
  let retryCount = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });

      if (response.ok || isNonRetryableGeminiHttpStatus(response.status)) {
        return { response, retryCount };
      }

      if (isRetryableGeminiHttpStatus(response.status) && attempt < maxRetries) {
        const retryAfterMs = parseRetryAfterMs(response.headers);
        await response.text().catch(() => "");
        await sleep(backoffDelayMs(attempt, retryAfterMs));
        retryCount++;
        continue;
      }

      return { response, retryCount };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        const step = opts.step ? `[${opts.step}] ` : "";
        throw new Error(`${step}Gemini timed out after ${opts.timeoutMs / 1000}s`);
      }
      if (attempt < maxRetries && isRetryableNetworkError(err)) {
        await sleep(backoffDelayMs(attempt));
        retryCount++;
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Gemini fetch exhausted retries");
}
