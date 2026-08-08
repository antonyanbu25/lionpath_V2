/**
 * Org hierarchy — scope resolution for director → segment leader → team manager → SE.
 */

import { getStore } from "./store.js";
import { DEMO_ORG_ID, ORG_SEGMENT_DEFS, segmentIdForTeamId } from "./constants.js";
import { stableUserIdForEmail } from "./id.js";
import { effectiveSessionUserId } from "./session.js";

const FRESHWORKS_DIRECTOR_EMAIL = "vipin.thomas@freshworks.com";
/** Known org-wide leader emails for org_freshworks_se (covers usr_dummy_* vs UUID id drift). */
const FRESHWORKS_ORG_LEADER_EMAILS = new Set([
  FRESHWORKS_DIRECTOR_EMAIL,
  ...ORG_SEGMENT_DEFS.map((s) => s.leaderEmail.toLowerCase()),
  "preethi.sri@freshworks.com",
]);

function normalizeLeaderEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * @typedef {{ id: string, name: string, leaderId: string, teamIds: string[] }} OrgSegment
 */

/**
 * @param {import("./types.js").Org|null|undefined} org
 * @param {string} userId
 */
export function isOrgDirector(userId, org) {
  return !!(org && userId && org.directorId === userId);
}

/**
 * Org-wide leaders: director + senior managers on org.seniorLeaderIds.
 * @param {import("./types.js").Org|null|undefined} org
 * @param {string} userId
 */
export function isOrgLeader(userId, org) {
  if (!org || !userId) return false;
  if (org.directorId === userId) return true;
  const leaders = org.seniorLeaderIds || [];
  return leaders.includes(userId);
}

/**
 * Email fallback when authIndex resolves usr_dummy_* but org.seniorLeaderIds lists seeded UUIDs.
 * @param {string|null|undefined} email
 * @param {import("./types.js").Org|null|undefined} org
 */
export function isOrgLeaderByEmail(email, org) {
  if (!org || !email) return false;
  const norm = normalizeLeaderEmail(email);
  if (org.directorEmail && normalizeLeaderEmail(org.directorEmail) === norm) return true;
  const fromOrg = org.seniorLeaderEmails || [];
  if (fromOrg.some((e) => normalizeLeaderEmail(e) === norm)) return true;
  if (org.id === DEMO_ORG_ID && FRESHWORKS_ORG_LEADER_EMAILS.has(norm)) return true;
  return false;
}

/**
 * Org-wide leader check for session enrichment — id match first, then email fallback.
 * @param {string} userId
 * @param {import("./types.js").Org|null|undefined} org
 * @param {string|null|undefined} email
 */
export function isOrgLeaderForUser(userId, org, email, orgId) {
  if (isOrgLeader(userId, org) || isOrgLeaderByEmail(email, org)) return true;
  const oid = org?.id || orgId;
  if (!org && oid === DEMO_ORG_ID && email && FRESHWORKS_ORG_LEADER_EMAILS.has(normalizeLeaderEmail(email))) {
    return true;
  }
  return false;
}

/**
 * @param {string} userId
 * @param {import("./types.js").Org|null|undefined} org
 * @returns {OrgSegment|null}
 */
export function getSegmentForLeader(userId, org) {
  if (!org?.segments?.length || !userId) return null;
  return org.segments.find((s) => s.leaderId === userId) || null;
}

/**
 * @param {string} segmentId
 * @param {import("./types.js").Org|null|undefined} org
 * @returns {OrgSegment|null}
 */
export function getSegmentById(segmentId, org) {
  if (!org?.segments?.length || !segmentId) return null;
  return org.segments.find((s) => s.id === segmentId) || null;
}

/**
 * @param {string} teamId
 * @param {import("./types.js").Org|null|undefined} org
 * @returns {OrgSegment|null}
 */
export function getSegmentForTeamId(teamId, org) {
  if (!org?.segments?.length || !teamId) return null;
  return org.segments.find((s) => s.teamIds?.includes(teamId)) || null;
}

/**
 * @param {import("./types.js").User|null|undefined} user
 * @param {import("./types.js").Org|null|undefined} org
 */
export function userWithDirectorFlag(user, org) {
  if (!user) return null;
  const segment = getSegmentForLeader(user.id, org);
  const actualDirector = isOrgDirector(user.id, org);
  return {
    ...user,
    isOrgDirector: isOrgLeaderForUser(user.id, org, user.email, user.orgId),
    isActualDirector: actualDirector,
    isSegmentLeader: !!segment,
    segmentId: segment?.id || null,
    segmentName: segment?.name || null,
    segmentTeamIds: segment?.teamIds || [],
  };
}

