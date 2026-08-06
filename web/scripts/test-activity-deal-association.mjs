#!/usr/bin/env node
/**
 * Dual-write smoke: prep + post-call create consistent account/deal/lifecycle/artifact dealIds.
 * Run: node web/scripts/test-activity-deal-association.mjs
 */

import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};
globalThis.sessionStorage = {
  getItem: (k) => mem.get(`ss:${k}`) ?? null,
  setItem: (k, v) => mem.set(`ss:${k}`, v),
  removeItem: (k) => mem.delete(`ss:${k}`),
};

const results = [];

async function check(name, fn) {
  try {
    await fn();
    console.log("ok:", name);
    results.push(true);
  } catch (err) {
    console.error("FAIL:", name, "—", err?.message || err);
    results.push(false);
  }
}

const { initDomainStore, getStore } = await import("../domain/store.js");
const { clearLocalStoreCache } = await import("../domain/local-store.js");
const { linkPrepToLifecycle, linkPostCallToLifecycle } = await import("../domain/dual-write.js");
const { resolveActingOwnerId } = await import("../domain/acting-owner.js");
const { clearAccountEngagementContext } = await import("../domain/account-context.js");

initDomainStore(null);
const store = getStore();

const TEAM_ID = "team_assoc";
const ORG_ID = "org_assoc";
const TS = 1_700_200_000_000;

async function seedUser({ id, email, role, teamId, managerId = null }) {
  await store.upsertUser({
    id,
    email,
    authUid: null,
    displayName: email.split("@")[0],
    role,
    teamId,
    orgId: ORG_ID,
    managerId,
    jobTitle: null,
    status: "active",
    createdAt: TS,
    updatedAt: TS,
  });
}

async function resetStore() {
  store.clearAll();
  localStorage.removeItem("se-singha-domain:dealContacts");
  clearLocalStoreCache();
  clearAccountEngagementContext();
}

// --- Prep flow: account + deal + lifecycle + prepBrief consistent dealId ---

await check("prep flow creates aligned account, deal, lifecycle, prepBrief dealIds", async () => {
  await resetStore();
  const ownerId = "usr_assoc_se";
  await seedUser({ id: ownerId, email: "assoc@test.com", role: "se", teamId: TEAM_ID });
  const session = { email: "assoc@test.com", teamId: TEAM_ID, orgId: ORG_ID, userId: ownerId };

  const res = await linkPrepToLifecycle(
    session,
    {
      companyName: "Align Co",
      companyDomain: "align.co",
      prospectEmail: "lead@align.co",
      prospectEmails: ["lead@align.co"],
      prepType: "new_business",
    },
    { companyOverview: "Align", prospects: [{ name: "Lead", email: "lead@align.co" }] },
    { company: "Align Co", companyDomain: "align.co" },
  );

  assert.ok(res?.accountId);
  assert.ok(res?.dealId);
  assert.equal(res.lifecycle.accountId, res.accountId);
  assert.equal(res.lifecycle.dealId, res.dealId);
  assert.equal(res.prepBrief.accountId, res.accountId);
  assert.equal(res.prepBrief.lifecycleId, res.lifecycle.id);
  assert.equal(res.prepBrief.dealId, res.dealId);

  const deal = await store.getDeal(res.dealId);
  assert.equal(deal.accountId, res.accountId);
  assert.equal(deal.type, "new_business");
});

// --- Post-call attaches to same deal when account matches ---

await check("post-call on same account reuses prep dealId", async () => {
  await resetStore();
  const ownerId = "usr_assoc_pc";
  await seedUser({ id: ownerId, email: "pc-assoc@test.com", role: "se", teamId: TEAM_ID });
  const session = { email: "pc-assoc@test.com", teamId: TEAM_ID, orgId: ORG_ID, userId: ownerId };

  const prep = await linkPrepToLifecycle(
    session,
    {
      companyName: "Reuse Co",
      companyDomain: "reuse.co",
      prospectEmail: "cfo@reuse.co",
      prospectEmails: ["cfo@reuse.co"],
      prepType: "new_business",
    },
    { companyOverview: "Reuse", prospects: [] },
    { company: "Reuse Co" },
  );

  const analysis = { callHeader: { company: "Reuse Co" }, qualityCoach: { overall: 7 } };
  const pc = await linkPostCallToLifecycle(
    session,
    { companyName: "Reuse Co", prospectEmails: ["cfo@reuse.co"], prepType: "new_business" },
    { analysis },
    { id: "call_reuse_1", title: "Reuse Co — Discovery", analysis },
  );

  assert.equal(pc.postCall.dealId, prep.dealId);
  assert.equal(pc.lifecycle.dealId, prep.dealId);
  assert.equal(pc.accountId, prep.accountId);

  const preps = await store.listPrepBriefsByLifecycle(prep.lifecycle.id);
  const calls = await store.listPostCallsByLifecycle(pc.lifecycle.id);
  assert.equal(preps[0].dealId, calls[0].dealId);
});

// --- Manager proxy: lifecycle owner is proxied SE ---

await check("manager proxy stamps artifacts under proxied SE ownerId", async () => {
  await resetStore();
  const mgrId = "usr_assoc_mgr";
  const seId = "usr_assoc_proxy_se";
  await seedUser({ id: mgrId, email: "mgr-assoc@test.com", role: "manager", teamId: TEAM_ID });
  await seedUser({ id: seId, email: "proxy-se@test.com", role: "se", teamId: TEAM_ID, managerId: mgrId });
  await store.upsertTeam?.({
    id: TEAM_ID,
    orgId: ORG_ID,
    managerId: mgrId,
    memberIds: [seId],
    name: "Assoc Team",
    createdAt: TS,
    updatedAt: TS,
  });

  const session = { email: "mgr-assoc@test.com", teamId: TEAM_ID, orgId: ORG_ID, userId: mgrId, role: "manager" };
  const ownerId = await resolveActingOwnerId(session, seId);
  assert.equal(ownerId, seId);

  const res = await linkPrepToLifecycle(
    session,
    {
      companyName: "Proxy Co",
      companyDomain: "proxy.co",
      prospectEmail: "cto@proxy.co",
      prospectEmails: ["cto@proxy.co"],
      prepType: "new_business",
      proxySeUserId: seId,
    },
    { companyOverview: "Proxy", prospects: [] },
    { company: "Proxy Co" },
  );

  assert.equal(res.prepBrief.ownerId, seId);
  assert.equal(res.lifecycle.ownerId, seId);
  assert.ok(res.dealId);
});

// --- Expansion prepType creates expansion deal ---

await check("expansion prepType creates expansion deal type", async () => {
  await resetStore();
  const ownerId = "usr_assoc_exp";
  await seedUser({ id: ownerId, email: "exp-assoc@test.com", role: "se", teamId: TEAM_ID });
  const session = { email: "exp-assoc@test.com", teamId: TEAM_ID, orgId: ORG_ID, userId: ownerId };

  const res = await linkPrepToLifecycle(
    session,
    {
      companyName: "Expand Co",
      companyDomain: "expand.co",
      prospectEmail: "vp@expand.co",
      prospectEmails: ["vp@expand.co"],
      prepType: "expansion",
    },
    { companyOverview: "Expand", prospects: [] },
    { company: "Expand Co" },
  );

  const deal = await store.getDeal(res.dealId);
  assert.equal(deal.type, "expansion");
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\ntest-activity-deal-association: ${passed}/${results.length} passed`);
if (failed) process.exit(1);
