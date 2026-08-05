/**
 * Read-model rebuild API — debounced write-time aggregation (Node runtime).
 */

import { requireUser } from "../auth";
import type { Env } from "../env";
import { json } from "../http";
import { isNodeRuntime } from "../video/capability";
import {
  assertFirestoreAvailable,
  firestoreAdminReady,
  type FirestoreDoc,
  type FirestoreEnv,
} from "../data/firestore-admin";
import {
  rebuildReadModelsNow,
  scheduleReadModelRebuilds,
} from "../data/read-models";

function fsEnv(env: Env): FirestoreEnv {
  return env;
}

function ensureNodeFirestore(env: Env): void {
  if (!isNodeRuntime() || !firestoreAdminReady(env)) {
    throw Object.assign(new Error("Read-model rebuild requires Node runtime with Firestore admin."), {
      status: 503,
    });
  }
  assertFirestoreAvailable(env);
}

export async function handleReadModelsSchedulePost(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  ensureNodeFirestore(env);
  const verified = await requireUser(request, env);
  if (!verified) {
    return json({ error: "Sign-in required." }, 401, cors);
  }

  let body: { postCall?: Record<string, unknown>; immediate?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400, cors);
  }

  if (!body.postCall?.id) {
    return json({ error: "postCall with id is required." }, 400, cors);
  }

  const postCallDoc = body.postCall as FirestoreDoc;

  if (body.immediate) {
    await rebuildReadModelsNow(postCallDoc, fsEnv(env));
    return json({ rebuilt: true, mode: "immediate" }, 200, cors);
  }

  scheduleReadModelRebuilds(postCallDoc, fsEnv(env));
  return json({ scheduled: true, debounceMs: 60_000 }, 202, cors);
}

export async function handleReadModelGet(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
  collection: string,
  id: string,
): Promise<Response> {
  ensureNodeFirestore(env);
  const verified = await requireUser(request, env);
  if (!verified) {
    return json({ error: "Sign-in required." }, 401, cors);
  }

  const allowed = new Set(["teamMetrics", "orgMetrics", "dealTraction", "accountRollup", "seLaunchpad"]);
  if (!allowed.has(collection)) {
    return json({ error: "Unknown read-model collection." }, 404, cors);
  }

  const { getDoc } = await import("../data/firestore-admin");
  const doc = await getDoc(collection, id, fsEnv(env));
  if (!doc) return json({ error: "Not found." }, 404, cors);
  return json(doc, 200, cors);
}

export async function dispatchReadModelsById(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  path: string,
): Promise<Response | null> {
  const modelMatch = path.match(/^\/api\/read-models\/([^/]+)\/([^/]+)$/);
  if (modelMatch && request.method === "GET") {
    return handleReadModelGet(
      request,
      env,
      url,
      cors,
      decodeURIComponent(modelMatch[1]),
      decodeURIComponent(modelMatch[2]),
    );
  }
  return null;
}
