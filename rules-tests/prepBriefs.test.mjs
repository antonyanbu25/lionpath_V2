#!/usr/bin/env node
/** Firestore security rules tests — prepBriefs/{id}. */

import { setupEnv, seedPersona, authedContext, assertFails, assertSucceeds } from "./helpers.mjs";

const ORG = "org_prepbriefs";
const TEAM_PRIMARY = "team_prepbriefs_primary";
const TEAM_SECONDARY = "team_prepbriefs_secondary";

const PRIMARY_SE = {
  authUid: "auth_prepbriefs_primary",
  userId: "usr_prepbriefs_primary",
  email: "prepbriefs.primary@freshworks.com",
  role: "se",
  teamId: TEAM_PRIMARY,
  orgId: ORG,
};

const SECONDARY_SE = {
  authUid: "auth_prepbriefs_secondary",
  userId: "usr_prepbriefs_secondary",
  email: "prepbriefs.secondary@freshworks.com",
  role: "se",
  teamId: TEAM_SECONDARY,
  orgId: ORG,
};

function prepBriefDoc(id, ownerId, teamId) {
  return {
    id,
    lifecycleId: "lc_prepbriefs",
    accountId: "acc_prepbriefs",
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
      name: "PrepBriefs Org",
      directorId: "usr_prepbriefs_director",
      seniorLeaderIds: [],
      teamIds: [TEAM_PRIMARY, TEAM_SECONDARY],
    },
    team: {
      id: TEAM_PRIMARY,
      name: "Primary Team",
      orgId: ORG,
      managerId: "usr_prepbriefs_mgr",
      memberIds: [PRIMARY_SE.userId],
    },
  });
  await seedPersona(env, {
    ...SECONDARY_SE,
    team: {
      id: TEAM_SECONDARY,
      name: "Secondary Team",
      orgId: ORG,
      managerId: "usr_prepbriefs_mgr_secondary",
      memberIds: [SECONDARY_SE.userId],
    },
  });

  const primaryDb = authedContext(env, PRIMARY_SE).firestore();
  const secondaryDb = authedContext(env, SECONDARY_SE).firestore();

  // --- Create: owner-scoped ---
  await assertSucceeds(
    primaryDb.collection("prepBriefs").doc("pb_primary_ok").set(
      prepBriefDoc("pb_primary_ok", PRIMARY_SE.userId, TEAM_PRIMARY),
    ),
  );
  await assertFails(
    secondaryDb.collection("prepBriefs").doc("pb_forged_owner").set(
      prepBriefDoc("pb_forged_owner", PRIMARY_SE.userId, TEAM_PRIMARY),
    ),
  );

  // --- Read: other-team denied ---
  await assertFails(secondaryDb.collection("prepBriefs").doc("pb_primary_ok").get());
  await assertSucceeds(primaryDb.collection("prepBriefs").doc("pb_primary_ok").get());

  // --- Update: owner-only ---
  await assertFails(
    secondaryDb.collection("prepBriefs").doc("pb_primary_ok").update({ accountId: "acc_hijacked" }),
  );

  await env.cleanup();
  console.log("prepBriefs.test.mjs: ok");
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
