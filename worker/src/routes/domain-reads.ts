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
  assertCanWriteResource,
  type RequestContext,
} from "../data/scope";
import type { FirestoreDoc } from "../data/firestore-admin";
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
  findAccountsByDomain,
  findAccountBySlug,
} from "../data/repositories/accounts";
import { getDealDetail, listDealsByAccount, listDealsForScope } from "../data/repositories/deals";
import {
  createPostgresReadRepository,
  getPool,
  persistenceReadReady,
  postgresReady,
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
  const session = await resolveSqlSession(ctx.authUid, env, ctx.email);
  if (!session) return null;
  const pool = await getPool(env);
  return createPostgresReadRepository(pool, session, env);
}

// Contacts have no Firestore-backed repository fallback (none was ever built),
// and PERSISTENCE_READ_MODE is a global "everything reads from Postgres" toggle
// that hasn't been flipped on staging yet -- gating contacts on it would mean
// this stays Firestore-only indefinitely. Contact reads use Postgres directly
// whenever it's configured, independent of that toggle: contacts are only
// ever written via the SQL-backed createContact/updateContact path (see
// ADMIN_WRITE_METHODS in api-store.js), so Postgres is always the current
// data for them regardless of PERSISTENCE_READ_MODE.
async function pgContactsRepositoryFor(ctx: Awaited<ReturnType<typeof authContext>>, env: Env) {
  if (!postgresReady(env)) return null;
  const session = await resolveSqlSession(ctx.authUid, env, ctx.email);
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

/** Filter account rows to those readable by the authenticated request context (Firestore list fallback). */
export function filterAccountsForReader(ctx: RequestContext, rows: FirestoreDoc[]): FirestoreDoc[] {
  return rows.filter((row) => canReadResource(ctx, resourceFromRow(row)));
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
  const ctx = await authContext(request, env);

  let body: { analysis?: unknown; transcriptMeta?: unknown; detail?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400, cors);
  }

  // astra-audit F-004: this handler authenticated but never authorised. The
  // authContext() result was discarded and the call was never loaded, so any
  // signed-in user could overwrite the offloaded payload of ANY call id — a
  // cross-tenant destructive write. Its GET sibling below has always loaded the
  // row and asserted scope; only the write path was missing the check.
  //
  // Write scope is owner-or-admin (assertCanWriteResource), not the read scope
  // the GET uses: a manager may read a team member's call but must not overwrite
  // its analysis payload. Absent and unauthorised both yield 404 so the response
  // cannot be used to prove an id exists.
  const repo = await pgReadRepositoryFor(ctx, env);
  const postCall = repo
    ? await repo.getPostCallDetail(id).then((detail) => detail?.postCall ?? null)
    : await getPostCall(id, fsEnv(env));
  if (!postCall) return json({ error: "Not found." }, 404, cors);
  assertCanWriteResource(ctx, resourceFromRow(postCall));

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
  url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const ctx = await authContext(request, env);
  const repo = await pgReadRepositoryFor(ctx, env);
  const domain = url.searchParams.get("domain")?.trim().toLowerCase();
  const slug = url.searchParams.get("slug")?.trim();
  const nameQuery = url.searchParams.get("name")?.trim();
  if (domain) {
    const rows = repo
      ? await repo.findAccountsByDomain(domain)
      : await findAccountsByDomain(domain, fsEnv(env));
    const filtered = rows.filter((row) => canReadResource(ctx, resourceFromRow(row)));
    return json({ domain, accounts: filtered.map(projectAccountListRow) }, 200, cors);
  }
  if (slug) {
    const one = repo
      ? await repo.findAccountBySlug(slug)
      : await findAccountBySlug(slug, fsEnv(env));
    const rows = one ? [one] : [];
    const filtered = rows.filter((row) => canReadResource(ctx, resourceFromRow(row)));
    return json({ slug, accounts: filtered.map(projectAccountListRow) }, 200, cors);
  }
  if (nameQuery) {
    const rows = repo
      ? await repo.findAccountsByName(nameQuery)
      : (await listAccounts(fsEnv(env))).filter(
          (a) => String(a.name || "").trim().toLowerCase() === nameQuery.toLowerCase(),
        );
    const filtered = rows.filter((row) => canReadResource(ctx, resourceFromRow(row)));
    return json({ name: nameQuery, accounts: filtered.map(projectAccountListRow) }, 200, cors);
  }
  const rows = repo
    ? await repo.listAccounts()
    : filterAccountsForReader(ctx, await listAccounts(fsEnv(env)));
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
  assertCanReadResource(ctx, resourceFromRow(account));
  const summary = repo ? null : await getAccountSummaryByAccount(id, fsEnv(env));
  return json({ account, summary }, 200, cors);
}

