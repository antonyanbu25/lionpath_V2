#!/usr/bin/env node
/** Firestore security rules tests — client deal create remains owner-scoped. */

import { setupEnv, seedPersona, authedContext, assertFails, assertSucceeds } from "./helpers.mjs";

const ORG = "org_deals";
const TEAM_PRIMARY = "team_deals_primary";
const TEAM_SECONDARY = "team_deals_secondary";

const PRIMARY_SE = {
  authUid: "auth_deals_primary",
  userId: "usr_deals_primary",
  email: "deals.primary@freshworks.com",
  role: "se",
  teamId: TEAM_PRIMARY,
  orgId: ORG,
};

const SECONDARY_SE = {
  authUid: "auth_deals_secondary",
  userId: "usr_deals_secondary",
  email: "deals.secondary@freshworks.com",
  role: "se",
  teamId: TEAM_SECONDARY,
  orgId: ORG,
};

function dealDoc(id, ownerId, teamId) {
  return {
    id,
    accountId: "acc_deals",
    ownerId,
    teamId,
    orgId: ORG,
    type: "new_business",
    stage: "research",
    status: "active",
    title: "Rules Co - New Business - 2026-08-08",
    primaryContactId: null,
    prepCount: 0,
    postCallCount: 0,
    openTaskCount: 0,
    latestQualityScore: null,
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
      name: "Deals Org",
      directorId: "usr_deals_director",
      seniorLeaderIds: [],
      teamIds: [TEAM_PRIMARY, TEAM_SECONDARY],
    },
    team: {
      id: TEAM_PRIMARY,
      name: "Primary Team",
      orgId: ORG,
      managerId: "usr_deals_mgr_primary",
      memberIds: [PRIMARY_SE.userId],
    },
  });

  await seedPersona(env, {
    ...SECONDARY_SE,
    team: {
      id: TEAM_SECONDARY,
      name: "Secondary Team",
      orgId: ORG,
      managerId: "usr_deals_mgr_secondary",
      memberIds: [SECONDARY_SE.userId],
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("accounts").doc("acc_deals").set({
      id: "acc_deals",
      name: "Rules Co",
      slug: "rules-co",
      orgId: ORG,
      primarySeUserId: PRIMARY_SE.userId,
      seTeam: [
        { seUserId: PRIMARY_SE.userId, role: "primary" },
        { seUserId: SECONDARY_SE.userId, role: "secondary" },
      ],
      createdAt: 1,
      updatedAt: 1,
    });
  });

  const primaryDb = authedContext(env, PRIMARY_SE).firestore();
  const secondaryDb = authedContext(env, SECONDARY_SE).firestore();

  await assertSucceeds(
    primaryDb.collection("deals").doc("deal_primary_ok").set(
      dealDoc("deal_primary_ok", PRIMARY_SE.userId, TEAM_PRIMARY),
    ),
  );

  await assertFails(
    secondaryDb.collection("deals").doc("deal_secondary_primary_owner_denied").set(
      dealDoc("deal_secondary_primary_owner_denied", PRIMARY_SE.userId, TEAM_PRIMARY),
    ),
  );

  await env.cleanup();
  console.log("deals.test.mjs: ok");
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
