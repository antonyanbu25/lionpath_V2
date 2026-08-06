/** Worker handlers for GET/PATCH /api/org/structure (Node + firebase-admin when available). */

import type { Env } from "./env";
import { json } from "./http";
import { requireUser } from "./auth";
import { isNodeRuntime } from "./video/capability";

export interface StructureChange {
  userId: string;
  managerId: string;
  teamId: string;
  fromSegmentId?: string;
  toSegmentId?: string;
}

async function loadFirestore() {
  if (!isNodeRuntime()) return null;
  try {
    const mod = await import("firebase-admin");
    const admin = mod.default ?? mod;
    if (!admin.apps?.length) {
      const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "";
      admin.initializeApp(projectId ? { projectId } : undefined);
    }
    return admin.firestore();
  } catch {
    return null;
  }
}

function segmentForTeam(
  org: { segments?: { id: string; leaderId: string; teamIds: string[]; name: string }[] },
  teamId: string,
) {
  return (org.segments || []).find((s) => s.teamIds?.includes(teamId)) || null;
}

function segmentForLeader(
  org: { segments?: { id: string; leaderId: string; teamIds: string[]; name: string }[] },
  userId: string,
) {
  return (org.segments || []).find((s) => s.leaderId === userId) || null;
}

function canEditStructure(
  actor: { id: string; role: string; orgId?: string | null },
  org: { directorId?: string; segments?: { id: string; leaderId: string; teamIds: string[] }[] },
  change: StructureChange,
) {
  if (actor.role === "admin") return true;
  if (org.directorId === actor.id) return true;
  const seg = segmentForLeader(org, actor.id);
  if (!seg) return false;
  const fromSeg = change.fromSegmentId || segmentForTeam(org, change.teamId)?.id;
  const toSeg = change.toSegmentId || segmentForTeam(org, change.teamId)?.id;
  if (fromSeg && fromSeg !== seg.id) return false;
  if (toSeg && toSeg !== seg.id) return false;
  return seg.teamIds.includes(change.teamId);
}

export async function handleOrgStructureGet(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env);
  const db = await loadFirestore();
  if (!db) {
    return json(
      { error: "Org structure API requires Node runtime with firebase-admin.", useClientStore: true },
      503,
      cors,
    );
  }

  const orgId = process.env.DEFAULT_ORG_ID || "org_freshworks_se";
  const orgSnap = await db.collection("orgs").doc(orgId).get();
  if (!orgSnap.exists) return json({ segments: [] }, 200, cors);
  const org = orgSnap.data() as {
    id: string;
    segments?: { id: string; name: string; leaderId: string; teamIds: string[] }[];
  };

  const usersSnap = await db.collection("users").where("orgId", "==", orgId).get();
  const usersById = new Map(usersSnap.docs.map((d) => [d.id, d.data()]));

  const segments = (org.segments || []).map((seg) => {
    const teamIds = seg.teamIds || [];
    return { seg, teamIds };
  });

  const tree = [];
  for (const { seg, teamIds } of segments) {
    const leader = usersById.get(seg.leaderId);
    const teamRows = [];
    for (const teamId of teamIds) {
      const teamSnap = await db.collection("teams").doc(teamId).get();
      const team = teamSnap.data() || {};
      const manager = team.managerId ? usersById.get(String(team.managerId)) : null;
      const ics = (team.memberIds || [])
        .map((id: string) => usersById.get(id))
        .filter((u) => u && (u.role === "se" || u.role === "admin"))
        .map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          managerId: u.managerId,
          teamId: u.teamId,
        }));
      teamRows.push({
        id: teamId,
        name: team.name || teamId,
        manager: manager
          ? { id: manager.id, email: manager.email, displayName: manager.displayName }
          : null,
        ics,
      });
    }
    tree.push({
      id: seg.id,
      name: seg.name,
      leader: leader
        ? { id: leader.id, email: leader.email, displayName: leader.displayName }
        : null,
      teams: teamRows,
    });
  }

  return json({ orgId, canCrossSegment: true, segments: tree }, 200, cors);
}

export async function handleOrgStructurePatch(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const verified = await requireUser(request, env);
  const db = await loadFirestore();
  if (!db) {
    return json(
      { error: "Org structure API requires Node runtime with firebase-admin.", useClientStore: true },
      503,
      cors,
    );
  }

  const body = (await request.json()) as { changes?: StructureChange[] };
  const changes = body.changes || [];
  if (!changes.length) return json({ ok: true, updated: 0 }, 200, cors);

  const orgId = process.env.DEFAULT_ORG_ID || "org_freshworks_se";
  const orgSnap = await db.collection("orgs").doc(orgId).get();
  const org = orgSnap.data() || {};

  const actorSnap = await db.collection("users").where("email", "==", verified.email).limit(1).get();
  const actor = actorSnap.empty ? null : actorSnap.docs[0].data();
  if (!actor) return json({ error: "User profile not found." }, 403, cors);

  const ts = new Date().toISOString();
  for (const change of changes) {
    if (!canEditStructure(actor, org, change)) {
      return json({ error: "Not allowed to edit structure in this scope." }, 403, cors);
    }
    const userRef = db.collection("users").doc(change.userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return json({ error: `Unknown user ${change.userId}` }, 400, cors);
    const prev = userSnap.data() || {};
    const prevTeamId = prev.teamId;

    await userRef.set(
      { managerId: change.managerId, teamId: change.teamId, updatedAt: ts },
      { merge: true },
    );

    if (prevTeamId && prevTeamId !== change.teamId) {
      const prevTeamRef = db.collection("teams").doc(String(prevTeamId));
      const prevTeamSnap = await prevTeamRef.get();
      if (prevTeamSnap.exists) {
        const memberIds = (prevTeamSnap.data()?.memberIds || []).filter(
          (id: string) => id !== change.userId,
        );
        await prevTeamRef.set({ memberIds, updatedAt: ts }, { merge: true });
      }
    }

    const teamRef = db.collection("teams").doc(change.teamId);
    const teamSnap = await teamRef.get();
    const memberIds = [...new Set([...(teamSnap.data()?.memberIds || []), change.userId])];
    await teamRef.set({ memberIds, updatedAt: ts }, { merge: true });
  }

  return json({ ok: true, updated: changes.length }, 200, cors);
}
