// Cloudflare Worker entry. Routes:
//   POST /api/generate-prep   — pre-call research brief
//   POST /api/contact/enrich  — per-contact profile + inferred DISC
//   POST /api/kaia/share-content — Kaia Engage public share → summary bundle
//   POST /api/fetch-kaia-summary — legacy alias for Kaia summary fetch
//   POST /api/postcall/resolve   — Pass 0: recording + deal match (no LLM)
//   POST /api/postcall/classify  — Pass 1: call type (cheap LLM)
//   POST /api/postcall/generate  — confirmed analysis generation
//   POST /api/postcall/qualify   — Pass 4: MEDDPICC qualification
//   POST /api/postcall/arr-inputs — ARR input extraction (no arithmetic)
//   POST /api/postcall/arr-compute  — ARR from extracted inputs (pure compute)
//   POST /api/postcall/summarise — Pass 7: commitments + call notes + MoM (never auto-send)
//   POST /api/postcall/gaps      — Pass 6: product gaps + what landed (spec §8)
//   POST /api/product-signal/cluster — async gap clustering (ADR-006)
//   POST /api/analyze-call       — legacy facade (auto-pick + generate)
//   GET  /api/zoom/status     — whether Zoom OAuth is configured
//   GET  /api/zoom/auth       — start Zoom OAuth (phase 2)
//   POST /api/admin/impersonate-token — dev-only: mint a Firebase custom token for any user email

import type { Env } from "./env";
import { json } from "./http";
import { logError } from "./logger";
import { correlationIdFromRequest, runWithRequestContext } from "./request-context";
import {
  checkRateLimit,
  clientIpFromRequest,
  extractUidForRateLimit,
  isRateLimitExempt,
} from "./rate-limit";
import {
  handleTaskDelete,
  handleTaskPatch,
  routes,
} from "./routes";
import { dispatchDomainReadById } from "./routes/domain-reads";
import { dispatchReadModelsById } from "./routes/read-models";
import { handleImpersonateToken } from "./routes/impersonate";

export type { Env } from "./env";

function corsHeaders(origin: string, allowed: string[]): Record<string, string> {
  const allow = allowed.includes("*")
    ? "*"
    : allowed.includes(origin)
      ? origin
      : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function withCorrelationHeader(response: Response, correlationId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Request-Id", correlationId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const correlationId = correlationIdFromRequest(request);
    return runWithRequestContext(correlationId, async () => {
      const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
      const origin = request.headers.get("Origin") || "";
      const cors = corsHeaders(origin, allowed);

      if (request.method === "OPTIONS") {
        return withCorrelationHeader(new Response(null, { status: 204, headers: cors }), correlationId);
      }

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

      try {
        const methodRoutes = routes[path];
        const handler = methodRoutes?.[request.method];
        if (handler) {
          return withCorrelationHeader(await handler(request, env, url, cors), correlationId);
        }

        // Dev-only impersonation endpoint
        if (path === "/api/admin/impersonate-token" && request.method === "POST") {
          return withCorrelationHeader(
            await handleImpersonateToken(request, env, url, cors),
            correlationId,
          );
        }

        const taskIdMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
        if (taskIdMatch) {
          if (request.method === "PATCH") {
            return withCorrelationHeader(
              await handleTaskPatch(request, env, url, cors, taskIdMatch[1]),
              correlationId,
            );
          }
          if (request.method === "DELETE") {
            return withCorrelationHeader(
              await handleTaskDelete(request, env, url, cors, taskIdMatch[1]),
              correlationId,
            );
          }
        }

        const domainRead = await dispatchDomainReadById(request, env, url, cors, path);
        if (domainRead) return withCorrelationHeader(domainRead, correlationId);

        const readModel = await dispatchReadModelsById(request, env, url, cors, path);
        if (readModel) return withCorrelationHeader(readModel, correlationId);

        return withCorrelationHeader(json({ error: "Not found." }, 404, cors), correlationId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error.";
        const errStatus = (err as { status?: number }).status;
        const status = errStatus ?? (/sign-in|token|audience|issuer|expired|verified/i.test(message) ? 401 : 500);
        // NEW-2 fix: for 5xx errors, return a generic message to the client —
        // the real error may leak SQL table names, file paths, or internal
        // architecture. Log the full detail server-side; return only a
        // safe message to the caller.
        logError("request failed", { path, status, error: message });
        const clientMessage = status >= 500 ? "Internal error." : message;
        return withCorrelationHeader(json({ error: clientMessage }, status, cors), correlationId);
      }
    });
  },
};
