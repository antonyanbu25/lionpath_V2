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
    let teams = [];
    if (store.listTeamsByOrg) {
      try {
        teams = await store.listTeamsByOrg(user.orgId);
      } catch (err) {
        console.warn("[org] listTeamsByOrg failed:", err?.message || err);
        teams = [];
      }
    }
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

  if (user.role === "manager" && !user.teamId && !orgLeader) {
    return {
      type: "none",
      teamIds: [],
      orgId: user.orgId || null,
      isOrgDirector: false,
      reason: "manager_without_team",
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

  if (scope.type === "org" && scope.orgId && store.listUsersByOrg) {
    try {
      const users = await store.listUsersByOrg(scope.orgId);
      return users
        .filter((u) => u.role === "se" && u.email)
        .map((u) => u.email);
    } catch (err) {
      console.warn("[org] listUsersByOrg failed:", err?.message || err);
    }
  }

  if (scope.type === "org" && scope.teamIds.length && store.listUsersByOrg && scope.orgId) {
    const users = await store.listUsersByOrg(scope.orgId);
    const teamSet = new Set(scope.teamIds);
    return users
      .filter((u) => u.role === "se" && u.email && u.teamId && teamSet.has(u.teamId))
      .map((u) => u.email);
  }

  if (scope.type === "org" && scope.teamIds.length) {
    const emails = [];
    const seen = new Set();
    for (const teamId of scope.teamIds) {
      const team = await store.getTeam(teamId); // serial-ok: fallback when listUsersByOrg unavailable
      if (!team?.memberIds?.length) continue;
      const members = await Promise.all(team.memberIds.map((id) => store.getUser(id))); // serial-ok: batched per team fallback
      for (const member of members) {
        if (member?.email && member.role === "se" && !seen.has(member.email)) {
          seen.add(member.email);
          emails.push(member.email);
        }
      }
    }
    return emails;
  }

  if (scope.type === "team" && scope.teamIds[0]) {
    const teamId = scope.teamIds[0];
    if (scope.orgId && store.listUsersByOrg) {
      const users = await store.listUsersByOrg(scope.orgId);
      return users
        .filter((u) => u.role === "se" && u.teamId === teamId && u.email)
        .map((u) => u.email);
    }
    const team = await store.getTeam(teamId);
    const memberIds = team?.memberIds || [];
    if (!memberIds.length) return [];
    const members = await Promise.all(memberIds.map((id) => store.getUser(id)));
    return members.filter((m) => m?.email && m.role === "se").map((m) => m.email);
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
  const unique = [...new Set(emails.filter(Boolean))];
  if (!unique.length) return map;

  const users = await Promise.all(unique.map((email) => store.getUserByEmail(email)));
  const teamIds = [...new Set(users.map((u) => u?.teamId).filter(Boolean))];
  const teams = await Promise.all(teamIds.map((id) => store.getTeam(id)));
  const teamNameById = new Map(teams.filter(Boolean).map((t) => [t.id, t.name]));

  unique.forEach((email, i) => {
    const teamId = users[i]?.teamId;
    const name = teamId ? teamNameById.get(teamId) : null;
    if (name) map.set(email, name);
  });
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
