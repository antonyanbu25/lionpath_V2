#!/usr/bin/env node
/** Firestore security rules tests — scorecards/{id}, scorecardLines/{id}, and
 * scoreOverrides/{id}'s append-only (no update/delete) audit-trail rule. */

import { setupEnv, seedPersona, authedContext, assertFails, assertSucceeds } from "./helpers.mjs";

const ORG = "org_scorecards";
const TEAM_PRIMARY = "team_scorecards_primary";
const TEAM_SECONDARY = "team_scorecards_secondary";

const PRIMARY_SE = {
  authUid: "auth_scorecards_primary",
  userId: "usr_scorecards_primary",
  email: "scorecards.primary@freshworks.com",
  role: "se",
  teamId: TEAM_PRIMARY,
  orgId: ORG,
};

const SECONDARY_SE = {
  authUid: "auth_scorecards_secondary",
  userId: "usr_scorecards_secondary",
  email: "scorecards.secondary@freshworks.com",
  role: "se",
  teamId: TEAM_SECONDARY,
  orgId: ORG,
};

function scorecardLineDoc(id, ownerId, teamId) {
  return {
    id,
    scorecardId: "sc_scorecards",
    ownerId,
    teamId,
    orgId: ORG,
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
      name: "Scorecards Org",
      directorId: "usr_scorecards_director",
      seniorLeaderIds: [],
      teamIds: [TEAM_PRIMARY, TEAM_SECONDARY],
    },
    team: {
      id: TEAM_PRIMARY,
      name: "Primary Team",
      orgId: ORG,
      managerId: "usr_scorecards_mgr",
      memberIds: [PRIMARY_SE.userId],
    },
  });
  await seedPersona(env, {
    ...SECONDARY_SE,
    team: {
      id: TEAM_SECONDARY,
      name: "Secondary Team",
      orgId: ORG,
      managerId: "usr_scorecards_mgr_secondary",
      memberIds: [SECONDARY_SE.userId],
    },
  });

  const primaryDb = authedContext(env, PRIMARY_SE).firestore();
  const secondaryDb = authedContext(env, SECONDARY_SE).firestore();

  // --- scorecards: owner-scoped create, cross-team read denied ---
  await assertSucceeds(
    primaryDb.collection("scorecards").doc("sc_primary_ok").set({
      id: "sc_primary_ok",
      postCallId: "pc_scorecards",
      ownerId: PRIMARY_SE.userId,
      teamId: TEAM_PRIMARY,
      orgId: ORG,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  await assertFails(secondaryDb.collection("scorecards").doc("sc_primary_ok").get());

  // --- scorecardLines: same shape ---
  await assertSucceeds(
    primaryDb.collection("scorecardLines").doc("scl_primary_ok").set(
      scorecardLineDoc("scl_primary_ok", PRIMARY_SE.userId, TEAM_PRIMARY),
    ),
  );
  await assertFails(
    secondaryDb.collection("scorecardLines").doc("scl_forged").set(
      scorecardLineDoc("scl_forged", PRIMARY_SE.userId, TEAM_PRIMARY),
    ),
  );

  // --- scoreOverrides: create requires userId == caller AND caller owns the parent scorecardLine ---
  await assertSucceeds(
    primaryDb.collection("scoreOverrides").doc("so_primary_ok").set({
      id: "so_primary_ok",
      scorecardLineId: "scl_primary_ok",
      userId: PRIMARY_SE.userId,
      newScore: 4,
      createdAt: 1,
    }),
  );
  // Different user claiming to override a line they don't own — denied.
  await assertFails(
    secondaryDb.collection("scoreOverrides").doc("so_forged").set({
      id: "so_forged",
      scorecardLineId: "scl_primary_ok",
      userId: SECONDARY_SE.userId,
      newScore: 5,
      createdAt: 1,
    }),
  );
  // Append-only: even the creator cannot update or delete an override once written.
  await assertFails(
    primaryDb.collection("scoreOverrides").doc("so_primary_ok").update({ newScore: 1 }),
  );
  await assertFails(primaryDb.collection("scoreOverrides").doc("so_primary_ok").delete());

  await env.cleanup();
  console.log("scorecards.test.mjs: ok");
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
