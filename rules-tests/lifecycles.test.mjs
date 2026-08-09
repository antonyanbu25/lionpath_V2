#!/usr/bin/env node
/** Firestore security rules tests — lifecycles/{id} and its events subcollection. */

import { setupEnv, seedPersona, authedContext, assertFails, assertSucceeds } from "./helpers.mjs";

const ORG = "org_lifecycles";
const TEAM_PRIMARY = "team_lifecycles_primary";
const TEAM_SECONDARY = "team_lifecycles_secondary";

const PRIMARY_SE = {
  authUid: "auth_lifecycles_primary",
  userId: "usr_lifecycles_primary",
  email: "lifecycles.primary@freshworks.com",
  role: "se",
  teamId: TEAM_PRIMARY,
  orgId: ORG,
};

const SECONDARY_SE = {
  authUid: "auth_lifecycles_secondary",
  userId: "usr_lifecycles_secondary",
  email: "lifecycles.secondary@freshworks.com",
  role: "se",
  teamId: TEAM_SECONDARY,
  orgId: ORG,
};

const MGR_PRIMARY = {
  authUid: "auth_lifecycles_mgr",
  userId: "usr_lifecycles_mgr",
  email: "lifecycles.mgr@freshworks.com",
  role: "manager",
  teamId: TEAM_PRIMARY,
  orgId: ORG,
};

function lifecycleDoc(id, ownerId, teamId) {
  return {
    id,
    accountId: "acc_lifecycles",
    ownerId,
    teamId,
    orgId: ORG,
    stage: "research",
    status: "active",
    prepCount: 0,
    postCallCount: 0,
    openTaskCount: 0,
    createdAt: 1,
    updatedAt: 1,
    lastActivityAt: 1,
  };
}

export async function run() {
  const env = await setupEnv();
  await env.clearFirestore();

  await seedPersona(env, {
    ...PRIMARY_SE,
    org: {
      id: ORG,
      name: "Lifecycles Org",
      directorId: "usr_lifecycles_director",
      seniorLeaderIds: [],
      teamIds: [TEAM_PRIMARY, TEAM_SECONDARY],
    },
    team: {
      id: TEAM_PRIMARY,
      name: "Primary Team",
      orgId: ORG,
      managerId: MGR_PRIMARY.userId,
      memberIds: [PRIMARY_SE.userId, MGR_PRIMARY.userId],
    },
  });
  await seedPersona(env, {
    ...SECONDARY_SE,
    team: {
      id: TEAM_SECONDARY,
      name: "Secondary Team",
      orgId: ORG,
      managerId: "usr_lifecycles_mgr_secondary",
      memberIds: [SECONDARY_SE.userId],
    },
  });
  await seedPersona(env, { ...MGR_PRIMARY });

  const primaryDb = authedContext(env, PRIMARY_SE).firestore();
  const secondaryDb = authedContext(env, SECONDARY_SE).firestore();
  const mgrDb = authedContext(env, MGR_PRIMARY).firestore();

  // --- Create: owner-scoped ---
  await assertSucceeds(
    primaryDb.collection("lifecycles").doc("lc_primary_ok").set(
      lifecycleDoc("lc_primary_ok", PRIMARY_SE.userId, TEAM_PRIMARY),
    ),
  );
  await assertFails(
    secondaryDb.collection("lifecycles").doc("lc_forged_owner").set(
      lifecycleDoc("lc_forged_owner", PRIMARY_SE.userId, TEAM_PRIMARY),
    ),
  );

  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("lifecycles").doc("lc_read_check")
      .set(lifecycleDoc("lc_read_check", PRIMARY_SE.userId, TEAM_PRIMARY));
  });

  // --- Read: same-team allowed (manager), other-team denied ---
  await assertSucceeds(mgrDb.collection("lifecycles").doc("lc_read_check").get());
  await assertFails(secondaryDb.collection("lifecycles").doc("lc_read_check").get());

  // --- Update: owner-only ---
  await assertSucceeds(
    primaryDb.collection("lifecycles").doc("lc_read_check").update({ stage: "discovery" }),
  );
  await assertFails(
    secondaryDb.collection("lifecycles").doc("lc_read_check").update({ stage: "closed_won" }),
  );

  // --- events subcollection: append-only (no update/delete) ---
  await assertSucceeds(
    primaryDb
      .collection("lifecycles").doc("lc_read_check")
      .collection("events").doc("evt_1")
      .set({ type: "stage_changed", ownerId: PRIMARY_SE.userId, teamId: TEAM_PRIMARY, orgId: ORG, createdAt: 1 }),
  );
  await assertFails(
    primaryDb
      .collection("lifecycles").doc("lc_read_check")
      .collection("events").doc("evt_1")
      .update({ type: "tampered" }),
  );
  await assertFails(secondaryDb.collection("lifecycles").doc("lc_read_check").collection("events").doc("evt_1").get());

  await env.cleanup();
  console.log("lifecycles.test.mjs: ok");
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
