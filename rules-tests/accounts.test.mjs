#!/usr/bin/env node
/** Firestore security rules tests — requires FIRESTORE_EMULATOR_HOST or firebase emulators:exec. */

import { setupEnv, seedPersona, authedContext, assertFails, assertSucceeds } from "./helpers.mjs";

const ORG = "org_fw";
const TEAM_A = "team_a";
const TEAM_B = "team_b";
const SE_OWNER = {
  authUid: "auth_se_owner",
  userId: "usr_se_owner",
  email: "se.owner@freshworks.com",
  role: "se",
  teamId: TEAM_A,
  orgId: ORG,
};
const SE_OTHER = {
  authUid: "auth_se_other",
  userId: "usr_se_other",
  email: "se.other@freshworks.com",
  role: "se",
  teamId: TEAM_B,
  orgId: ORG,
};
const MGR = {
  authUid: "auth_mgr",
  userId: "usr_mgr",
  email: "mgr@freshworks.com",
  role: "manager",
  teamId: TEAM_A,
  orgId: ORG,
};

export async function run() {
  const env = await setupEnv();
  await env.clearFirestore();
  await seedPersona(env, {
    ...SE_OWNER,
    org: { id: ORG, name: "FW", directorId: "usr_dir", seniorLeaderIds: [], teamIds: [TEAM_A, TEAM_B] },
    team: { id: TEAM_A, name: "A", orgId: ORG, managerId: MGR.userId, memberIds: [SE_OWNER.userId] },
  });
  await seedPersona(env, {
    ...SE_OTHER,
    team: { id: TEAM_B, name: "B", orgId: ORG, managerId: "usr_mgr_b", memberIds: [SE_OTHER.userId] },
  });
  await seedPersona(env, {
    ...MGR,
    team: { id: TEAM_A, name: "A", orgId: ORG, managerId: MGR.userId, memberIds: [SE_OWNER.userId, MGR.userId] },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("accounts").doc("acc_scoped").set({
      id: "acc_scoped",
      name: "Scoped Co",
      slug: "scoped",
      orgId: ORG,
      seTeamUserIds: [SE_OWNER.userId],
      seTeamTeamIds: [TEAM_A],
      primarySeUserId: SE_OWNER.userId,
      createdAt: 1,
      updatedAt: 1,
    });
  });

  const ownerDb = authedContext(env, SE_OWNER).firestore();
  const otherDb = authedContext(env, SE_OTHER).firestore();
  const mgrDb = authedContext(env, MGR).firestore();

  await assertSucceeds(ownerDb.collection("accounts").doc("acc_scoped").get());
  await assertFails(otherDb.collection("accounts").doc("acc_scoped").get());
  await assertSucceeds(mgrDb.collection("accounts").doc("acc_scoped").get());

  await env.cleanup();
  console.log("accounts.test.mjs: ok");
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
