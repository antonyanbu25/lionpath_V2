/**
 * Cloud Run probes — liveness (process up) and readiness (Firestore + required env).
 */

import { getDb, firestoreAdminReady } from "../data/firestore-admin";
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
  _request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const { ready, checks } = await readinessChecks(env);
  return json({ status: ready ? "ready" : "not_ready", probe: "ready", checks }, ready ? 200 : 503, cors);
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
