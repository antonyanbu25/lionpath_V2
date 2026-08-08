#!/usr/bin/env node
/** Firestore security rules tests — users/{userId} self-update privilege escalation. */

import { setupEnv, seedPersona, authedContext, assertFails, assertSucceeds } from "./helpers.mjs";

const ORG = "org_users";
const TEAM_A = "team_users_a";
const TEAM_B = "team_users_b";

const SE = {
  authUid: "auth_se_users",
  userId: "usr_se_users",
  email: "se.users@freshworks.com",
  role: "se",
  teamId: TEAM_A,
  orgId: ORG,
};

const ADMIN = {
  authUid: "auth_admin_users",
  userId: "usr_admin_users",
  email: "admin.users@freshworks.com",
  role: "admin",
  teamId: TEAM_A,
  orgId: ORG,
};

/** Director persona — isActualDirector() + leadsSegmentContainingTeam() path. */
const DIRECTOR = {
  authUid: "auth_director_users",
  userId: "usr_director_users",
  email: "director.users@freshworks.com",
  role: "manager",
  teamId: TEAM_B,
  orgId: ORG,
};

/** A target SE whose team is in the director's segment. */
const SE_TARGET = {
  authUid: "auth_se_target_users",
  userId: "usr_se_target_users",
  email: "se.target@freshworks.com",
  role: "se",
  teamId: TEAM_B,
  orgId: ORG,
};

export async function run() {
  const env = await setupEnv();
  await env.clearFirestore();

  // --- Seed personas ---

  await seedPersona(env, {
    ...SE,
    org: {
      id: ORG,
      name: "Users Org",
      directorId: DIRECTOR.userId,
      seniorLeaderIds: [],
      segments: [
        { id: "seg_1", name: "Seg 1", leaderId: DIRECTOR.userId, teamIds: [TEAM_B] },
      ],
      teamIds: [TEAM_A, TEAM_B],
    },
    team: {
      id: TEAM_A,
      name: "Team A",
      orgId: ORG,
      managerId: DIRECTOR.userId,
      memberIds: [SE.userId],
    },
  });

  await seedPersona(env, { ...ADMIN });
  await seedPersona(env, { ...DIRECTOR });

  await seedPersona(env, {
    ...SE_TARGET,
    team: {
      id: TEAM_B,
      name: "Team B",
      orgId: ORG,
      managerId: DIRECTOR.userId,
      memberIds: [SE_TARGET.userId],
    },
  });

  const seDb = authedContext(env, SE).firestore();
  const adminDb = authedContext(env, ADMIN).firestore();
  const directorDb = authedContext(env, DIRECTOR).firestore();

  // --- (a) P0 regression: plain SE self-promoting role to 'admin' MUST FAIL ---
  await assertFails(
    seDb.collection("users").doc(SE.userId).update({ role: "admin" }),
  );

  // --- (a.1) SE self-updating a privileged field (teamId) MUST FAIL ---
  await assertFails(
    seDb.collection("users").doc(SE.userId).update({ teamId: TEAM_B }),
  );

  // --- (a.2) SE self-updating multiple privileged fields MUST FAIL ---
  await assertFails(
    seDb.collection("users").doc(SE.userId).update({
      role: "admin",
      orgId: "org_other",
      managerId: "usr_someone_else",
    }),
  );

  // --- (b) SE self-updating own displayName MUST SUCCEED ---
  await assertSucceeds(
    seDb.collection("users").doc(SE.userId).update({ displayName: "Updated Name" }),
  );

  // --- (b.1) SE self-updating own avatarDataUrl MUST SUCCEED ---
  await assertSucceeds(
    seDb.collection("users").doc(SE.userId).update({
      avatarDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    }),
  );

  // --- (b.2) SE self-updating updatedAt MUST SUCCEED ---
  await assertSucceeds(
    seDb.collection("users").doc(SE.userId).update({ updatedAt: 9999 }),
  );

  // --- (c) Admin updating an SE's role MUST SUCCEED ---
  await assertSucceeds(
    adminDb.collection("users").doc(SE.userId).update({ role: "manager" }),
  );

  // Restore SE role for remaining tests
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("users").doc(SE.userId).update({ role: "se" });
  });

  // --- (d) Director via canManageOrgStructureUser updating SE_TARGET's team MUST SUCCEED ---
  // DIRECTOR is isActualDirector() (org.directorId == DIRECTOR.userId) and sameOrg().
  // canManageOrgStructureUser(SE_TARGET's teamId) returns true.
  // The update must include the target teamId in request.resource.data.teamId so the
  // canManageOrgStructureUser(request.resource.data.teamId) check passes.
  await assertSucceeds(
    directorDb.collection("users").doc(SE_TARGET.userId).update({
      teamId: TEAM_B,
      managerId: DIRECTOR.userId,
    }),
  );

  // --- (e) SE updating ANOTHER user's displayName MUST FAIL ---
  await assertFails(
    seDb.collection("users").doc(SE_TARGET.userId).update({ displayName: "Hacked" }),
  );

  // --- (f) Admin updating own profile displayName MUST SUCCEED (isAdmin path) ---
  await assertSucceeds(
    adminDb.collection("users").doc(ADMIN.userId).update({ displayName: "Admin Name" }),
  );

  // --- (g) Director changing SE_TARGET's role via canManageOrgStructureUser SUCCEEDS ---
  // canManageOrgStructureUser returns true for isActualDirector() && sameOrg().
  // This grants full update access (including role) — this is EXISTING behavior
  // that the fix preserves intact. Only the self-update branch is restricted.
  await assertSucceeds(
    directorDb.collection("users").doc(SE_TARGET.userId).update({ role: "admin" }),
  );

  await env.cleanup();
  console.log("users.test.mjs: ok");
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\\\/g, "/")}`) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
