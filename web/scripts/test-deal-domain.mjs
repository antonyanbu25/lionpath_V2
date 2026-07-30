#!/usr/bin/env node
/**
 * Domain smoke: Deal + Lifecycle linkage (local store).
 * Run: node web/scripts/test-deal-domain.mjs
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};

import { initDomainStore, getStore } from "../domain/store.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  initDomainStore(null);
  const store = getStore();
  if (store.clearAll) store.clearAll();

  const ownerId = "usr_test_se";
  const teamId = "team_test";
  const orgId = "org_test";
  const accountId = "acc_test_1";
  const ts = Date.now();

  await store.createAccount({
    id: accountId,
    name: "Acme",
    slug: "acme",
    domain: "acme.com",
    createdAt: ts,
    updatedAt: ts,
  });

  const { getOrCreateLifecycle } = await import("../domain/lifecycle-service.js");
  const { listDealsForAccount, advanceDealStage } = await import("../domain/deal-service.js");

  const lc = await getOrCreateLifecycle(ownerId, accountId, teamId, {
    title: "Acme NB",
    orgId,
    actorId: ownerId,
    prepType: "new_business",
  });

  assert(lc.dealId, "lifecycle should have dealId");
  const deals = await listDealsForAccount(accountId);
  assert(deals.length === 1, "one deal on account");
  assert(deals[0].type === "new_business", "NB deal type");

  await advanceDealStage(deals[0].id, "discovery", ownerId);
  const lc2 = await store.getLifecycle(lc.id);
  assert(lc2.stage === "discovery", "lifecycle mirrors deal stage");

  console.log("test-deal-domain: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