/** @param {string} orgId */
export async function getOrg(orgId) {
  if (!orgId) return null;
  const store = getStore();
  return store.getOrg?.(orgId) ?? null;
}

/** @param {import("./types.js").User|null|undefined} user */
export async function resolveOrgForUser(user) {
  if (!user?.orgId) return null;
  return getOrg(user.orgId);
}

/**
 * Resolve team ids for a scope query (org-wide leaders get all teams).
 * @param {import("./types.js").Org|null|undefined} org
 * @param {string} orgId
 */
async function resolveOrgTeamIds(org, orgId) {
  const store = getStore();
  if (store.listTeamsByOrg) {
    try {
      const teams = await store.listTeamsByOrg(orgId);
      if (teams.length) return teams.map((t) => t.id);
    } catch (err) {
      console.warn("[org] listTeamsByOrg failed:", err?.message || err);
    }
  }
  return org?.teamIds || [];
}

/**
 * Visible data scope for RBAC and dashboards.
 * @param {import("./types.js").User & { isOrgDirector?: boolean, isActualDirector?: boolean, isSegmentLeader?: boolean, segmentId?: string|null, segmentName?: string|null, segmentTeamIds?: string[] }|null|undefined} user
 */
export async function getVisibleScope(user) {
  if (!user) {
    return {
      type: "own",
      teamIds: [],
      orgId: null,
      segmentId: null,
      segmentName: null,
      isOrgDirector: false,
      isSegmentLeader: false,
    };
  }

  if (user.role === "admin") {
    return {
      type: "org",
      teamIds: [],
      orgId: user.orgId || null,
      segmentId: null,
      segmentName: null,
      isOrgDirector: true,
      isSegmentLeader: false,
    };
  }

  if (user.role === "se") {
    return {
      type: "own",
      teamIds: user.teamId ? [user.teamId] : [],
      orgId: user.orgId || null,
      segmentId: user.teamId ? segmentIdForTeamId(user.teamId) : null,
      segmentName: null,
      isOrgDirector: false,
      isSegmentLeader: false,
    };
  }

  const org = await resolveOrgForUser(user);

  if (isOrgDirector(user.id, org) && user.orgId) {
    const teamIds = await resolveOrgTeamIds(org, user.orgId);
    return {
      type: "org",
      teamIds,
      orgId: user.orgId,
      segmentId: null,
      segmentName: null,
      isOrgDirector: true,
      isSegmentLeader: false,
    };
  }

  const segment = getSegmentForLeader(user.id, org);
  if (segment && user.orgId) {
    return {
      type: "segment",
      teamIds: [...(segment.teamIds || [])],
      orgId: user.orgId,
      segmentId: segment.id,
      segmentName: segment.name,
      isOrgDirector: false,
      isSegmentLeader: true,
    };
  }

  return {
    type: "team",
    teamIds: user.teamId ? [user.teamId] : [],
    orgId: user.orgId || null,
    segmentId: user.teamId ? segmentIdForTeamId(user.teamId) : null,
    segmentName: null,
    isOrgDirector: false,
    isSegmentLeader: false,
  };
}

/**
 * Collect SE emails from team member lists.
 * @param {string[]} teamIds
 */
export async function listSeEmailsForTeamIds(teamIds) {
  const store = getStore();
  const emails = [];
  const seen = new Set();
  for (const teamId of teamIds) {
    const team = await store.getTeam(teamId);
    if (!team?.memberIds?.length) continue;
    for (const memberId of team.memberIds) {
      const member = await store.getUser(memberId);
      if (member?.email && member.role === "se" && !seen.has(member.email)) {
        seen.add(member.email);
        emails.push(member.email);
      }
    }
  }
  return emails;
}

/** @param {object|null|undefined} session */
async function resolveSessionUser(session) {
  if (!session) return null;
  const store = getStore();
  const lookupId = effectiveSessionUserId(session);
  if (lookupId) {
    const byId = await store.getUser(lookupId);
    if (byId) return byId;
  }
  const email = String(session.email || "")
    .trim()
    .toLowerCase();
  if (!email) return null;
  return (
    (await store.getUserByEmail?.(email)) ||
    (await store.getUser(stableUserIdForEmail(email))) ||
    null
  );
}

/**
 * List SE member emails visible to a manager or director session user.
 * @param {object} session
 */
