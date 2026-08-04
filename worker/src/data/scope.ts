/**
 * Server-side request context and resource scoping — mirrors firestore.rules canReadTeamResource.
 */

import type { VerifiedUser } from "../auth";
import type { Env } from "../env";
import { cachedGetDoc, cachedQuery } from "./cache";
import { getDoc, type FirestoreEnv } from "./firestore-admin";

export type UserRole = "se" | "manager" | "admin" | "pm";

export interface RequestContext {
  authUid: string;
  email: string;
  userId: string;
  role: UserRole;
  teamId: string | null;
  orgId: string | null;
  isOrgLeader: boolean;
}

export interface ResourceScope {
  ownerId?: string;
  teamId?: string;
  orgId?: string;
}

export type ListScope = "own" | "team" | "org";

function isManagerRole(role: UserRole): boolean {
  return role === "manager" || role === "admin";
}

function isAdmin(role: UserRole): boolean {
  return role === "admin";
}

async function loadOrgLeaderIds(orgId: string, env?: FirestoreEnv): Promise<{
  directorId?: string;
  seniorLeaderIds?: string[];
}> {
  const org = await cachedGetDoc("orgs", orgId, () => getDoc("orgs", orgId, env));
  if (!org) return {};
  return {
    directorId: typeof org.directorId === "string" ? org.directorId : undefined,
    seniorLeaderIds: Array.isArray(org.seniorLeaderIds)
      ? (org.seniorLeaderIds as string[])
      : undefined,
  };
}

function computeIsOrgLeader(
  userId: string,
  role: UserRole,
  orgId: string | null,
  orgMeta: { directorId?: string; seniorLeaderIds?: string[] },
): boolean {
  if (!isManagerRole(role) || !orgId) return false;
  if (orgMeta.directorId === userId) return true;
  return (orgMeta.seniorLeaderIds || []).includes(userId);
}

export async function resolveRequestContext(
  verified: VerifiedUser,
  env?: Pick<Env, "FIREBASE_PROJECT_ID" | "FIREBASE_SERVICE_ACCOUNT_JSON">,
): Promise<RequestContext> {
  const fsEnv = env as FirestoreEnv;
  const authIndex = await cachedGetDoc("authIndex", verified.uid, () =>
    getDoc("authIndex", verified.uid, fsEnv),
  );
  const userId = typeof authIndex?.userId === "string" ? authIndex.userId : "";
  if (!userId) {
    throw Object.assign(new Error("User profile not linked (authIndex missing)."), { status: 403 });
  }

  const user = await cachedGetDoc("users", userId, () => getDoc("users", userId, fsEnv));
  if (!user) {
    throw Object.assign(new Error("User profile not found."), { status: 403 });
  }

  const role = (typeof user.role === "string" ? user.role : "se") as UserRole;
  const teamId = typeof user.teamId === "string" ? user.teamId : null;
  const orgId = typeof user.orgId === "string" ? user.orgId : null;

  let isOrgLeader = false;
  if (orgId && isManagerRole(role)) {
    const orgMeta = await cachedQuery("orgs", { leaderCheck: orgId, userId }, () =>
      loadOrgLeaderIds(orgId, fsEnv),
    );
    isOrgLeader = computeIsOrgLeader(userId, role, orgId, orgMeta);
  }

  return {
    authUid: verified.uid,
    email: verified.email,
    userId,
    role,
    teamId,
    orgId,
    isOrgLeader,
  };
}

/** Port of firestore.rules canReadTeamResource. */
export function canReadResource(ctx: RequestContext, resource: ResourceScope): boolean {
  if (isAdmin(ctx.role)) return true;
  if (resource.ownerId && resource.ownerId === ctx.userId) return true;
  if (isManagerRole(ctx.role) && resource.teamId && ctx.teamId && resource.teamId === ctx.teamId) {
    return true;
  }
  if (
    isManagerRole(ctx.role) &&
    ctx.isOrgLeader &&
    resource.orgId &&
    ctx.orgId &&
    resource.orgId === ctx.orgId
  ) {
    return true;
  }
  return false;
}

export function assertCanReadResource(ctx: RequestContext, resource: ResourceScope): void {
  if (!canReadResource(ctx, resource)) {
    throw Object.assign(new Error("Forbidden."), { status: 403 });
  }
}

export function resolveListScope(ctx: RequestContext, requested: ListScope): ResourceScope {
  if (requested === "own") {
    return { ownerId: ctx.userId };
  }
  if (requested === "team") {
    if (ctx.role === "se") {
      throw Object.assign(new Error("SE users may only use scope=own."), { status: 403 });
    }
    if (!ctx.teamId) {
      throw Object.assign(new Error("User has no teamId."), { status: 403 });
    }
    return { teamId: ctx.teamId };
  }
  if (requested === "org") {
    if (ctx.role === "se") {
      throw Object.assign(new Error("SE users may only use scope=own."), { status: 403 });
    }
    if (!isManagerRole(ctx.role)) {
      throw Object.assign(new Error("Org scope requires manager role."), { status: 403 });
    }
    if (!ctx.isOrgLeader && !isAdmin(ctx.role)) {
      throw Object.assign(new Error("Org scope requires director or org leader."), { status: 403 });
    }
    if (!ctx.orgId) {
      throw Object.assign(new Error("User has no orgId."), { status: 403 });
    }
    return { orgId: ctx.orgId };
  }
  throw Object.assign(new Error("Invalid scope."), { status: 400 });
}

export function parseScopeParam(raw: string | null): ListScope {
  const scope = (raw || "own").trim().toLowerCase();
  if (scope === "own" || scope === "team" || scope === "org") return scope;
  throw Object.assign(new Error("scope must be own, team, or org."), { status: 400 });
}

export function parseLimitParam(raw: string | null, fallback: number, max = 500): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw Object.assign(new Error("limit must be a positive integer."), { status: 400 });
  }
  return Math.min(n, max);
}
