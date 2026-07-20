/** Client-side RBAC helpers — mirror Firestore security rules. */

import type { User, UserRole } from "./user";

export type ResourceType =
  | "lifecycle"
  | "prepBrief"
  | "postCall"
  | "task"
  | "team"
  | "user";

export type Action =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "manage_team"
  | "manage_users";

export interface ResourceContext {
  ownerId?: string;
  teamId?: string;
  orgId?: string;
}

/**
 * User with optional org-wide scope flag (session/UI).
 * `isOrgDirector` is true for the org director and senior managers on org.seniorLeaderIds.
 */
export type UserWithScope = User & { isOrgDirector?: boolean; isOrgLeader?: boolean };

function hasOrgWideScope(user: UserWithScope): boolean {
  return user.isOrgDirector === true || user.isOrgLeader === true;
}

function sameOrg(user: UserWithScope, resource: ResourceContext): boolean {
  return !!user.orgId && !!resource.orgId && user.orgId === resource.orgId;
}

function isAdmin(role: UserRole): boolean {
  return role === "admin";
}

function isManager(role: UserRole): boolean {
  return role === "manager" || role === "admin";
}

function sameTeam(user: User, resource: ResourceContext): boolean {
  return !!user.teamId && user.teamId === resource.teamId;
}

function isOwner(user: User, resource: ResourceContext): boolean {
  return !!resource.ownerId && user.id === resource.ownerId;
}

/** Check whether a user may perform an action on a resource. */
export function can(user: UserWithScope | null, action: Action, resource: ResourceContext = {}): boolean {
  if (!user) return false;
  if (isAdmin(user.role)) return true;

  switch (action) {
    case "read":
      if (isOwner(user, resource)) return true;
      if (isManager(user.role) && hasOrgWideScope(user) && sameOrg(user, resource)) return true;
      if (isManager(user.role) && sameTeam(user, resource)) return true;
      return false;

    case "create":
    case "update":
      if (user.role === "se" && isOwner(user, resource)) return true;
      return false;

    case "delete":
      return isAdmin(user.role);

    case "manage_team":
    case "manage_users":
      return isAdmin(user.role);

    default:
      return false;
  }
}
