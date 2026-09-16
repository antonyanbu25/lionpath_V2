/**
 * Org structure load/save — local store (dev) or worker API (Firestore production).
 */

import { getStore } from "./store.js";
import { firebaseConfig } from "../firebase-config.js";
import { can } from "./types.js";
import { now } from "./types.js";
import {
  getOrg,
  getSegmentForLeader,
  getSegmentForTeamId,
  isOrgDirector,
  validateHierarchy,
  userWithDirectorFlag,
} from "./org-service.js";
import { sessionToUser } from "./rbac.js";
import { ORG_SEGMENT_DEFS, teamDisplayName } from "./constants.js";
import { stableUserIdForEmail } from "./id.js";

const WORKER_BASE =
  typeof window !== "undefined" && window.__WORKER_BASE_URL__
    ? window.__WORKER_BASE_URL__
    : "";

/**
 * @param {object} session
 */
function actorFromSession(session) {
  const user = sessionToUser(session);
  if (!user) return null;
  return {
    ...user,
    isActualDirector: session.isActualDirector === true,
    isSegmentLeader: session.isSegmentLeader === true,
    segmentId: session.segmentId || null,
    segmentTeamIds: session.segmentTeamIds || [],
  };
}

/**
 * @param {object} session
 * @param {import("./types.js").Org|null} org
 */
function visibleSegments(session, org) {
  if (!org?.segments?.length) {
    return ORG_SEGMENT_DEFS.map((def) => ({
      id: def.id,
      name: def.name,
      leaderId: stableUserIdForEmail(def.leaderEmail),
      teamIds: [...def.teamIds],
    }));
  }
  const actor = actorFromSession(session);
  if (!actor) return [];
  if (actor.isActualDirector || actor.role === "admin") return org.segments;
  const seg = getSegmentForLeader(actor.id, org);
  return seg ? [seg] : [];
}

/**
 * @param {object} session
 */
