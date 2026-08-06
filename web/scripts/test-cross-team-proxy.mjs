#!/usr/bin/env node
/**
 * Cross-team segment-leader proxy — Preethi (Digital leader) → Digital IC write context.
 * Local store only; validates resolveActingWriteContext stamps IC teamId (TEST-002 extension).
 *
 * Run: node web/scripts/test-cross-team-proxy.mjs
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
    console.log(`  ok: ${name}`);
    results.push(true);
  } catch (err) {
    console.error(`  FAIL: ${name}`, err?.message || err);
    results.push(false);
  }
}

const ORG_ID = "org_cross";
const TEAM_DIGITAL_LEADER = "team_digital_leader";
const TEAM_DIGITAL_IC = "team_digital_ic";
const TS = 1_700_300_000_000;

await check("segment leader cross-team proxy uses IC teamId, not leader teamId", async () => {
  const { initDomainStore, getStore } = await import("../domain/store.js");
  initDomainStore(null);
  const store = getStore();
  store.clearAll();

  await store.upsertOrg?.({
    id: ORG_ID,
    name: "Cross Org",
    directorId: "usr_director",
    seniorLeaderIds: [],
    teamIds: [TEAM_DIGITAL_LEADER, TEAM_DIGITAL_IC],
    segments: [
      {
        id: "seg_digital",
        name: "Digital",
        leaderId: "usr_preethi",
        teamIds: [TEAM_DIGITAL_IC],
      },
    ],
    createdAt: TS,
    updatedAt: TS,
  });

  await store.upsertTeam?.({
    id: TEAM_DIGITAL_LEADER,
    orgId: ORG_ID,
    managerId: "usr_preethi",
    memberIds: [],
    name: "Digital Leader Team",
    createdAt: TS,
    updatedAt: TS,
  });
  await store.upsertTeam?.({
    id: TEAM_DIGITAL_IC,
    orgId: ORG_ID,
    managerId: "usr_ic_mgr",
    memberIds: ["usr_digital_ic"],
    name: "Digital IC Team",
    createdAt: TS,
    updatedAt: TS,
  });

  await store.upsertUser({
    id: "usr_preethi",
    email: "preethi@test.com",
    authUid: null,
    displayName: "Preethi",
    role: "manager",
    teamId: TEAM_DIGITAL_LEADER,
    orgId: ORG_ID,
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: TS,
    updatedAt: TS,
  });
  await store.upsertUser({
    id: "usr_digital_ic",
    email: "ic-digital@test.com",
    authUid: null,
    displayName: "Digital IC",
    role: "se",
    teamId: TEAM_DIGITAL_IC,
    orgId: ORG_ID,
    managerId: "usr_ic_mgr",
    jobTitle: null,
    status: "active",
    createdAt: TS,
    updatedAt: TS,
  });

  const { resolveActingWriteContext, canManagerActForSe } = await import("../domain/acting-owner.js");
  const preethiSession = {
    email: "preethi@test.com",
    role: "manager",
    teamId: TEAM_DIGITAL_LEADER,
    orgId: ORG_ID,
    userId: "usr_preethi",
    isSegmentLeader: true,
    segmentId: "seg_digital",
    segmentTeamIds: [TEAM_DIGITAL_IC],
  };

  assert.equal(await canManagerActForSe(preethiSession, "usr_digital_ic"), true);

  const ctx = await resolveActingWriteContext(preethiSession, "usr_digital_ic");
  assert.equal(ctx.ownerId, "usr_digital_ic");
  assert.equal(ctx.teamId, TEAM_DIGITAL_IC, "must stamp IC team, not leader team");
  assert.notEqual(ctx.teamId, TEAM_DIGITAL_LEADER);
  assert.equal(ctx.orgId, ORG_ID);
});

await check("linkTaskToLifecycle cross-team proxy stamps IC owner and teamId", async () => {
  const { initDomainStore, getStore } = await import("../domain/store.js");
  initDomainStore(null);
  const store = getStore();
  store.clearAll();

  await store.upsertOrg?.({
    id: ORG_ID,
    name: "Cross Org",
    directorId: "usr_director",
    seniorLeaderIds: [],
    teamIds: [TEAM_DIGITAL_LEADER, TEAM_DIGITAL_IC],
    segments: [
      {
        id: "seg_digital",
        name: "Digital",
        leaderId: "usr_preethi",
        teamIds: [TEAM_DIGITAL_IC],
      },
    ],
    createdAt: TS,
    updatedAt: TS,
  });
  await store.upsertTeam?.({
    id: TEAM_DIGITAL_IC,
    orgId: ORG_ID,
    managerId: "usr_ic_mgr",
    memberIds: ["usr_digital_ic"],
    name: "Digital IC Team",
    createdAt: TS,
    updatedAt: TS,
  });
  await store.upsertUser({
    id: "usr_preethi",
    email: "preethi@test.com",
    authUid: null,
    displayName: "Preethi",
    role: "manager",
    teamId: TEAM_DIGITAL_LEADER,
    orgId: ORG_ID,
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: TS,
    updatedAt: TS,
  });
  await store.upsertUser({
    id: "usr_digital_ic",
    email: "ic-digital@test.com",
    authUid: null,
    displayName: "Digital IC",
    role: "se",
    teamId: TEAM_DIGITAL_IC,
    orgId: ORG_ID,
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: TS,
    updatedAt: TS,
  });
  await store.createAccount({
    id: "acc_cross",
    name: "Cross Co",
    slug: "cross.co",
    domain: "cross.co",
    createdAt: TS,
    updatedAt: TS,
    seTeam: [{ seUserId: "usr_digital_ic", role: "primary", addedAt: TS }],
    primarySeUserId: "usr_digital_ic",
  });
  await store.createLifecycle({
    id: "lc_cross",
    ownerId: "usr_digital_ic",
    teamId: TEAM_DIGITAL_IC,
    orgId: ORG_ID,
    accountId: "acc_cross",
    stage: "discovery",
    status: "active",
    title: "Cross",
    createdAt: TS,
    updatedAt: TS,
    lastActivityAt: TS,
    prepCount: 0,
    postCallCount: 0,
    openTaskCount: 0,
  });

  const { linkTaskToLifecycle } = await import("../domain/dual-write.js");
  const preethiSession = {
    email: "preethi@test.com",
    role: "manager",
    teamId: TEAM_DIGITAL_LEADER,
    orgId: ORG_ID,
    userId: "usr_preethi",
    isSegmentLeader: true,
    segmentId: "seg_digital",
    segmentTeamIds: [TEAM_DIGITAL_IC],
  };

  const task = await linkTaskToLifecycle(
    preethiSession,
    {
      title: "Follow up",
      ownerId: "usr_digital_ic",
      accountId: "acc_cross",
    },
    "lc_cross",
  );

  assert.ok(task, "task link must succeed for cross-team proxy");
  assert.equal(task.ownerId, "usr_digital_ic");
  assert.equal(task.teamId, TEAM_DIGITAL_IC);
});

await check("resolveActingWriteContext resolves teamId from org team membership when user doc lacks teamId", async () => {
  const { initDomainStore, getStore } = await import("../domain/store.js");
  initDomainStore(null);
  const store = getStore();
  store.clearAll();

  await store.upsertOrg?.({
    id: ORG_ID,
    name: "Cross Org",
    directorId: "usr_director",
    seniorLeaderIds: [],
    teamIds: [TEAM_DIGITAL_IC],
    createdAt: TS,
    updatedAt: TS,
  });
  await store.upsertTeam?.({
    id: TEAM_DIGITAL_IC,
    orgId: ORG_ID,
    managerId: "usr_ic_mgr",
    memberIds: ["usr_se_no_doc_team"],
    name: "Digital IC Team",
    createdAt: TS,
    updatedAt: TS,
  });
  await store.upsertUser({
    id: "usr_se_no_doc_team",
    email: "nodoc-team@test.com",
    authUid: null,
    displayName: "SE No Doc Team",
    role: "se",
    teamId: null,
    orgId: ORG_ID,
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: TS,
    updatedAt: TS,
  });

  const { resolveActingWriteContext } = await import("../domain/acting-owner.js");
  const seSession = {
    email: "nodoc-team@test.com",
    role: "se",
    teamId: null,
    orgId: ORG_ID,
    userId: "usr_se_no_doc_team",
  };

  const ctx = await resolveActingWriteContext(seSession, null);
  assert.equal(ctx.teamId, TEAM_DIGITAL_IC);
});

await check("resolveActingWriteContext fails when SE has no team assignment", async () => {
  const { initDomainStore, getStore } = await import("../domain/store.js");
  initDomainStore(null);
  const store = getStore();
  store.clearAll();

  await store.upsertUser({
    id: "usr_orphan_se",
    email: "orphan@test.com",
    authUid: null,
    displayName: "Orphan SE",
    role: "se",
    teamId: null,
    orgId: ORG_ID,
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: TS,
    updatedAt: TS,
  });

  const { resolveActingWriteContext } = await import("../domain/acting-owner.js");
  const seSession = {
    email: "orphan@test.com",
    role: "se",
    teamId: null,
    orgId: ORG_ID,
    userId: "usr_orphan_se",
  };

  await assert.rejects(
    () => resolveActingWriteContext(seSession, null),
    /Could not resolve team/i,
  );
});

const failed = results.filter((r) => !r).length;
if (failed) {
  console.error(`\ntest-cross-team-proxy.mjs: ${failed} failure(s)`);
  process.exit(1);
}
console.log(`\ntest-cross-team-proxy.mjs: ${results.length}/${results.length} PASS`);