export async function listVisibleSeEmails(session) {
  const user = await resolveSessionUser(session);
  const org = user?.orgId ? await getOrg(user.orgId) : null;
  const enriched = userWithDirectorFlag(user, org);
  const scope = await getVisibleScope(enriched);

  if ((scope.type === "org" || scope.type === "segment") && scope.teamIds.length) {
    return listSeEmailsForTeamIds(scope.teamIds);
  }

  if (scope.type === "team" && scope.teamIds[0]) {
    return listSeEmailsForTeamIds(scope.teamIds);
  }

  return [];
}

/**
 * Map email → team name for director dashboard.
 * @param {string[]} emails
 */
export async function mapEmailToTeamName(emails) {
  const store = getStore();
  const map = new Map();
  for (const email of emails) {
    const user = await store.getUserByEmail(email);
    if (!user?.teamId) continue;
    const team = await store.getTeam(user.teamId);
    if (team?.name) map.set(email, team.name);
  }
  return map;
}

/** @param {import("./types.js").User} user @param {Map<string, import("./types.js").User>} usersById */
export function validateHierarchy(user, usersById) {
  if (!user?.managerId) return true;
  const visited = new Set([user.id]);
  let current = user.managerId;
  while (current) {
    if (visited.has(current)) return false;
    visited.add(current);
    const mgr = usersById.get(current);
    if (!mgr) break;
    current = mgr.managerId || null;
  }
  return true;
}

/**
 * Resolve the manager email recipient for an SE score dispute (audit-friendly).
 * Never throws — returns null when nothing resolves.
 *
 * Order: User.managerId (line manager) → Team.managerId → segment leader → director.
 *
 * @param {string} ownerId
 * @param {import("./types.js").Org|null|undefined} org
 * @param {Map<string, import("./types.js").User>|Record<string, import("./types.js").User>} usersById
 * @param {Map<string, import("./types.js").Team>|Record<string, import("./types.js").Team>|null|undefined} [teamsById]
 * @returns {{ email: string, name: string, via: 'line_manager'|'team_manager'|'segment_leader'|'director' }|null}
 */
export function resolveManagerRecipientForOwner(ownerId, org, usersById, teamsById) {
  try {
    if (!ownerId || !usersById) return null;
    const getUser = (id) => {
      if (!id) return null;
      if (typeof usersById.get === "function") return usersById.get(id) || null;
      return usersById[id] || null;
    };
    const getTeam = (id) => {
      if (!id || !teamsById) return null;
      if (typeof teamsById.get === "function") return teamsById.get(id) || null;
      return teamsById[id] || null;
    };
    const recipientFrom = (user, via) => {
      const email = String(user?.email || "")
        .trim()
        .toLowerCase();
      if (!email) return null;
      const name = String(user.displayName || user.name || email).trim() || email;
      return { email, name, via };
    };

    const owner = getUser(ownerId);
    if (!owner) return null;

    if (owner.managerId) {
      const lineMgr = getUser(owner.managerId);
      const hit = recipientFrom(lineMgr, "line_manager");
      if (hit) return hit;
    }

    if (owner.teamId) {
      const team = getTeam(owner.teamId);
      if (team?.managerId) {
        const teamMgr = getUser(team.managerId);
        const hit = recipientFrom(teamMgr, "team_manager");
        if (hit) return hit;
      }

      const segment = getSegmentForTeamId(owner.teamId, org);
      if (segment?.leaderId) {
        const leader = getUser(segment.leaderId);
        const hit = recipientFrom(leader, "segment_leader");
        if (hit) return hit;
      }
    }

    if (org?.directorId) {
      const director = getUser(org.directorId);
      const hit = recipientFrom(director, "director");
      if (hit) return hit;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Whether an actor may edit org structure for a target user/team.
 * @param {import("./types.js").User & { isActualDirector?: boolean, isSegmentLeader?: boolean, segmentTeamIds?: string[] }} actor
 * @param {import("./types.js").Org|null|undefined} org
 * @param {{ userId?: string, teamId?: string, fromSegmentId?: string, toSegmentId?: string }} target
 */
export function canManageOrgStructure(actor, org, target = {}) {
  if (!actor) return false;
  if (actor.role === "admin") return true;
  if (!org) return false;

  const actualDirector = isOrgDirector(actor.id, org);
  const segment = getSegmentForLeader(actor.id, org);

  if (actualDirector) return true;

  if (!segment) return false;

  if (target.toSegmentId && target.toSegmentId !== segment.id) return false;
  if (target.fromSegmentId && target.fromSegmentId !== segment.id) return false;

  if (target.teamId) {
    return segment.teamIds.includes(target.teamId);
  }

  if (target.userId) {
    const teamIds = segment.teamIds || [];
    return teamIds.some((tid) => tid === target.teamId);
  }

  return true;
}
