#!/usr/bin/env node
/** Instrument store call counts for dashboard cold-load budget. */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};

const { initDomainStore, getStore } = await import("../domain/store.js");
initDomainStore(null);
const store = getStore();

let reads = 0;
const origGetUser = store.getUser?.bind(store);
if (origGetUser) {
  store.getUser = async (...args) => {
    reads += 1;
    return origGetUser(...args);
  };
}
const origGetTeam = store.getTeam?.bind(store);
if (origGetTeam) {
  store.getTeam = async (...args) => {
    reads += 1;
    return origGetTeam(...args);
  };
}

const { listVisibleSeEmails } = await import("../domain/org-service.js");
await store.clearAll?.();

// Minimal seed
const ts = Date.now();
await store.createOrg?.({ id: "org1", name: "O", directorId: "d1", seniorLeaderIds: [], teamIds: ["t1"], createdAt: ts, updatedAt: ts });
await store.createTeam?.({ id: "t1", name: "T", orgId: "org1", managerId: "m1", memberIds: ["u1"], createdAt: ts, updatedAt: ts });
await store.upsertUser?.({ id: "u1", email: "se@freshworks.com", role: "se", teamId: "t1", orgId: "org1", displayName: "SE", status: "active", createdAt: ts, updatedAt: ts });
await store.upsertUser?.({ id: "m1", email: "mgr@freshworks.com", role: "manager", teamId: "t1", orgId: "org1", displayName: "M", status: "active", createdAt: ts, updatedAt: ts, isOrgDirector: true });

store.listUsersByOrg = async () => [
  { id: "u1", email: "se@freshworks.com", role: "se", teamId: "t1", orgId: "org1" },
];

reads = 0;
await listVisibleSeEmails({ userId: "m1", role: "manager", teamId: "t1", orgId: "org1" });

if (reads > 12) {
  console.error(`load budget exceeded: ${reads} reads (max 12)`);
  process.exit(1);
}
console.log(`test-load-budget.mjs: ok (${reads} reads)`);
