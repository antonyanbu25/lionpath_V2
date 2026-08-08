#!/usr/bin/env node
import { setupEnv, seedPersona, authedContext, assertFails, assertSucceeds } from "./helpers.mjs";

const ORG = "org_fw";
const TEAM_A = "team_a";
const SE_OWNER = {
  authUid: "auth_se_dc",
  userId: "usr_se_dc",
  email: "se.dc@freshworks.com",
  role: "se",
  teamId: TEAM_A,
  orgId: ORG,
};
const SE_OTHER = {
  authUid: "auth_se_dc2",
  userId: "usr_se_dc2",
  email: "se.dc2@freshworks.com",
  role: "se",
  teamId: "team_b",
  orgId: ORG,
};

export async function run() {
  const env = await setupEnv();
  await env.clearFirestore();
  await seedPersona(env, {
    ...SE_OWNER,
    org: { id: ORG, name: "FW", directorId: "x", seniorLeaderIds: [], teamIds: [TEAM_A] },
    team: { id: TEAM_A, name: "A", orgId: ORG, managerId: "m", memberIds: [SE_OWNER.userId] },
  });
  await seedPersona(env, { ...SE_OTHER });

  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("deals").doc("deal_a").set({
      id: "deal_a",
      accountId: "acc_a",
      ownerId: SE_OWNER.userId,
      teamId: TEAM_A,
      orgId: ORG,
      type: "new_business",
      stage: "research",
      status: "active",
      title: "Deal A",
      primaryContactId: "con_a",
      prepCount: 0,
      postCallCount: 0,
      openTaskCount: 0,
      latestQualityScore: null,
      createdAt: 1,
      updatedAt: 1,
      lastActivityAt: 1,
    });
    await ctx.firestore().collection("dealContacts").doc("deal_a_con_a").set({
      id: "deal_a_con_a",
      dealId: "deal_a",
      contactId: "con_a",
      accountId: "acc_a",
      ownerId: SE_OWNER.userId,
      teamId: TEAM_A,
      orgId: ORG,
      role: "champion",
      isPrimary: true,
      createdAt: 1,
      updatedAt: 1,
    });
  });

  const ownerDb = authedContext(env, SE_OWNER).firestore();
  const otherDb = authedContext(env, SE_OTHER).firestore();

  await assertSucceeds(ownerDb.collection("dealContacts").doc("deal_a_con_a").get());
  await assertFails(otherDb.collection("dealContacts").doc("deal_a_con_a").get());

  await assertSucceeds(
    ownerDb.collection("dealContacts").doc("deal_a_con_b").set({
      id: "deal_a_con_b",
      dealId: "deal_a",
      contactId: "con_b",
      accountId: "acc_a",
      ownerId: SE_OWNER.userId,
      teamId: TEAM_A,
      orgId: ORG,
      role: "unknown",
      isPrimary: false,
      createdAt: 1,
      updatedAt: 1,
    }),
  );

  await assertFails(
    otherDb.collection("dealContacts").doc("deal_x_con_x").set({
      id: "deal_x_con_x",
      dealId: "deal_x",
      contactId: "con_x",
      accountId: "acc_x",
      ownerId: SE_OTHER.userId,
      teamId: "team_b",
      orgId: ORG,
      role: "unknown",
      isPrimary: false,
      createdAt: 1,
      updatedAt: 1,
    }),
  );

  await env.cleanup();
  console.log("dealContacts.test.mjs: ok");
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