export async function handleAccountDealsListGet(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
  accountId: string,
): Promise<Response> {
  const ctx = await authContext(request, env);
  const repo = await pgReadRepositoryFor(ctx, env);
  const account = repo ? await repo.getAccount(accountId) : await getAccount(accountId, fsEnv(env));
  if (!account) return json({ error: "Account not found." }, 404, cors);
  if (!canReadResource(ctx, resourceFromRow(account))) {
    return json({ error: "Forbidden." }, 403, cors);
  }
  const rows = repo
    ? await repo.listDealsByAccount(accountId)
    : await listDealsByAccount(accountId, undefined, fsEnv(env));
  const filtered = rows.filter((row) => canReadResource(ctx, resourceFromRow(row)));
  return json({ accountId, deals: filtered }, 200, cors);
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

export async function handleAccountCallsGet(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  accountId: string,
): Promise<Response> {
  const ctx = await authContext(request, env);
  const repo = await pgReadRepositoryFor(ctx, env);
  if (!repo) return json({ error: "Postgres is not configured for call reads." }, 503, cors);
  const limit = parseLimitParam(url.searchParams.get("limit"), 80);
  const calls = await repo.listCallSummariesByAccount(accountId, limit);
  return json({ calls }, 200, cors);
}

export async function handleDealCallsGet(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  dealId: string,
): Promise<Response> {
  const ctx = await authContext(request, env);
  const repo = await pgReadRepositoryFor(ctx, env);
  if (!repo) return json({ error: "Postgres is not configured for call reads." }, 503, cors);
  const limit = parseLimitParam(url.searchParams.get("limit"), 50);
  const calls = await repo.listCallSummariesByDeal(dealId, limit);
  return json({ calls }, 200, cors);
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

/**
 * GET /api/users/me — self-only, Postgres-backed. api-store.js (the SE/no-
 * Firestore-delegate read path) never implemented getUserByEmail/getUser/
 * getUserIdByAuthUid at all, so enrichSessionFromStore (user-resolve.js)
 * silently failed for every SE session and session.userId never got set to
 * their real app_user id -- everything downstream fell back to the
 * usr_dummy_<email> placeholder, which is what the "id_registry: no mapping
 * for app_user/usr_dummy_..." errors throughout staging trace back to. This
 * is deliberately self-only (resolved from the caller's own verified
 * identity, never an arbitrary id/email) so it can't become a cross-user
 * lookup endpoint.
 */
export async function handleUsersMeGet(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const verified = await requireUser(request, env);
  if (!verified) return json({ error: "Sign-in required." }, 401, cors);
  if (!postgresReady(env)) return json({ error: "Postgres is not configured." }, 503, cors);
  const session = await resolveSqlSession(verified.uid, env, verified.email);
  if (!session) return json({ error: "User not found." }, 404, cors);
  const pool = await getPool(env);
  const res = await pool.query(
    `SELECT u.public_id, u.email, u.display_name, u.job_title, u.org_unit_id,
            COALESCE(vr.role_name, 'se') AS role,
            split_part(trim(both '/' from COALESCE(ou.path, '')), '/', 1) AS org_id
       FROM app_user u
       LEFT JOIN org_unit ou ON ou.id = u.org_unit_id
       LEFT JOIN v_user_current_role vr ON vr.user_id = u.id
      WHERE u.id = $1
      ORDER BY (vr.role_name = 'admin') DESC
      LIMIT 1`,
    [session.userId],
  );
  const row = res.rows[0] as
    | { public_id: string; email: string; display_name: string | null; job_title: string | null; org_unit_id: string | null; role: string; org_id: string | null }
    | undefined;
  if (!row) return json({ error: "User not found." }, 404, cors);
  return json(
    {
      id: row.public_id,
      email: row.email,
      displayName: row.display_name,
      jobTitle: row.job_title,
      teamId: row.org_unit_id,
      orgId: row.org_id || null,
      role: row.role,
      authUid: verified.uid,
    },
    200,
    cors,
  );
}

export async function handleAccountContactsGet(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  accountId: string,
): Promise<Response> {
  const ctx = await authContext(request, env);
  const repo = await pgContactsRepositoryFor(ctx, env);
  if (!repo) return json({ error: "Postgres is not configured for contact reads." }, 503, cors);
  const email = url.searchParams.get("email");
  if (email) {
    const contact = await repo.findContactByAccountEmail(accountId, email);
    return json({ contact }, 200, cors);
  }
  const contacts = await repo.listContactsByAccount(accountId);
  return json({ contacts }, 200, cors);
}

export async function handleContactsByEmailGet(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const ctx = await authContext(request, env);
  const email = url.searchParams.get("email");
  if (!email) return json({ error: "email is required." }, 400, cors);
  const repo = await pgContactsRepositoryFor(ctx, env);
  if (!repo) return json({ error: "Postgres is not configured for contact reads." }, 503, cors);
  const contacts = await repo.findContactsByEmail(email);
  return json({ contacts }, 200, cors);
}

export const domainReadRoutes: Record<string, Record<string, RouteHandler>> = {
  "/api/calls": { GET: handleCallsListGet },
  "/api/accounts": { GET: handleAccountsListGet },
  "/api/deals": { GET: handleDealsListGet },
  "/api/briefs": { GET: handleBriefsListGet },
  "/api/contacts": { GET: handleContactsByEmailGet },
  "/api/users/me": { GET: handleUsersMeGet },
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
  const accountContactsMatch = path.match(/^\/api\/accounts\/([^/]+)\/contacts$/);
  if (accountContactsMatch && request.method === "GET") {
    return handleAccountContactsGet(request, env, url, cors, decodeURIComponent(accountContactsMatch[1]));
  }
  const accountCallsMatch = path.match(/^\/api\/accounts\/([^/]+)\/calls$/);
  if (accountCallsMatch && request.method === "GET") {
    return handleAccountCallsGet(request, env, url, cors, decodeURIComponent(accountCallsMatch[1]));
  }
  const accountDealsMatch = path.match(/^\/api\/accounts\/([^/]+)\/deals$/);
  if (accountDealsMatch && request.method === "GET") {
    return handleAccountDealsListGet(request, env, url, cors, decodeURIComponent(accountDealsMatch[1]));
  }
  const accountMatch = path.match(/^\/api\/accounts\/([^/]+)$/);
  if (accountMatch && request.method === "GET") {
    return handleAccountGetById(request, env, url, cors, decodeURIComponent(accountMatch[1]));
  }
  const dealCallsMatch = path.match(/^\/api\/deals\/([^/]+)\/calls$/);
  if (dealCallsMatch && request.method === "GET") {
    return handleDealCallsGet(request, env, url, cors, decodeURIComponent(dealCallsMatch[1]));
  }
  const dealMatch = path.match(/^\/api\/deals\/([^/]+)$/);
  if (dealMatch && request.method === "GET") {
    return handleDealGetById(request, env, url, cors, decodeURIComponent(dealMatch[1]));
  }
  return null;
}
