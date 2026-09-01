/**
 * Authenticated Firestore read API — Node runtime only.
 */

import { requireUser } from "../auth";
import type { Env } from "../env";
import { json } from "../http";
import { isNodeRuntime } from "../video/capability";
import { assertFirestoreAvailable, firestoreAdminReady, getDb, type FirestoreEnv } from "../data/firestore-admin";
import {
  canReadResource,
  assertCanReadResource,
  parseLimitParam,
  parseScopeParam,
  resolveListScope,
  resolveRequestContext,
} from "../data/scope";
import { getPostCall, getPostCallDetail } from "../data/repositories/calls";
import {
  listCallSummariesForScope,
} from "../data/repositories/call-summaries";
import { uploadCallPayload, downloadCallPayload } from "../data/call-payload-storage";
import {
  getAccount,
  getAccountSummaryByAccount,
  listAccounts,
  projectAccountListRow,
} from "../data/repositories/accounts";
import { getDealDetail, listDealsForScope } from "../data/repositories/deals";
import {
  createPostgresReadRepository,
  getPool,
  persistenceReadReady,
  resolveSqlSession,
} from "../data/persistence";

type RouteHandler = (
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
) => Promise<Response>;

function fsEnv(env: Env): FirestoreEnv {
  return env;
}

function ensureNodeFirestore(env: Env): void {
  if (!isNodeRuntime() || !firestoreAdminReady(env)) {
    throw Object.assign(new Error("Firestore read API requires Node runtime (VPS or Cloud Run)."), {
      status: 503,
    });
  }
  assertFirestoreAvailable(env);
}

async function authContext(request: Request, env: Env) {
  ensureNodeFirestore(env);
  const verified = await requireUser(request, env);
  if (!verified) {
    throw Object.assign(new Error("Sign-in required."), { status: 401 });
  }
  const ctx = await resolveRequestContext(verified, env);
  return ctx;
}

async function pgReadRepositoryFor(ctx: Awaited<ReturnType<typeof authContext>>, env: Env) {
  if (!persistenceReadReady(env)) return null;
  const session = await resolveSqlSession(ctx.authUid, env);
  if (!session) return null;
  const pool = await getPool(env);
  return createPostgresReadRepository(pool, session, env);
}

function resourceFromRow(row: Record<string, unknown>) {
  return {
    ownerId: typeof row.ownerId === "string" ? row.ownerId : undefined,
    teamId: typeof row.teamId === "string" ? row.teamId : undefined,
    orgId: typeof row.orgId === "string" ? row.orgId : undefined,
  };
}

export async function handleCallsListGet(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const ctx = await authContext(request, env);
  const scope = parseScopeParam(url.searchParams.get("scope"));
  const limit = parseLimitParam(url.searchParams.get("limit"), 200);
  const listScope = resolveListScope(ctx, scope);
  const repo = await pgReadRepositoryFor(ctx, env);
  const rows = repo
    ? await repo.listCallSummariesForScope(listScope, limit)
    : await listCallSummariesForScope(listScope, limit, fsEnv(env));
  const filtered = rows.filter((row) => canReadResource(ctx, resourceFromRow(row)));
  return json({ scope, limit, calls: filtered }, 200, cors);
}

export async function handleCallGetById(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
  id: string,
): Promise<Response> {
  const ctx = await authContext(request, env);
  const repo = await pgReadRepositoryFor(ctx, env);
  const detail = repo ? await repo.getPostCallDetail(id) : await getPostCallDetail(id, fsEnv(env));
  if (!detail) return json({ error: "Call not found." }, 404, cors);
  assertCanReadResource(ctx, resourceFromRow(detail.postCall));
  return json(detail, 200, cors);
}

export async function handleCallPayloadOffloadPost(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
  id: string,
): Promise<Response> {
  await authContext(request, env);

  let body: { analysis?: unknown; transcriptMeta?: unknown; detail?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400, cors);
  }

  const uploaded = await uploadCallPayload(id, body, fsEnv(env));
  return json(uploaded, 200, cors);
}

export async function handleCallPayloadGet(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
  id: string,
): Promise<Response> {
  const ctx = await authContext(request, env);
  const repo = await pgReadRepositoryFor(ctx, env);
  const postCall = repo
    ? await repo.getPostCallDetail(id).then((detail) => detail?.postCall ?? null)
    : await getPostCall(id, fsEnv(env));
  if (!postCall) return json({ error: "Call not found." }, 404, cors);
  assertCanReadResource(ctx, resourceFromRow(postCall));

  const payload = await downloadCallPayload(postCall, fsEnv(env));
  return json(payload, 200, cors);
}

