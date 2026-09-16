#!/usr/bin/env node
/** Smoke tests for account/deal/contact fix pass (90-day grace, proxy teamId, segment scope, rules file). */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function check(name, fn) {
  return fn().then(
    () => console.log(`  ok: ${name}`),
    (err) => {
      console.error(`  FAIL: ${name}`, err?.message || err);
      process.exitCode = 1;
    },
  );
}

await check("firestore.rules defines dealContacts collection and account create guard", async () => {
  const rules = readFileSync(join(root, "firestore.rules"), "utf8");
  assert.match(rules, /match \/dealContacts\//);
  assert.match(rules, /canReadAccountData/);
  assert.match(rules, /canWriteDealResource/);
  assert.match(rules, /function canCreateAccount/);
  assert.match(rules, /allow update: if canWriteDealResource\(resource\.data\)/);
});

await check("segment scope lists lifecycles across segment teams", async () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
  };
  globalThis.sessionStorage = globalThis.localStorage;

  const { initDomainStore, getStore } = await import("../domain/store.js");
  initDomainStore(null);
  const store = getStore();
  store.clearAll();
  const ts = Date.now();
  const orgId = "org_seg";
  await store.upsertOrg?.({
    id: orgId,
    name: "Org",
    directorId: "usr_dir",
    seniorLeaderIds: [],
    teamIds: ["team_a", "team_b"],
    segments: [{ id: "seg_nurture", name: "Nurture", leaderId: "usr_seg_leader", teamIds: ["team_a", "team_b"] }],
    createdAt: ts,
    updatedAt: ts,
  });
  await store.upsertUser({
    id: "usr_seg_leader",
    email: "seg@test.com",
    authUid: null,
    displayName: "Seg Leader",
    role: "manager",
    teamId: "team_a",
    orgId,
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: ts,
    updatedAt: ts,
  });
  await store.createLifecycle({
    id: "lc_b",
    ownerId: "usr_se_b",
    teamId: "team_b",
    orgId,
    accountId: "acc_b",
    stage: "discovery",
    status: "active",
    title: "B",
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
    prepCount: 0,
    postCallCount: 0,
    openTaskCount: 0,
  });

  const { listLifecyclesForSession } = await import("../domain/lifecycle-service.js");
  const session = {
    email: "seg@test.com",
    role: "manager",
    teamId: "team_a",
    orgId,
    userId: "usr_seg_leader",
    isSegmentLeader: true,
    segmentId: "seg_nurture",
    segmentTeamIds: ["team_a", "team_b"],
  };
  const rows = await listLifecyclesForSession(session);
  assert.ok(rows.some((r) => r.id === "lc_b"), "segment leader should see team_b lifecycles");
});

await check("resolveActingWriteContext uses target SE teamId", async () => {
  const mem = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => mem.get(`ss:${k}`) ?? null,
    setItem: (k, v) => mem.set(`ss:${k}`, v),
    removeItem: (k) => mem.delete(`ss:${k}`),
  };
  const { initDomainStore, getStore } = await import("../domain/store.js");
  initDomainStore(null);
  const store = getStore();
  store.clearAll();
  const ts = Date.now();
  await store.upsertOrg?.({
    id: "org_1",
    name: "Org",
    directorId: "usr_mgr",
    seniorLeaderIds: [],
    teamIds: ["team_se", "team_mgr"],
    createdAt: ts,
    updatedAt: ts,
  });
  await store.upsertUser({
    id: "usr_mgr",
    email: "mgr@test.com",
    authUid: null,
    displayName: "Mgr",
    role: "manager",
    teamId: "team_mgr",
    orgId: "org_1",
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: ts,
    updatedAt: ts,
  });
  await store.upsertUser({
    id: "usr_se",
    email: "se@test.com",
    authUid: null,
    displayName: "SE",
    role: "se",
    teamId: "team_se",
    orgId: "org_1",
    managerId: "usr_mgr",
    jobTitle: null,
    status: "active",
    createdAt: ts,
    updatedAt: ts,
  });
  await store.upsertTeam?.({
    id: "team_se",
    orgId: "org_1",
    managerId: "usr_mgr",
    memberIds: ["usr_se"],
    name: "SE Team",
    createdAt: ts,
    updatedAt: ts,
  });

  const { resolveActingWriteContext } = await import("../domain/acting-owner.js");
  const ctx = await resolveActingWriteContext(
    {
      email: "mgr@test.com",
      role: "manager",
      teamId: "team_mgr",
      orgId: "org_1",
      userId: "usr_mgr",
      isOrgDirector: true,
      isActualDirector: true,
    },
    "usr_se",
  );
  assert.equal(ctx.ownerId, "usr_se");
  assert.equal(ctx.teamId, "team_se");
  assert.equal(ctx.orgId, "org_1");
});

if (process.exitCode) {
  console.log("\ntest-account-deal-fixes: FAILED");
  process.exit(1);
}
console.log("\ntest-account-deal-fixes: ok");
