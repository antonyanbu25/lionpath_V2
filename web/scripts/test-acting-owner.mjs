#!/usr/bin/env node
/**
 * Acting-owner proxy resolution — team validation, cross-team rejection.
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

async function seedTeamStore() {
  const { initDomainStore, getStore } = await import("../domain/store.js");
  initDomainStore(null);
  const store = getStore();
  store.clearAll();
  const ts = Date.now();
  const teamId = "team_proxy";
  await store.upsertUser({
    id: "usr_mgr",
    email: "mgr@test.com",
    authUid: null,
    displayName: "Mgr",
    role: "manager",
    teamId,
    orgId: null,
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: ts,
    updatedAt: ts,
  });
  await store.upsertUser({
    id: "usr_se_a",
    email: "se-a@test.com",
    authUid: null,
    displayName: "SE A",
    role: "se",
    teamId,
    orgId: null,
    managerId: "usr_mgr",
    jobTitle: null,
    status: "active",
    createdAt: ts,
    updatedAt: ts,
  });
  await store.upsertUser({
    id: "usr_se_other",
    email: "se-other@test.com",
    authUid: null,
    displayName: "Other SE",
    role: "se",
    teamId: "team_other",
    orgId: null,
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: ts,
    updatedAt: ts,
  });
  await store.upsertTeam?.({
    id: teamId,
    orgId: null,
    managerId: "usr_mgr",
    memberIds: ["usr_se_a"],
    name: "Proxy Team",
    createdAt: ts,
    updatedAt: ts,
  });
}

async function testResolveActingOwner() {
  await seedTeamStore();
  const {
    resolveActingOwnerId,
    resolveActingOwnerEmail,
    canManagerActForSe,
    proxySeRequiredMessage,
    actingAuditFields,
    PROXY_SE_STORAGE_KEY,
  } = await import("../domain/acting-owner.js");

  const mgrSession = { email: "mgr@test.com", role: "manager", teamId: "team_proxy", userId: "usr_mgr" };
  const seSession = { email: "se-a@test.com", role: "se", teamId: "team_proxy", userId: "usr_se_a" };

  assert.equal(await resolveActingOwnerId(seSession, null), "usr_se_a");
  assert.equal(await resolveActingOwnerEmail(seSession, null), "se-a@test.com");

  await assert.rejects(
    () => resolveActingOwnerId(mgrSession, null),
    /Select which SE/i,
  );

  assert.equal(await resolveActingOwnerId(mgrSession, "usr_se_a"), "usr_se_a");
  assert.equal(await resolveActingOwnerEmail(mgrSession, "usr_se_a"), "se-a@test.com");

  assert.equal(await canManagerActForSe(mgrSession, "usr_se_a"), true);
  assert.equal(await canManagerActForSe(mgrSession, "usr_se_other"), false);

  assert.match(proxySeRequiredMessage(mgrSession, null), /Select which SE/i);
  assert.equal(proxySeRequiredMessage(mgrSession, "usr_se_a"), "");

  const audit = actingAuditFields(mgrSession, "usr_se_a");
  assert.equal(audit.createdByUserId, "usr_mgr");
  assert.equal(audit.createdByRole, "manager");
  assert.deepEqual(actingAuditFields(seSession, null), {});

  sessionStorage.setItem(`${PROXY_SE_STORAGE_KEY}:mgr@test.com`, JSON.stringify({
    id: "usr_se_a",
    email: "se-a@test.com",
    name: "SE A",
  }));
  assert.equal(await resolveActingOwnerId(mgrSession, null), "usr_se_a");

  console.log("acting-owner resolution: ok");
}

async function testManagerProxyDualWrite() {
  await seedTeamStore();
  const { initDomainStore, getStore } = await import("../domain/store.js");
  initDomainStore(null);
  const store = getStore();
  const ts = Date.now();
  await store.createAccount({
    id: "acc_proxy",
    name: "Proxy Co",
    slug: "proxy.co",
    domain: "proxy.co",
    createdAt: ts,
    updatedAt: ts,
    seTeam: [{ seUserId: "usr_se_a", role: "primary", addedAt: ts }],
    primarySeUserId: "usr_se_a",
  });

  const { linkPrepToLifecycle } = await import("../domain/dual-write.js");
  const mgrSession = { email: "mgr@test.com", role: "manager", teamId: "team_proxy", userId: "usr_mgr" };
  const payload = {
    companyName: "Proxy Co",
    companyDomain: "proxy.co",
    prospectEmail: "buyer@proxy.co",
    prospectEmails: ["buyer@proxy.co"],
    prepType: "new_business",
    proxySeUserId: "usr_se_a",
  };
  const result = await linkPrepToLifecycle(mgrSession, payload, { companyOverview: "x" }, {
    company: "Proxy Co",
    companyDomain: "proxy.co",
  });
  assert.equal(result?.prepBrief?.ownerId, "usr_se_a");
  assert.equal(result?.lifecycle?.ownerId, "usr_se_a");
  assert.equal(result?.prepBrief?.teamId, "team_proxy");
  assert.equal(result?.lifecycle?.teamId, "team_proxy");
  assert.equal(result?.prepBrief?.createdByUserId, "usr_mgr");
  assert.equal(result?.prepBrief?.createdByRole, "manager");
  console.log("manager proxy dual-write: ok");
}

function testManagerRoutingPolicy() {
  function resolveManagerView(name, isManager = true) {
    if (name === "manager" && !isManager) return "dashboard";
    return name;
  }
  assert.equal(resolveManagerView("precall"), "precall");
  assert.equal(resolveManagerView("postcall"), "postcall");
  assert.equal(resolveManagerView("dashboard"), "dashboard");
  assert.equal(resolveManagerView("coaching"), "coaching");
  assert.equal(resolveManagerView("manager"), "manager");
  assert.equal(resolveManagerView("manager", false), "dashboard");
  console.log("manager routing policy: ok");
}

try {
  await testResolveActingOwner();
  await testManagerProxyDualWrite();
  testManagerRoutingPolicy();
  console.log("test-acting-owner.mjs: ok");
} catch (e) {
  console.error(e);
  process.exit(1);
}
