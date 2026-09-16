/**
 * Cloud Run probes — liveness (process up) and readiness (Firestore + required env).
 *
 * NEW-5 fix: the readiness endpoint used to return internal config details
 * (missing env vars, Firestore error messages) to any unauthenticated
 * caller. Now returns only {status} to unauthenticated callers; includes
 * `checks` detail only when the caller is authenticated as admin or the
 * request is from 127.0.0.1 (Cloud Run health check).
 */

import { getDb, firestoreAdminReady } from "../data/firestore-admin";
import { requireUser } from "../auth";
import { resolveRequestContext } from "../data/scope";
import type { Env } from "../env";
import { json } from "../http";
import { isNodeRuntime } from "../video/capability";

type RouteHandler = (
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
) => Promise<Response>;

function missingRequiredEnv(env: Env): string[] {
  const missing: string[] = [];
  if (!(env.FIREBASE_PROJECT_ID || "").trim()) {
    missing.push("FIREBASE_PROJECT_ID");
  }
  const hasLlm =
    !!(env.GEMINI_API_KEY || "").trim() ||
    !!(env.GOOGLE_CLOUD_PROJECT || env.VERTEX_PROJECT || "").trim();
  if (!hasLlm) {
    missing.push("GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT");
  }
  return missing;
}

async function readinessChecks(env: Env): Promise<{
  ready: boolean;
  checks: Record<string, string>;
}> {
  const checks: Record<string, string> = {};
  const missing = missingRequiredEnv(env);
  checks.env = missing.length ? `missing: ${missing.join(", ")}` : "ok";

  if (!isNodeRuntime()) {
    checks.firestore = "skipped (non-Node runtime)";
    return { ready: missing.length === 0, checks };
  }

  if (!firestoreAdminReady(env)) {
    checks.firestore = "FIREBASE_PROJECT_ID not configured";
    return { ready: false, checks };
  }

  try {
    const db = await getDb(env);
    await db.collection("_health").doc("probe").get();
    checks.firestore = "ok";
  } catch (err) {
    checks.firestore = err instanceof Error ? err.message : String(err);
  }

  const ready = missing.length === 0 && checks.firestore === "ok";
  return { ready, checks };
}

/** True when the request is a local health probe (Cloud Run / 127.0.0.1). */
function isLocalProbe(request: Request): boolean {
  const xri = request.headers.get("X-Real-IP");
  if (xri === "127.0.0.1" || xri === "::1") return true;
  const xff = request.headers.get("X-Forwarded-For");
  if (xff && xff.split(",")[0]?.trim() === "127.0.0.1") return true;
  return false;
}

/** GET /api/health/live — process is up (no dependency checks). */
export async function handleHealthLive(
  _request: Request,
  _env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  return json({ status: "ok", probe: "live" }, 200, cors);
}

/** GET /api/health/ready — Firestore reachable and required env present. */
export async function handleHealthReady(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const { ready, checks } = await readinessChecks(env);
  // NEW-5 fix: only return detailed checks to authenticated admins or local
  // probes (Cloud Run health check from 127.0.0.1). Unauthenticated callers
  // get only {status} — no env names, no Firestore error messages.
  const includeChecks = await shouldIncludeChecks(request, env);
  const body = includeChecks
    ? { status: ready ? "ready" : "not_ready", probe: "ready", checks }
    : { status: ready ? "ready" : "not_ready", probe: "ready" };
  return json(body, ready ? 200 : 503, cors);
}

/**
 * Decide whether the caller may see the detailed `checks` payload.
 * Trusted sources: a local health probe (Cloud Run / 127.0.0.1) OR an
 * authenticated admin. Everyone else gets only the coarse {status}.
 *
 * Auth resolution is best-effort: any failure (missing token, unverified
 * token, profile not found, non-admin role) returns false and falls through
 * to the redacted response. We never reject the health probe itself — a
 * readiness check must not 401 the prober.
 */
async function shouldIncludeChecks(request: Request, env: Env): Promise<boolean> {
  if (isLocalProbe(request)) return true;
  try {
    const verified = await requireUser(request, env);
    if (!verified) return false;
    const ctx = await resolveRequestContext(verified, env);
    return ctx.role === "admin";
  } catch {
    return false;
  }
}

/** GET /api/health — readiness probe (used by deploy verify curl). */
export async function handleHealth(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  return handleHealthReady(request, env, url, cors);
}

export const healthRoutes: Record<string, Record<string, RouteHandler>> = {
  "/api/health": { GET: handleHealth, HEAD: handleHealth },
  "/api/health/live": { GET: handleHealthLive, HEAD: handleHealthLive },
  "/api/health/ready": { GET: handleHealthReady, HEAD: handleHealthReady },
};
