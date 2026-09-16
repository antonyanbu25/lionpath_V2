#!/usr/bin/env node
/** Smoke test: lifecycle uniqueness (ownerId + accountId). */

if (typeof globalThis.localStorage === "undefined") {
  const mem = {};
  globalThis.localStorage = {
    getItem: (k) => mem[k] ?? null,
    setItem: (k, v) => { mem[k] = v; },
    removeItem: (k) => { delete mem[k]; },
  };
}

import { createLocalStore } from "../../web/domain/local-store.js";

const store = createLocalStore();
store.clearAll();

const ownerId = "test-owner";
const teamId = "demo-team";
const accountId = "acct-1";
const ts = Date.now();

await store.createLifecycle({
  id: "lc-1",
  ownerId,
  teamId,
  accountId,
  primaryContactId: null,
  stage: "research",
  status: "active",
  title: "Test Co",
  createdAt: ts,
  updatedAt: ts,
  lastActivityAt: ts,
  prepCount: 0,
  postCallCount: 0,
  openTaskCount: 0,
  latestQualityScore: null,
});

const found = await store.findActiveLifecycle(ownerId, accountId);
if (!found || found.id !== "lc-1") {
  console.error("FAIL: expected to find lifecycle lc-1");
  process.exit(1);
}

const dup = await store.findActiveLifecycle(ownerId, accountId);
if (dup.id !== found.id) {
  console.error("FAIL: duplicate lookup returned different id");
  process.exit(1);
}

console.log("OK: lifecycle uniqueness smoke test passed");
