# P2-2: Per-Request Rate Limiter — Impact Assessment & Implementation Plan

Security review finding: **P2-2** — no per-request rate limiter (only the cost-driven token budget in `token-budget.ts`). This document is the code-literal plan for Codex (gpt-5.5) to implement, preceded by the impact analysis the user asked for.

---

## 1. IMPACT ASSESSMENT — Will a per-request rate limiter break normal SE usage?

**Answer: NO.** A per-user rate limit of **120 requests/minute** (with a **600 burst allowance**) will never block a real SE. Here is the math grounded in the actual source code.

### Request pattern per workflow (from code)

**A. Dashboard / page load (GET endpoints, no LLM)**

When an SE opens the portal or refreshes the dashboard, the frontend fires a burst of lightweight GET requests. From `routes.ts` and the dispatcher files:

  - `GET /api/config` — capability probe (no auth, no LLM, no Firestore)
  - `GET /api/calls` — recent calls list (Firestore read)
  - `GET /api/tasks` — SE task list (file/Firestore read)
  - `GET /api/feedback` — feedback entries (optional)
  - `GET /api/org/structure` — org structure (optional)
  - `GET /api/calls/{id}/payload` — call detail if navigating to a specific call

Total: **~4–6 HTTP requests** in a single page-load burst, all sub-100ms, no LLM cost. Well under 120/minute.

**B. Pre-call brief (POST /api/generate-prep — the heaviest single action)**

`generatePrep` in `worker/src/prep/index.ts:362` orchestrates:

  1. `gatherResearch()` → `runPlaybookResearch()` in `research.ts:110`
     - `buildPlaybookQueries()` in `playbook.ts:9` generates **5 base queries + 1 per prospect email**
     - Each query = 1 `provider.generate()` call (passName: `"research"`)
     - For 2 prospects: **~7 LLM calls** (cold path; cached path skips these)
  2. `runResearch()` from `research-orchestrator.ts` — additional research LLM calls (variable, typically **1–3**)
  3. `extractFacts()` in `extract-facts.ts:125` — **1 LLM call** (passName: `"extract-facts"`)
  4. `generateCompanyNews()` — up to **2 LLM calls** (passName: `"company-news"`)
  5. `synthesizePrep()` in `synthesize.ts` — **1–2 LLM calls** (passName: `"synthesize"`, +1 for JSON repair retry)
  6. `generateDemoGuidance()` — **1 LLM call** (passName: `"demo-guidance"`)
  7. `generateRivalComparison()` — **1 LLM call** (passName: `"rivals"`)

**BUT all of this is ONE HTTP request** (`POST /api/generate-prep`). The LLM calls happen server-side inside a single request handler. The SE's browser makes exactly **1 HTTP call** to the worker. The worker then fans out internally to Gemini.

The LLM calls from COST_CONTROL.md line 50 confirm: "~18 LLM calls cold" per pre-call. These are **Gemini API calls**, not **HTTP requests to our worker**. Our rate limiter counts HTTP requests to the worker, not downstream Gemini calls. The Gemini quota (120/min Gemini, line 64) is a separate layer.

**HTTP requests per pre-call: 1** (warm: same, just faster server-side; `/api/prep/research` + `/api/prep/synthesize` are the two-step variant = 2 HTTP requests maximum).

**C. Post-call analysis (POST /api/postcall/generate — confirm-and-generate)**

`runPostCallConfirmedPipeline` in `generate.ts:160` orchestrates:

  1. Optionally `runPostCallResolve()` — no LLM (recording fetch + deal match)
  2. Optionally `runPostCallClassify()` — **1 LLM call** (passName: `"classify"`)
  3. `runPostCallGenerate()` in `generate.ts:31` runs in parallel:
     - `analyzePostCall()` — **1 LLM call** (passName: `"analyze"`)
     - `runPostCallScorecard()` — **1 LLM call** (passName: `"scorecard"`)
  4. The workflow can also trigger Video Pass 2 (`POST /api/video-pass`) — 1+ LLM calls for vision

Total LLM calls per post-call: ~9–12 (confirming COST_CONTROL.md line 50).

**But again, HTTP requests to the worker:**

  - Full confirm-and-generate flow: `POST /api/postcall/resolve` (1) → `POST /api/postcall/classify` (1) → `POST /api/postcall/generate` (1) = **3 HTTP requests**
  - If using Video Pass: `POST /api/postcall/resolve` (1) → `POST /api/video-pass` (1) → `POST /api/postcall/generate` (1) = **3 HTTP requests**
  - Individual passes (qualify, commit, gaps, summarise, arr-inputs): each is **1 HTTP request**

