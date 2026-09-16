#!/usr/bin/env node
/** Firestore security rules tests — postCalls/{id}. */

import { setupEnv, seedPersona, authedContext, assertFails, assertSucceeds } from "./helpers.mjs";

const ORG = "org_postcalls";
const TEAM_PRIMARY = "team_postcalls_primary";
const TEAM_SECONDARY = "team_postcalls_secondary";

const PRIMARY_SE = {
  authUid: "auth_postcalls_primary",
  userId: "usr_postcalls_primary",
  email: "postcalls.primary@freshworks.com",
  role: "se",
  teamId: TEAM_PRIMARY,
  orgId: ORG,
};

const SECONDARY_SE = {
  authUid: "auth_postcalls_secondary",
  userId: "usr_postcalls_secondary",
  email: "postcalls.secondary@freshworks.com",
  role: "se",
  teamId: TEAM_SECONDARY,
  orgId: ORG,
};

const DIRECTOR = {
  authUid: "auth_postcalls_director",
  userId: "usr_postcalls_director",
  email: "postcalls.director@freshworks.com",
  role: "manager",
  teamId: TEAM_SECONDARY,
  orgId: ORG,
};

function postCallDoc(id, ownerId, teamId) {
  return {
    id,
    lifecycleId: "lc_postcalls",
    accountId: "acc_postcalls",
    ownerId,
    teamId,
    orgId: ORG,
    callIdentityKey: `ck_${id}`,
    createdAt: 1,
    updatedAt: 1,
  };
}

export async function run() {
  const env = await setupEnv();
  await env.clearFirestore();

  await seedPersona(env, {
    ...PRIMARY_SE,
    org: {
      id: ORG,
      name: "PostCalls Org",
      directorId: DIRECTOR.userId,
      seniorLeaderIds: [],
      teamIds: [TEAM_PRIMARY, TEAM_SECONDARY],
    },
    team: {
      id: TEAM_PRIMARY,
      name: "Primary Team",
      orgId: ORG,
      managerId: "usr_postcalls_mgr",
      memberIds: [PRIMARY_SE.userId],
    },
  });
  await seedPersona(env, {
    ...SECONDARY_SE,
    team: {
      id: TEAM_SECONDARY,
      name: "Secondary Team",
      orgId: ORG,
      managerId: DIRECTOR.userId,
      memberIds: [SECONDARY_SE.userId, DIRECTOR.userId],
    },
  });
  await seedPersona(env, { ...DIRECTOR });

  const primaryDb = authedContext(env, PRIMARY_SE).firestore();
  const secondaryDb = authedContext(env, SECONDARY_SE).firestore();
  const directorDb = authedContext(env, DIRECTOR).firestore();

  // --- Create: owner-scoped ---
  await assertSucceeds(
    primaryDb.collection("postCalls").doc("pc_primary_ok").set(
      postCallDoc("pc_primary_ok", PRIMARY_SE.userId, TEAM_PRIMARY),
    ),
  );
  await assertFails(
    secondaryDb.collection("postCalls").doc("pc_forged_owner").set(
      postCallDoc("pc_forged_owner", PRIMARY_SE.userId, TEAM_PRIMARY),
    ),
  );

  // --- Read: cross-team peer denied, org director (org leader) allowed ---
  await assertFails(secondaryDb.collection("postCalls").doc("pc_primary_ok").get());
  await assertSucceeds(directorDb.collection("postCalls").doc("pc_primary_ok").get());

  // --- Delete: not admin, must fail ---
  await assertFails(primaryDb.collection("postCalls").doc("pc_primary_ok").delete());

  await env.cleanup();
  console.log("postCalls.test.mjs: ok");
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
