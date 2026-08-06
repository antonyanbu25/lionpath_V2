/** Client-side RBAC helpers — mirror Firestore security rules. */

import type { User, UserRole } from "./user";

export type ResourceType =
  | "lifecycle"
  | "prepBrief"
  | "postCall"
  | "task"
  | "team"
  | "user"
  | "scorecard"
  | "scorecardLine"
  | "scoreOverride";

export type Action =
  | "read"
  | "create"
  | "create_on_behalf"
  | "update"
  | "delete"
  | "manage_team"
  | "manage_users"
  | "manage_org_structure";

export interface ResourceContext {
  ownerId?: string;
  teamId?: string;
  orgId?: string;
  targetRole?: string;
}

/**
 * User with optional org-wide scope flag (session/UI).
 * `isOrgDirector` is true for the org director and senior managers on org.seniorLeaderIds.
 */
export type UserWithScope = User & {
  isOrgDirector?: boolean;
  isOrgLeader?: boolean;
  isActualDirector?: boolean;
  isSegmentLeader?: boolean;
  segmentId?: string | null;
  segmentTeamIds?: string[];
};

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

    case "create_on_behalf":
      if (!isManager(user.role) || !resource.ownerId || resource.ownerId === user.id) return false;
      if (resource.targetRole !== "se") return false;
      if (user.teamId && resource.teamId && user.teamId === resource.teamId) return true;
      if (user.isSegmentLeader && resource.teamId && user.segmentTeamIds?.includes(resource.teamId)) {
        return true;
      }
      if (hasOrgWideScope(user) && sameOrg(user, resource)) return true;
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

    case "manage_org_structure":
      if (isAdmin(user.role)) return true;
      if (user.isActualDirector) return true;
      if (user.isSegmentLeader) {
        if (resource.segmentId && user.segmentId && resource.segmentId !== user.segmentId) {
          return false;
        }
        if (
          resource.teamId &&
          user.segmentTeamIds?.length &&
          !user.segmentTeamIds.includes(resource.teamId)
        ) {
          return false;
        }
        return true;
      }
      return false;

    default:
      return false;
  }
}