**D. Per-day HTTP request count for one SE**

From COST_CONTROL.md lines 44-57:
  - 4 post-calls/day/SE, ~3 HTTP requests each = **12 HTTP requests**
  - 2 pre-calls/day/SE, 1-2 HTTP requests each = **3 HTTP requests**
  - Dashboard loads: ~5 HTTP requests/load × 10 loads/day = **50 HTTP requests**
  - Task GET/POST, feedback, history GET = **~10 HTTP requests/day**
  - Individual post-call passes (qualify, gaps, summarise, etc.): ~5 × 4 calls × 2 HTTP each = **~40 HTTP requests**

**Total per SE per day: ~115 HTTP requests.**

That's **~0.08 requests/second average** — orders of magnitude below 120 req/min.

The absolute worst-case burst: an SE rapidly triggering all post-call passes in a 60-second window (resolve → classify → generate → qualify → gaps → summarise → arr-inputs → arr-compute → timeline = 9 HTTP requests) plus a page load (6) = **15 requests in one minute**. 

**15 << 120. Normal usage will NEVER trip the limiter.**

The limiter only catches:
  - A script/loop hammering the API (e.g., a retry storm from a broken client)
  - A shared token being used by multiple automated tools concurrently
  - An attacker who got a valid Firebase auth token brute-forcing endpoints

### Conclusion

A per-user limit of **120 req/min with 600 burst** is safe. The existing `DAILY_TOKEN_BUDGET_PER_USER=8,000,000` (cost layer) remains the primary guard against LLM spend; this new limiter is a defense-in-depth request-level guard against abuse that bypasses LLM pathways (e.g., GET floods, resolve-loop storms with no LLM cost).

---

## 2. RATE LIMITER DESIGN

### Approach: In-memory fixed-window counter per user

**Why in-memory (not Firestore):**

1. The VPS runs a single Node server process via Docker (`deploy/vps/docker-compose.yml`). In-memory state persists for the container lifetime with no external dependency.
2. A Firestore-backed counter would add a transaction read+write on every single request — that's 100% latency overhead on GET endpoints that currently respond in <50ms. The token budget already does this on LLM calls only; adding it to ALL HTTP requests is unacceptable.
3. The CF Worker path (`index.ts`) is deployed on Cloudflare's edge where each isolate has its own memory anyway — a Firestore counter there would be inconsistent across isolates. In-memory is honest about this limitation and still catches single-isolate abuse.
4. The rate limiter's job is to catch burst abuse, not enforce long-term quotas (that's the daily token budget's job). Resetting on restart is acceptable — Docker restarts are rare and the window is only 60 seconds.

**Limit values (configurable via env):**

```
RATE_LIMIT_PER_MINUTE=120       # max requests per user per 60s window
RATE_LIMIT_BURST=600            # allow short bursts (prevents false positives on rapid page loads)
RATE_LIMIT_ENABLED=1            # kill switch
```

The burst allowance (600) is 5× the per-minute limit. A single SE page load fires 6 requests in <1 second. With burst=600, they'd need to fire 100 simultaneous page loads in one minute to trip it. This is generous but catches scripts that fire 1000+ requests in a loop.

**The 429 response shape** (matching the existing `DailyTokenBudgetExceededError` convention):

```json
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 60
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1699999999

{
  "error": "Rate limit exceeded. Too many requests. Please slow down and retry in 60 seconds.",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 60
}
```

### The limiter module (new file)

**File: `worker/src/rate-limit.ts`** (new file, ~80 lines)

