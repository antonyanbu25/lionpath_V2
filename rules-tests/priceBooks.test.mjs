#!/usr/bin/env node
/**
 * Firestore security rules tests — priceBooks/{id}, representative for the
 * identical isAdmin()-gated shape shared by addonPriceBooks and
 * assumptionsBooks (org-wide reference data: any signed-in user reads, only
 * admin writes). Exercises priceBooks directly; addonPriceBooks and
 * assumptionsBooks follow the same three rule lines verbatim in
 * firestore.rules — add dedicated files for those only if their content
 * ever diverges from this shape.
 */

import { setupEnv, seedPersona, authedContext, assertFails, assertSucceeds } from "./helpers.mjs";

const ORG = "org_pricebooks";
const TEAM = "team_pricebooks";

const SE = {
  authUid: "auth_pricebooks_se",
  userId: "usr_pricebooks_se",
  email: "pricebooks.se@freshworks.com",
  role: "se",
  teamId: TEAM,
  orgId: ORG,
};

const ADMIN = {
  authUid: "auth_pricebooks_admin",
  userId: "usr_pricebooks_admin",
  email: "pricebooks.admin@freshworks.com",
  role: "admin",
  teamId: TEAM,
  orgId: ORG,
};

export async function run() {
  const env = await setupEnv();
  await env.clearFirestore();

  await seedPersona(env, {
    ...SE,
    org: { id: ORG, name: "PriceBooks Org", directorId: "usr_pricebooks_director", seniorLeaderIds: [], teamIds: [TEAM] },
    team: { id: TEAM, name: "Team", orgId: ORG, managerId: "usr_pricebooks_mgr", memberIds: [SE.userId] },
  });
  await seedPersona(env, { ...ADMIN });

  const seDb = authedContext(env, SE).firestore();
  const adminDb = authedContext(env, ADMIN).firestore();

  const row = {
    id: "row_pricebooks",
    sku: "test-sku",
    version: "2026-08-usd-list",
    createdAt: 1,
    updatedAt: 1,
  };

  // --- Any signed-in user can read org-wide reference data ---
  await adminDb.collection("priceBooks").doc("row_pricebooks").set(row); // seed as admin (real write path)
  await assertSucceeds(seDb.collection("priceBooks").doc("row_pricebooks").get());

  // --- Only admin can write ---
  await assertFails(seDb.collection("priceBooks").doc("row_se_denied").set(row));
  await assertSucceeds(adminDb.collection("priceBooks").doc("row_admin_ok").set(row));
  await assertFails(seDb.collection("priceBooks").doc("row_pricebooks").update({ sku: "hijacked" }));
  await assertFails(seDb.collection("priceBooks").doc("row_pricebooks").delete());
  await assertSucceeds(adminDb.collection("priceBooks").doc("row_pricebooks").delete());

  await env.cleanup();
  console.log("priceBooks.test.mjs: ok");
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