export async function loadOrgStructure(session) {
  if (firebaseConfig.projectId && WORKER_BASE) {
    try {
      const token = session?.authToken || session?.idToken;
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${WORKER_BASE}/api/org/structure`, { headers });
      if (res.ok) return res.json();
    } catch (err) {
      console.warn("[org-structure] worker GET failed, falling back to store:", err?.message || err);
    }
  }

  const store = getStore();
  const org = session?.orgId ? await getOrg(session.orgId) : null;
  if (!org) return { segments: [] };

  const segments = visibleSegments(session, org);
  const users = org.id && store.listUsersByOrg ? await store.listUsersByOrg(org.id) : [];
  const usersById = new Map(users.map((u) => [u.id, u]));
  const teamsById = new Map();
  for (const seg of segments) {
    for (const teamId of seg.teamIds || []) {
      if (!teamsById.has(teamId)) {
        teamsById.set(teamId, await store.getTeam(teamId));
      }
    }
  }

  const tree = segments.map((seg) => {
    const leader = usersById.get(seg.leaderId);
    const teams = (seg.teamIds || []).map((teamId) => {
      const team = teamsById.get(teamId);
      const managerUser = team?.managerId ? usersById.get(team.managerId) : null;
      const manager =
        managerUser && managerUser.teamId === teamId
          ? {
              id: managerUser.id,
              email: managerUser.email,
              displayName: managerUser.displayName,
            }
          : null;
      const ics = (team?.memberIds || [])
        .map((id) => usersById.get(id))
        .filter((u) => u && (u.role === "se" || u.role === "admin"))
        .map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          managerId: u.managerId,
          teamId: u.teamId,
        }));
      return {
        id: teamId,
        name: team?.name || teamDisplayName(teamId) || teamId,
        manager: manager
          ? { id: manager.id, email: manager.email, displayName: manager.displayName }
          : null,
        ics,
      };
    });
    return {
      id: seg.id,
      name: seg.name,
      leader: leader
        ? { id: leader.id, email: leader.email, displayName: leader.displayName }
        : null,
      teams,
    };
  });

  return {
    orgId: org.id,
    canCrossSegment: actorFromSession(session)?.isActualDirector === true,
    segments: tree,
  };
}

/**
 * @typedef {{ userId: string, managerId: string, teamId: string, fromSegmentId?: string, toSegmentId?: string }} StructureChange
 */

/**
 * @param {object} session
 * @param {StructureChange[]} changes
 */
export async function saveOrgStructureReassignments(session, changes) {
  if (!changes?.length) return { ok: true, updated: 0 };

  const store = getStore();
  const org = session?.orgId ? await getOrg(session.orgId) : null;
  const actor = actorFromSession(session);
  if (!actor || !org) throw new Error("Not signed in or org missing.");

  const users = store.listUsersByOrg ? await store.listUsersByOrg(org.id) : [];
  const usersById = new Map(users.map((u) => [u.id, u]));

  for (const change of changes) {
    const target = usersById.get(change.userId);
    if (!target) throw new Error(`Unknown user ${change.userId}`);

    const fromSeg = getSegmentForTeamId(target.teamId, org);
    const toSeg = getSegmentForTeamId(change.teamId, org);
    const fromSegmentId = change.fromSegmentId || fromSeg?.id || null;
    const toSegmentId = change.toSegmentId || toSeg?.id || null;

    if (toSegmentId && fromSegmentId && toSegmentId !== fromSegmentId && !actor.isActualDirector) {
      throw new Error("Cross-segment moves require director access.");
    }

    if (
      !can(actor, "manage_org_structure", {
        teamId: change.teamId,
        segmentId: toSegmentId || fromSegmentId,
        orgId: org.id,
      })
    ) {
      throw new Error("Not allowed to edit structure in this segment.");
    }

    const mgr = usersById.get(change.managerId);
    if (!mgr || mgr.role !== "manager") throw new Error("Invalid manager.");

    const team = await store.getTeam(change.teamId);
    const teamManagerId = team?.managerId || null;
    const teamManager = teamManagerId ? usersById.get(teamManagerId) : null;
    const hasTeamManager = !!(teamManager && teamManager.teamId === change.teamId);

    if (hasTeamManager) {
      if (mgr.teamId !== change.teamId) throw new Error("Manager must belong to target team.");
    } else {
      const seg = getSegmentForTeamId(change.teamId, org);
      if (!seg || seg.leaderId !== change.managerId) {
        throw new Error("Flat teams must report to the segment leader.");
      }
    }

    const nextUser = { ...target, managerId: change.managerId, teamId: change.teamId };
    if (!validateHierarchy(nextUser, usersById)) throw new Error("Hierarchy cycle detected.");
  }

  if (firebaseConfig.projectId && WORKER_BASE) {
    try {
      const token = session?.authToken || session?.idToken;
      const res = await fetch(`${WORKER_BASE}/api/org/structure`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ changes }),
      });
      if (res.ok) return res.json();
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Save failed (${res.status})`);
    } catch (err) {
      if (!firebaseConfig.projectId) throw err;
      console.warn("[org-structure] worker PATCH failed, falling back to store:", err?.message || err);
    }
  }

  const ts = now();
  const teamMemberPatch = new Map();

  for (const change of changes) {
    const target = usersById.get(change.userId);
    const prevTeamId = target.teamId;
    await store.upsertUser({
      ...target,
      managerId: change.managerId,
      teamId: change.teamId,
      updatedAt: ts,
    });

    if (prevTeamId && prevTeamId !== change.teamId) {
      const prevTeam = await store.getTeam(prevTeamId);
      if (prevTeam) {
        const memberIds = (prevTeam.memberIds || []).filter((id) => id !== change.userId);
        await store.upsertTeam({ ...prevTeam, memberIds, updatedAt: ts });
      }
    }

    const list = teamMemberPatch.get(change.teamId) || [];
    list.push(change.userId);
    teamMemberPatch.set(change.teamId, list);
  }

  for (const [teamId, addIds] of teamMemberPatch) {
    const team = await store.getTeam(teamId);
    if (!team) continue;
    const memberIds = [...new Set([...(team.memberIds || []), ...addIds])];
    await store.upsertTeam({ ...team, memberIds, updatedAt: ts });
  }

  return { ok: true, updated: changes.length };
}

/**
 * @param {object} session
 */
export function canEditOrgStructure(session) {
  const actor = actorFromSession(session);
  if (!actor) return false;
  return can(actor, "manage_org_structure", { orgId: session.orgId });
}