export async function handleAccountsListGet(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const ctx = await authContext(request, env);
  const repo = await pgReadRepositoryFor(ctx, env);
  const rows = repo ? await repo.listAccounts() : await listAccounts(fsEnv(env));
  return json({ accounts: rows.map(projectAccountListRow) }, 200, cors);
}

export async function handleAccountGetById(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
  id: string,
): Promise<Response> {
  const ctx = await authContext(request, env);
  const repo = await pgReadRepositoryFor(ctx, env);
  const account = repo ? await repo.getAccount(id) : await getAccount(id, fsEnv(env));
  if (!account) return json({ error: "Account not found." }, 404, cors);
  const summary = repo ? null : await getAccountSummaryByAccount(id, fsEnv(env));
  return json({ account, summary }, 200, cors);
}

export async function handleDealsListGet(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const ctx = await authContext(request, env);
  const scope = parseScopeParam(url.searchParams.get("scope"));
  const limit = parseLimitParam(url.searchParams.get("limit"), 300);
  const listScope = resolveListScope(ctx, scope);
  const repo = await pgReadRepositoryFor(ctx, env);
  const rows = repo
    ? await repo.listDealsForScope(listScope, limit)
    : await listDealsForScope(listScope, limit, fsEnv(env));
  const filtered = rows.filter((row) => canReadResource(ctx, resourceFromRow(row)));
  return json({ scope, limit, deals: filtered }, 200, cors);
}

export async function handleDealGetById(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
  id: string,
): Promise<Response> {
  const ctx = await authContext(request, env);
  const repo = await pgReadRepositoryFor(ctx, env);
  const detail = repo ? await repo.getDealDetail(id) : await getDealDetail(id, fsEnv(env));
  if (!detail) return json({ error: "Deal not found." }, 404, cors);
  assertCanReadResource(ctx, resourceFromRow(detail.deal));
  return json(detail, 200, cors);
}

export async function handleBriefsListGet(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const ctx = await authContext(request, env);
  const userId = ctx.userId;
  const repo = await pgReadRepositoryFor(ctx, env);
  if (repo) {
    const deals = await repo.listDealsForScope({ ownerId: userId }, 300);
    const briefs = (
      await Promise.all(deals.map((deal) => repo.listPrepBriefsByLifecycle(String(deal.id || ""))))
    ).flat();
    return json({ briefs }, 200, cors);
  }
  const db = await getDb(fsEnv(env));
  const [prepsSnap, briefsSnap] = await Promise.all([
    db.collection("preps").where("uid", "==", userId).get(),
    db.collection("prepBriefs").where("ownerId", "==", userId).get(),
  ]);
  const preps = prepsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const prepBriefs = briefsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return json({ briefs: [...preps, ...prepBriefs] }, 200, cors);
}

export const domainReadRoutes: Record<string, Record<string, RouteHandler>> = {
  "/api/calls": { GET: handleCallsListGet },
  "/api/accounts": { GET: handleAccountsListGet },
  "/api/deals": { GET: handleDealsListGet },
  "/api/briefs": { GET: handleBriefsListGet },
};

export async function dispatchDomainReadById(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  path: string,
): Promise<Response | null> {
  const callMatch = path.match(/^\/api\/calls\/([^/]+)$/);
  if (callMatch && request.method === "GET") {
    return handleCallGetById(request, env, url, cors, decodeURIComponent(callMatch[1]));
  }
  const payloadMatch = path.match(/^\/api\/calls\/([^/]+)\/payload$/);
  if (payloadMatch && request.method === "GET") {
    return handleCallPayloadGet(request, env, url, cors, decodeURIComponent(payloadMatch[1]));
  }
  const offloadMatch = path.match(/^\/api\/calls\/([^/]+)\/offload-payload$/);
  if (offloadMatch && request.method === "POST") {
    return handleCallPayloadOffloadPost(request, env, url, cors, decodeURIComponent(offloadMatch[1]));
  }
  const accountMatch = path.match(/^\/api\/accounts\/([^/]+)$/);
  if (accountMatch && request.method === "GET") {
    return handleAccountGetById(request, env, url, cors, decodeURIComponent(accountMatch[1]));
  }
  const dealMatch = path.match(/^\/api\/deals\/([^/]+)$/);
  if (dealMatch && request.method === "GET") {
    return handleDealGetById(request, env, url, cors, decodeURIComponent(dealMatch[1]));
  }
  return null;
}