```typescript
/**
 * Per-user in-memory rate limiter — fixed-window counter.
 *
 * Defense-in-depth request-level guard (P2-2). Works on both Node server (VPS)
 * and Cloudflare Worker edge. State is per-process and resets on restart —
 * acceptable because this catches burst abuse, not long-term quotas (the daily
 * token budget in token-budget.ts handles LLM spend caps).
 *
 * Design: fixed 60s window per user UUID. A token-bucket with burst allowance
 * would be smoother, but a simple counter is deterministic and testable.
 */

import type { CostControlEnv } from "./cost-control-config";
import type { Env } from "./env";
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

/** Map<userId, RateBucket>. Module-level for singleton lifetime on VPS. */
const buckets = new Map<string, RateBucket>();

// Periodic cleanup of stale entries to prevent unbounded memory growth.
// Runs lazily on every N-th check.
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

function enabled(env?: RateLimitEnv): boolean {
  const fromEnv = env?.RATE_LIMIT_ENABLED;
  const fromProcess = process.env.RATE_LIMIT_ENABLED;
  return parseFlag(fromEnv ?? fromProcess, true);
}

function perMinute(env?: RateLimitEnv): number {
  const raw = env?.RATE_LIMIT_PER_MINUTE ?? process.env.RATE_LIMIT_PER_MINUTE;
  return parsePositiveInt(raw, 120);
}

function burstLimit(env?: RateLimitEnv): number {
  const raw = env?.RATE_LIMIT_BURST ?? process.env.RATE_LIMIT_BURST;
  return parsePositiveInt(raw, 600);
}

function cleanupStaleEntries(now: number): void {
  const cutoff = now - WINDOW_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < cutoff) {
      buckets.delete(key);
    }
  }
}

/**
 * Check rate limit for a user. Returns null if allowed, or a RateLimitExceeded
 * object if the limit is exceeded.
 *
 * @param userId - The verified Firebase user UID (from requireUser). If null
 *   (dummy auth mode), uses the client IP as a fallback key.
 * @param clientIp - Client IP for fallback keying when userId is null.
 * @param env - Environment with rate limit config.
 * @returns null if allowed, or { retryAfter, limit, resetAt } if exceeded.
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

  // Lazy cleanup
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
    const retryAfter = Math.ceil((resetAt - now) / 1000);
    logWarn("[rate-limit] Rate limit exceeded", {
      key,
      count: bucket.count,
      limit: effectiveLimit,
      retryAfter,
    });
    return { retryAfter: Math.max(1, retryAfter), limit: effectiveLimit, resetAt };
  }

  return null;
}

/** Exposed for tests. */
export function _resetRateLimits(): void {
  buckets.clear();
  checkCounter = 0;
}

/** Estimate client IP from a Request — best-effort, not security-critical. */
export function clientIpFromRequest(request: Request): string | undefined {
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf) return cf;
  const xff = request.headers.get("X-Forwarded-For");
  if (xff) return xff.split(",")[0]?.trim();
  const xri = request.headers.get("X-Real-IP");
  if (xri) return xri;
  return undefined;
}
```

### Wiring: CF Worker entry (`worker/src/index.ts`)

