#!/usr/bin/env node
/** Smoke: handoff to expansion */

import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};
globalThis.sessionStorage = globalThis.localStorage;

async function testHandoff() {
  const { initDomainStore, getStore } = await import("../domain/store.js");
  initDomainStore(null);
  const store = getStore();
  store.clearAll();

  const ts = Date.now();
  const ownerId = "usr_handoff";
  const accountId = "acc_handoff";
  await store.createAccount({
    id: accountId,
    name: "Handoff Co",
    slug: "handoff-co",
    domain: null,
    createdAt: ts,
    updatedAt: ts,
    seTeam: [{ seUserId: ownerId, role: "primary", addedAt: ts }],
    primarySeUserId: ownerId,
  });
  await store.upsertUser({
    id: ownerId,
    email: "se@test.com",
    authUid: null,
    displayName: "SE",
    role: "se",
    teamId: "team_1",
    orgId: null,
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: ts,
    updatedAt: ts,
  });

  const { getOrCreateLifecycle } = await import("../domain/lifecycle-service.js");
  await getOrCreateLifecycle(ownerId, accountId, "team_1", {
    orgId: null,
    actorId: ownerId,
    title: "NB",
    prepType: "new_business",
    useSessionContext: false,
  });

  const { handoffToExpansion } = await import("../domain/deal-service.js");
  const session = { email: "se@test.com", teamId: "team_1", orgId: null, userId: ownerId };
  const result = await handoffToExpansion(session, accountId);
  if (!result.success) throw new Error(result.error || "handoff failed");
  assert.equal(result.gracePeriod, true, "handoff enters 90-day NB grace without immediate expansion deal");
  const account = await store.getAccount(accountId);
  assert.equal(account.programPhase, "live");
  const deals = await store.listDealsByAccount(accountId);
  const archivedNb = deals.find((d) => d.type === "new_business" && d.status === "archived");
  assert.ok(archivedNb, "NB deal archived at closed_won");
  assert.ok(archivedNb.metadata?.closedWonAt || archivedNb.closedWonAt, "closedWonAt stamped");
  const activeExp = deals.find((d) => d.type === "expansion" && d.status === "active");
  assert.equal(activeExp, undefined, "no expansion deal during grace period");
  console.log("handoff: ok");
}

async function testPostCallContextDealId() {
  const { initDomainStore, getStore } = await import("../domain/store.js");
  initDomainStore(null);
  const store = getStore();
  store.clearAll();

  const ts = Date.now();
  const ownerId = "usr_pc";
  const accountId = "acc_pc";
  const dealId = "deal_exp_pc";

  await store.createAccount({
    id: accountId,
    name: "PostCall Co",
    slug: "postcall-co",
    domain: "postcall.co",
    createdAt: ts,
    updatedAt: ts,
    seTeam: [{ seUserId: ownerId, role: "primary", addedAt: ts }],
    primarySeUserId: ownerId,
  });
  await store.upsertUser({
    id: ownerId,
    email: "pc@test.com",
    authUid: null,
    displayName: "PC SE",
    role: "se",
    teamId: "team_1",
    orgId: "org_1",
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: ts,
    updatedAt: ts,
  });
  await store.createDeal({
    id: dealId,
    accountId,
    type: "expansion",
    stage: "discovery",
    status: "active",
    ownerId,
    teamId: "team_1",
    orgId: "org_1",
    title: "Expansion",
    prepCount: 0,
    postCallCount: 0,
    openTaskCount: 0,
    latestQualityScore: null,
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });

  const { setAccountEngagementContext } = await import("../domain/account-context.js");
  setAccountEngagementContext({ accountId, dealId, prepType: "expansion" });

  const { linkPostCallToLifecycle } = await import("../domain/dual-write.js");
  const session = { email: "pc@test.com", teamId: "team_1", orgId: "org_1", userId: ownerId };
  const analysis = { callHeader: { company: "PostCall Co" }, qualityCoach: { overall: 8 } };
  const record = { id: "call_test_1", title: "PostCall Co — Call", analysis };
  const result = await linkPostCallToLifecycle(session, {}, { analysis }, record);
  if (!result?.postCall?.dealId) throw new Error("postCall missing dealId");
  if (result.postCall.dealId !== dealId) {
    throw new Error(`expected dealId ${dealId}, got ${result.postCall.dealId}`);
  }
  console.log("postcall context dealId: ok");
}

try {
  await testHandoff();
  await testPostCallContextDealId();
  console.log("test-deal-e2e: ok");
} catch (e) {
  console.error(e);
  process.exit(1);
}
