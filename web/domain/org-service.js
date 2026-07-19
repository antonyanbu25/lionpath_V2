/**
 * Org hierarchy — scope resolution for director → manager → SE.
 */

import { getStore } from "./store.js";

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
 * @param {import("./types.js").User|null|undefined} user
 * @param {import("./types.js").Org|null|undefined} org
 */
export function userWithDirectorFlag(user, org) {
  if (!user) return null;
  return {
    ...user,
    isOrgDirector: isOrgLeader(user.id, org),
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
 * Visible data scope for RBAC and dashboards.
 * @param {import("./types.js").User & { isOrgDirector?: boolean }|null|undefined} user
 */
export async function getVisibleScope(user) {
  if (!user) {
    return { type: "own", teamIds: [], orgId: null, isOrgDirector: false };
  }

  if (user.role === "admin") {
    return { type: "org", teamIds: [], orgId: user.orgId || null, isOrgDirector: true };
  }

  if (user.role === "se") {
    return {
      type: "own",
      teamIds: user.teamId ? [user.teamId] : [],
      orgId: user.orgId || null,
      isOrgDirector: false,
    };
  }

  const org = await resolveOrgForUser(user);
  const orgLeader = isOrgLeader(user.id, org);

  if (orgLeader && user.orgId) {
    const store = getStore();
    const teams = store.listTeamsByOrg
      ? await store.listTeamsByOrg(user.orgId)
      : [];
    const teamIds = teams.length
      ? teams.map((t) => t.id)
      : (org?.teamIds || []);
    return {
      type: "org",
      teamIds,
      orgId: user.orgId,
      isOrgDirector: true,
    };
  }

  return {
    type: "team",
    teamIds: user.teamId ? [user.teamId] : [],
    orgId: user.orgId || null,
    isOrgDirector: false,
  };
}

/**
 * List SE member emails visible to a manager or director session user.
 * @param {object} session
 */
export async function listVisibleSeEmails(session) {
  const store = getStore();
  const user = session?.userId ? await store.getUser(session.userId) : null;
  const org = user?.orgId ? await getOrg(user.orgId) : null;
  const enriched = userWithDirectorFlag(user, org);
  const scope = await getVisibleScope(enriched);

  if (scope.type === "org" && scope.teamIds.length) {
    const emails = [];
    const seen = new Set();
    for (const teamId of scope.teamIds) {
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

  if (scope.type === "team" && scope.teamIds[0]) {
    const team = await store.getTeam(scope.teamIds[0]);
    const emails = [];
    for (const memberId of team?.memberIds || []) {
      const member = await store.getUser(memberId);
      if (member?.email && member.role === "se") emails.push(member.email);
    }
    return emails;
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