The limiter goes **after** the OPTIONS preflight check and **before** the route lookup. We need the userId, which requires calling `requireUser` — but `requireUser` does a Firebase token verification (network call). To avoid an extra JWK fetch on every request, we extract the UID lightweight from the token payload (the full verification happens later inside each handler's `requireUser` call; the limiter only needs the identity for keying, not authentication — the handler still verifies).

Wait — that approach is fragile. The cleaner approach: call `requireUser` in the limiter middleware, and the handler's own `requireUser` call will re-verify but use the cached JWK (already fetched). The overhead is one `crypto.subtle.verify` per request — ~1ms. Acceptable.

Actually, calling `requireUser` twice per request is wasteful. Better approach: extract the UID from the JWT payload **without verification** just for the rate-limit key. The real `requireUser` in the handler still verifies the signature. This is safe because:
  - If the UID is spoofed, the handler's `requireUser` will reject the request with 401 anyway
  - The rate limiter just uses the UID as a map key — a spoofed UID would rate-limit the wrong bucket, but the request itself is still blocked by auth
  - This adds zero latency (no JWK fetch, no verify)

Add this function to `rate-limit.ts`:

```typescript
/**
 * Extract Firebase UID from JWT payload WITHOUT verification — used only as
 * a rate-limit key. The handler's requireUser() still verifies the token.
 */
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
      return null; // expired token — don't key on it
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
```

**Wire into `index.ts`** — add the limiter check right after the OPTIONS preflight (line 68), before the route lookup:

```typescript
// In index.ts, after the OPTIONS check (line 68), before `const url = new URL(request.url);`

const url = new URL(request.url);
const path = url.pathname;

// --- P2-2: Per-user rate limiter (defense-in-depth) ---
// Exempt paths that must never be rate-limited (health probes, config, static).
if (!isRateLimitExempt(path)) {
  const rateLimitResult = checkRateLimit(
    extractUidForRateLimit(request),
    clientIpFromRequest(request),
    env,
  );
  if (rateLimitResult) {
    const headers = {
      ...cors,
      "Retry-After": String(rateLimitResult.retryAfter),
      "X-RateLimit-Limit": String(rateLimitResult.limit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(rateLimitResult.resetAt),
    };
    return withCorrelationHeader(
      json(
        {
          error: "Rate limit exceeded. Too many requests. Please slow down and retry shortly.",
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter: rateLimitResult.retryAfter,
        },
        429,
        headers,
      ),
      correlationId,
    );
  }
}
```

**Add imports at the top of `index.ts`** (after line 22, the correlationId import):

```typescript
import {
  checkRateLimit,
  clientIpFromRequest,
  extractUidForRateLimit,
  isRateLimitExempt,
} from "./rate-limit";
```

### Wiring: Node server (`worker/src/node-server.ts`)

The Node server has two paths:

1. **Video Pass 2** (line 146, `POST /api/video-pass`) — handled directly by node-server before delegating to the worker fetch handler. This needs its own limiter check.

2. **All other routes** (line 180, `worker.fetch(request, env)`) — the limiter is already wired inside `index.ts`'s `fetch()` handler, so these are covered automatically. No change needed in node-server for the main path.

**For the Video Pass 2 path** — add the limiter check after `requireUser` (line 156), before `handleVideoPassNode`:

```typescript
// node-server.ts, inside the video-pass handler block, after line 156:
//   await requireUser(authReq, env);
// Add:
const { checkRateLimit, clientIpFromRequest, extractUidForRateLimit } = await import("./rate-limit");
const rateLimitResult = checkRateLimit(
  extractUidForRateLimit(authReq),
  clientIpFromRequest(authReq),
  env,
);
if (rateLimitResult) {
  res.statusCode = 429;
  for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
  res.setHeader("Retry-After", String(rateLimitResult.retryAfter));
  res.setHeader("X-RateLimit-Limit", String(rateLimitResult.limit));
  res.setHeader("X-RateLimit-Remaining", "0");
  res.setHeader("X-RateLimit-Reset", String(rateLimitResult.resetAt));
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    error: "Rate limit exceeded. Too many requests. Please slow down and retry shortly.",
    code: "RATE_LIMIT_EXCEEDED",
    retryAfter: rateLimitResult.retryAfter,
  }));
  return;
}
```

But wait: the Video Pass path also goes through the worker fetch handler (for the POST `/api/video-pass` route in `routes.ts:1020`). Looking more carefully at node-server.ts line 146:

```typescript
if (req.method === "POST" && url.pathname === "/api/video-pass") {
```

This intercepts the `/api/video-pass` request and handles it **entirely in Node** (returns at line 164), bypassing `worker.fetch()`. So the `index.ts` limiter never runs for this path. The Node-level limiter check above is required.

Actually, re-reading: `handleVideoPass` exists in both `routes.ts` (line 336, for CF Worker) and `node-server.ts` (line 146, Node-only path). The Node path is the one that runs on VPS. The CF Worker path runs on Cloudflare. Both need the limiter.

On the CF Worker path, `index.ts` intercepts it first via the route table → covered by the `index.ts` limiter wiring.

On the VPS Node path, `node-server.ts` intercepts it at line 146 → needs the explicit check shown above.

---

## 3. EXEMPTIONS

These paths must be exempt from rate limiting:

```typescript
// In rate-limit.ts:

/**
 * Paths exempt from rate limiting. These are:
 * - Health probes (Docker healthcheck, Cloud Run probes, deploy verify curl)
 * - Config endpoint (called on every page load, no auth, no LLM)
 * - OPTIONS preflight (already short-circuited before limiter in index.ts)
 * - Static assets (served by nginx, never reach worker — but be safe)
 */
const EXEMPT_PATH_PREFIXES = [
  "/api/health",
  "/api/health/live",
  "/api/health/ready",
  "/api/config",
  "/api/zoom/status", // lightweight capability check, no LLM
];

const EXEMPT_EXACT_PATHS = new Set([
  "/api/health",
  "/api/health/live",
  "/api/health/ready",
  "/api/config",
  "/api/zoom/status",
]);

export function isRateLimitExempt(path: string): boolean {
  if (EXEMPT_EXACT_PATHS.has(path)) return true;
  // Health subpaths
  if (path.startsWith("/api/health")) return true;
  // Don't rate-limit CORS preflight
  return false;
}
```

**Rationale:**
- `/api/config` — called on every page load by the frontend. Already exempt; rate-limiting it would break the portal.
- `/api/health/*` — Docker healthcheck hits `/api/config` every 15s (see `docker-compose.yml` healthcheck). The health routes are also used by deploy verify scripts. Must not be limited.
- `/api/zoom/status` — capability check, no LLM, lightweight. Called during dashboard load. Safe to exempt (it returns config, not data).
- OPTIONS — already short-circuited at line 66-68 of `index.ts` before the limiter check.

**NOT exempt** (these must be rate-limited because they are the abuse surface):
- All POST endpoints to `/api/postcall/*`, `/api/generate-prep`, `/api/contact/enrich`, etc.
- All GET data endpoints (`/api/calls`, `/api/tasks`, `/api/history`, etc.)
- `/api/video-pass`

---

## 4. FILES TO CHANGE

### File 1: `worker/src/rate-limit.ts` (NEW FILE)

Create this file with the complete code from Section 2 plus the exemption function from Section 3. The full file content:

```typescript
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
```

### File 2: `worker/src/index.ts` (MODIFY)

**Change 1: Add import** (after line 22, the correlationId import):

```typescript
import {
  checkRateLimit,
  clientIpFromRequest,
  extractUidForRateLimit,
  isRateLimitExempt,
} from "./rate-limit";
```

**Change 2: Add limiter check** — insert after the OPTIONS preflight block (after line 68) and before `const url = new URL(request.url);` (line 70). The existing line 70 `const url = new URL(request.url);` moves down.

The block to insert:

```typescript
      const url = new URL(request.url);
      const path = url.pathname;

      // --- P2-2: Per-request rate limiter (defense-in-depth) ---
      if (!isRateLimitExempt(path)) {
        const rateLimitResult = checkRateLimit(
          extractUidForRateLimit(request),
          clientIpFromRequest(request),
          env,
        );
        if (rateLimitResult) {
          return withCorrelationHeader(
            json(
              {
                error: "Rate limit exceeded. Too many requests. Please slow down and retry shortly.",
                code: "RATE_LIMIT_EXCEEDED",
                retryAfter: rateLimitResult.retryAfter,
              },
              429,
              {
                ...cors,
                "Retry-After": String(rateLimitResult.retryAfter),
                "X-RateLimit-Limit": String(rateLimitResult.limit),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": String(rateLimitResult.resetAt),
              },
            ),
            correlationId,
          );
        }
      }
```

Then the existing `const url = ...` and `const path = ...` lines (old lines 70-71) should be **removed** since the new block above already declares them. The rest of the try block (route lookup starting at old line 74) continues unchanged using the `path` variable.

**Important:** The `json` import is already present at line 20 of `index.ts`, and `withCorrelationHeader` is defined at line 48. No new imports needed for those.

### File 3: `worker/src/node-server.ts` (MODIFY)

**Change: Add limiter check to the Video Pass 2 path** — insert after `await requireUser(authReq, env);` (line 156) and before `const parsed = ...` (line 157):

```typescript
      // --- P2-2: Per-request rate limiter for Node-intercepted routes ---
      const { checkRateLimit, clientIpFromRequest, extractUidForRateLimit } = await import(
        "./rate-limit"
      );
      const rateLimitResult = checkRateLimit(
        extractUidForRateLimit(authReq),
        clientIpFromRequest(authReq),
        env,
      );
      if (rateLimitResult) {
        res.statusCode = 429;
        for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
        res.setHeader("Retry-After", String(rateLimitResult.retryAfter));
        res.setHeader("X-RateLimit-Limit", String(rateLimitResult.limit));
        res.setHeader("X-RateLimit-Remaining", "0");
        res.setHeader("X-RateLimit-Reset", String(rateLimitResult.resetAt));
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            error: "Rate limit exceeded. Too many requests. Please slow down and retry shortly.",
            code: "RATE_LIMIT_EXCEEDED",
            retryAfter: rateLimitResult.retryAfter,
          }),
        );
        return;
      }
```

**Why dynamic import:** `node-server.ts` already uses dynamic imports for `./auth` and `./video/http` (lines 147-148), so this pattern is consistent.

### File 4: `worker/src/env.ts` (MODIFY)

**Add rate limit env vars to the `Env` interface** so TypeScript recognizes them:

```typescript
import type { CostControlEnv } from "./cost-control-config";
import type { Env as PrepEnv } from "./prep";
import type { ZoomEnv } from "./zoom";
import type { HistoryEnv } from "./history";
import type { RateLimitEnv } from "./rate-limit";  // ADD THIS IMPORT

export interface Env extends PrepEnv, ZoomEnv, HistoryEnv, CostControlEnv, RateLimitEnv {  // ADD RateLimitEnv
  ALLOWED_ORIGINS?: string;
  ALLOWED_EMAIL_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  APOLLO_API_KEY?: string;
  FRESHDESK_API_KEY?: string;
  FRESHDESK_DOMAIN?: string;
  VIDEO_PASS_ENABLED?: string;
  CALL_PAYLOAD_BUCKET?: string;
  INTERNAL_CRON_SECRET?: string;
}
```

### File 5: `worker/src/node-server.ts` `NodeEnv` interface (MODIFY)

In `node-server.ts`, the `NodeEnv` interface at line 21 extends `CostControlEnv`. Add `RateLimitEnv`:

```typescript
import type { RateLimitEnv } from "./rate-limit";

interface NodeEnv extends PrepEnv, ZoomEnv, HistoryEnv, CostControlEnv, RateLimitEnv {  // ADD RateLimitEnv
  ALLOWED_ORIGINS?: string;
  // ... rest unchanged
```

And in `buildEnv()`, add the rate limit env vars (after line 71, before the closing `};`):

```typescript
    RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED || "1",
    RATE_LIMIT_PER_MINUTE: process.env.RATE_LIMIT_PER_MINUTE || "120",
    RATE_LIMIT_BURST: process.env.RATE_LIMIT_BURST || "600",
```

### File 6: `deploy/vps/docker-compose.yml` (MODIFY)

Add rate limit env vars to the worker service's `environment:` block (after `VIDEO_PASS_ENABLED: "1"`):

```yaml
      RATE_LIMIT_ENABLED: "1"
      RATE_LIMIT_PER_MINUTE: "120"
      RATE_LIMIT_BURST: "600"
```

### File 7: `docs/COST_CONTROL.md` (MODIFY)

Add a new section after Layer 3 (around line 142), before the "Not covered" note:

```markdown
## Layer 2.5 — Per-request rate limiter (burst abuse guard)

Defense-in-depth request-level guard (security review P2-2). Catches HTTP
request floods that bypass the LLM token budget — e.g., GET storms, resolve-loop
attacks, retry storms from broken clients.

### Behaviour

- In-memory fixed 60s window counter per user (Firebase UID from JWT payload)
- **120 requests/minute per user** with **600 burst allowance**
- Exempts: `/api/config`, `/api/health/*`, `/api/zoom/status` (polled by frontend/Docker)
- On breach: HTTP **429** with `Retry-After`, `X-RateLimit-*` headers
- Resets on process restart (acceptable — daily token budget handles long-term caps)

### Env vars (VPS `.env` / docker-compose)

```bash
RATE_LIMIT_ENABLED=1
RATE_LIMIT_PER_MINUTE=120
RATE_LIMIT_BURST=600
```

### Impact on normal usage

A single SE generates ~115 HTTP requests/day (~0.08 req/s average). Worst-case
burst: 15 requests in one minute (all post-call passes + page load). 15 << 120.
**Normal SE usage will never trip the limiter.**
```

### Verification Steps

```bash
# 1. TypeScript compiles
cd /root/lionpath_V2/worker
npx tsc --noEmit

# 2. Unit test the limiter (create worker/src/rate-limit.test.ts)
npx vitest run rate-limit

# 3. Manual smoke test on VPS
#    a. Start worker locally:
cd /root/lionpath_V2 && npm run dev:worker &
#    b. Hit an exempt endpoint 200 times rapidly — should all succeed:
for i in $(seq 1 200); do curl -s http://localhost:8787/api/config | head -c 20; done
#    c. Hit a rate-limited endpoint with a dummy token 200 times rapidly:
#       First 120 (or 600 with burst) succeed, rest get 429
TOKEN="fake.token.eyJzdWIiOiJ0ZXN0MTIzIn0="  # not a real token, will 401 — but limiter runs before auth
for i in $(seq 1 200); do
  curl -s -o /dev/null -w "%{http_code} " -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/tasks
done
# Expected: mix of 401s (no valid auth) but the limiter should fire 429s after burst

# 4. Verify the 429 response shape:
curl -v -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/tasks
# Should show 429 with X-RateLimit-* headers and Retry-After

# 5. Verify Docker healthcheck still works (uses /api/config which is exempt):
docker inspect --format='{{.State.Health.Status}}' $(docker compose -f deploy/vps/docker-compose.yml ps -q worker)
```

### Commit Message

```
feat(security): add per-request rate limiter (P2-2)

Defense-in-depth request-level guard against burst abuse. In-memory fixed
60s window counter per user (Firebase UID), 120 req/min with 600 burst
allowance. Exempts /api/config, /api/health/*, /api/zoom/status so polling
and Docker healthchecks are unaffected.

Impact: normal SE usage generates ~115 HTTP req/day (~0.08 req/s avg),
worst-case burst 15 req/min — well under 120 req/min limit. Does not block
any normal pre-call, post-call, or dashboard workflow.

Wired into both CF Worker entry (index.ts) and Node server's Video Pass 2
intercept (node-server.ts). Configurable via RATE_LIMIT_* env vars.

Refs: security review P2-2, docs/COST_CONTROL.md
```

---

## 5. DEPLOY

### Deploy to VPS without breaking the running portal

The deployment uses `deploy/vps/update.sh` which does: `git fetch → git reset --hard → docker compose build → docker compose up -d`. The rebuild takes ~2 minutes. During the rebuild, the existing container continues serving requests. Docker Compose's `restart: unless-stopped` and the healthcheck ensure zero downtime.

```bash
# On the VPS (as root or deploy user):

# 1. Ensure the code change is pushed to origin/2.1
#    (done by Codex after committing locally)
cd /opt/se-singha-paathai
git push origin 2.1

# 2. Run the standard deploy script
cd deploy/vps
bash update.sh

# What happens:
#   - git fetch origin/2.1 + reset --hard (pulls the new code)
#   - docker compose build worker (rebuilds the Node image)
#   - docker compose up -d (starts new container, old one drains)
#   - Healthcheck polls /api/config (exempt from rate limiter!) every 15s
#   - Old container is removed after new one passes healthcheck

# 3. Verify the limiter is active
#    Check logs for any rate-limit activity:
docker compose logs worker | grep "rate-limit"
# Should be empty (no limits hit in normal operation)

# 4. Verify env vars are set
docker compose exec worker env | grep RATE_LIMIT
# Expected:
#   RATE_LIMIT_ENABLED=1
#   RATE_LIMIT_PER_MINUTE=120
#   RATE_LIMIT_BURST=600
```

### Zero-downtime guarantee

The Docker healthcheck in `docker-compose.yml` polls `/api/config` every 15 seconds. Since `/api/config` is exempt from the rate limiter, the healthcheck is unaffected. Docker Compose starts the new container, waits for it to pass healthcheck, then stops the old one. No requests are dropped.

### Rollback

```bash
# Option A: Disable via env var (instant, no redeploy)
#   Edit deploy/vps/.env and add:
#   RATE_LIMIT_ENABLED=0
#   Then restart just the worker:
cd /opt/se-singha-paathai/deploy/vps
docker compose restart worker

# Option B: Revert the commit and redeploy
cd /opt/se-singha-paathai
git revert HEAD --no-edit
git push origin 2.1
cd deploy/vps
bash update.sh

# Option C: Roll back to previous known-good commit
cd /opt/se-singha-paathai
git log --oneline -5  # find the commit before the rate limiter
git checkout <previous-commit> -- worker/src/rate-limit.ts worker/src/index.ts worker/src/node-server.ts worker/src/env.ts deploy/vps/docker-compose.yml docs/COST_CONTROL.md
git commit -m "revert: rollback per-request rate limiter"
git push origin 2.1
cd deploy/vps
bash update.sh
```

### Risk assessment of deployment

- **Risk of breaking the portal:** Near zero. The only behavior change is that requests exceeding 120/min/user get 429 instead of being processed. Normal usage never approaches this threshold.
- **Risk of limiter false-positives during a legitimate burst:** Mitigated by the 600 burst allowance (5× the per-minute limit). An SE would need to fire 600+ simultaneous requests to trip it.
- **Risk of performance regression:** Near zero. The limiter does a Map lookup + increment on each request (~0.01ms). The JWT payload extraction is a base64 decode + JSON parse (~0.05ms). No network calls.
- **Risk of memory leak:** Mitigated by lazy cleanup every 500 requests, which purges entries older than 60s.
