/**
 * Per-user in-memory rate limiter — fixed-window counter (P2-2).
 *
 * Defense-in-depth request-level guard. Works on both Node server (VPS) and
 * Cloudflare Worker edge. State is per-process and resets on restart —
 * acceptable because this catches burst abuse, not long-term quotas (the daily
 * token budget in token-budget.ts handles LLM spend caps).
 *
 * Limits: 120 req/min per user, 600 burst allowance (configurable via env).
 * See docs/COST_CONTROL.md for impact analysis.
 */

import type { CostControlEnv } from "./cost-control-config";
import { logWarn } from "./logger";

/** Env additions for rate limiting. */
export interface RateLimitEnv extends CostControlEnv {
  RATE_LIMIT_ENABLED?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  RATE_LIMIT_BURST?: string;
}

interface RateBucket {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60_000;
const DEFAULT_PER_MINUTE = 120;
const DEFAULT_BURST = 600;

/** Map<userId, RateBucket>. Module-level for singleton lifetime on VPS. */
const buckets = new Map<string, RateBucket>();

let checkCounter = 0;
const CLEANUP_INTERVAL = 500;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

function parseFlag(raw: string | undefined, defaultEnabled: boolean): boolean {
  if (!raw) return defaultEnabled;
  const lower = raw.toLowerCase();
  if (lower === "0" || lower === "false" || lower === "no" || lower === "off") return false;
  return true;
}

function envStr(env: RateLimitEnv | undefined, key: string): string | undefined {
  const fromEnv = env?.[key as keyof RateLimitEnv];
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  const fromProcess = process.env[key];
  return typeof fromProcess === "string" ? fromProcess.trim() : undefined;
}

function enabled(env?: RateLimitEnv): boolean {
  return parseFlag(envStr(env, "RATE_LIMIT_ENABLED"), true);
}

function perMinute(env?: RateLimitEnv): number {
  return parsePositiveInt(envStr(env, "RATE_LIMIT_PER_MINUTE"), DEFAULT_PER_MINUTE);
}

function burstLimit(env?: RateLimitEnv): number {
  return parsePositiveInt(envStr(env, "RATE_LIMIT_BURST"), DEFAULT_BURST);
}

function cleanupStaleEntries(now: number): void {
  const cutoff = now - WINDOW_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < cutoff) buckets.delete(key);
  }
}

/**
 * Check rate limit for a user. Returns null if allowed, or rate-limit info
 * if exceeded. Uses a fixed 60s window with burst allowance.
 *
 * @param userId - Verified Firebase user UID (unverified extraction OK —
 *   handlers still call requireUser for real auth).
 * @param clientIp - Fallback key when userId is null (dummy auth mode).
 * @param env - Environment with rate limit config.
 */
export function checkRateLimit(
  userId: string | null,
  clientIp: string | undefined,
  env?: RateLimitEnv,
): { retryAfter: number; limit: number; resetAt: number } | null {
  if (!enabled(env)) return null;

  const key = userId || `ip:${clientIp || "unknown"}`;
  const limit = perMinute(env);
  const burst = burstLimit(env);
  const effectiveLimit = Math.max(limit, burst);
  const now = Date.now();

  checkCounter++;
  if (checkCounter >= CLEANUP_INTERVAL) {
    checkCounter = 0;
    cleanupStaleEntries(now);
  }

  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    buckets.set(key, bucket);
  }

  bucket.count++;

  if (bucket.count > effectiveLimit) {
    const resetAt = bucket.windowStart + WINDOW_MS;
    const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
    logWarn("[rate-limit] Rate limit exceeded", {
      key,
      count: bucket.count,
      limit: effectiveLimit,
      retryAfter,
    });
    return { retryAfter, limit: effectiveLimit, resetAt };
  }

  return null;
}

// --- Exemptions ---

const EXEMPT_EXACT_PATHS = new Set([
  "/api/health",
  "/api/health/live",
  "/api/health/ready",
  "/api/config",
  "/api/zoom/status",
]);

export function isRateLimitExempt(path: string): boolean {
  if (EXEMPT_EXACT_PATHS.has(path)) return true;
  if (path.startsWith("/api/health")) return true;
  return false;
}

// --- Helpers ---

/** Extract Firebase UID from JWT payload WITHOUT verification — rate-limit key only. */
export function extractUidForRateLimit(request: Request): string | null {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(b64urlToBytes(parts[1])),
    ) as { sub?: string; exp?: number };
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload.sub || null;
  } catch {
    return null;
  }
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Estimate client IP from a Request — best-effort keying for dummy auth mode. */
export function clientIpFromRequest(request: Request): string | undefined {
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf) return cf;
  const xff = request.headers.get("X-Forwarded-For");
  if (xff) return xff.split(",")[0]?.trim();
  const xri = request.headers.get("X-Real-IP");
  if (xri) return xri;
  return undefined;
}

/** Exposed for tests. */
export function _resetRateLimits(): void {
  buckets.clear();
  checkCounter = 0;
}
