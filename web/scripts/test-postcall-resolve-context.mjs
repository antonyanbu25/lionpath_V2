#!/usr/bin/env node
/**
 * Post-call Pass 0 resolve context — owner-scoped reads + permission fallback.
 * Run: node web/scripts/test-postcall-resolve-context.mjs
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};

import { initDomainStore, getStore } from "../domain/store.js";
import { buildPostCallResolveContext } from "../postcall-resolve-context.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  initDomainStore(null);
  const store = getStore();
  if (store.clearAll) store.clearAll();

  const ownerId = "usr_test_se";
  const accountId = "acc_euphotic";
  const ts = Date.now();

  await store.createAccount({
    id: accountId,
    name: "Euphotic",
    slug: "euphotic",
    domain: "euphotic.io",
    createdAt: ts,
    updatedAt: ts,
  });

  const lc = await store.createLifecycle({
    id: "lc_euphotic",
    accountId,
    ownerId,
    teamId: "team_test",
    orgId: "org_test",
    stage: "discovery",
    status: "active",
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });

  await store.createPrepBrief({
    id: "prep_euphotic",
    lifecycleId: lc.id,
    accountId,
    ownerId,
    teamId: "team_test",
    orgId: "org_test",
    createdAt: ts,
    meta: { company: "Euphotic", domain: "euphotic.io" },
    input: { prospectEmails: ["ceo@euphotic.io"] },
  });

  await store.createDeal({
    id: "deal_euphotic",
    accountId,
    ownerId,
    teamId: "team_test",
    orgId: "org_test",
    title: "Euphotic New Biz",
    type: "new_business",
    stage: "discovery",
    status: "open",
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });

  await store.createDeal({
    id: "deal_other_account",
    accountId: "acc_other",
    ownerId,
    teamId: "team_test",
    orgId: "org_test",
    title: "Other",
    type: "new_business",
    stage: "discovery",
    status: "open",
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });

  await store.createDeal({
    id: "deal_other_owner",
    accountId,
    ownerId: "usr_other_se",
    teamId: "team_other",
    orgId: "org_test",
    title: "Euphotic — Saketh's deal",
    type: "new_business",
    stage: "demo",
    status: "open",
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });

  const ctx = await buildPostCallResolveContext(ownerId);
  assert(ctx.briefs.length === 1, "one prep brief");
  assert(ctx.accounts.length === 1, "one account");
  assert(ctx.accounts[0].domain === "euphotic.io", "account domain");
  assert(ctx.deals.length === 2, "global deals on account (own + other SE)");
  assert(
    ctx.deals.some((d) => d.id === "deal_euphotic") && ctx.deals.some((d) => d.id === "deal_other_owner"),
    "both deals on account",
  );

  const { enrichResolveDealsForAccount } = await import("../postcall-resolve-context.js");
  const enriched = await enrichResolveDealsForAccount({ deals: [] }, accountId);
  assert(enriched.deals.length === 2, "enrich adds global deals for confirm gate");

  const originalList = store.listLifecyclesByOwner;
  store.listLifecyclesByOwner = async () => {
    const err = new Error("Missing or insufficient permissions.");
    err.code = "permission-denied";
    throw err;
  };
  const { invalidatePostCallResolveContext } = await import("../postcall-resolve-context.js");
  invalidatePostCallResolveContext(ownerId);
  const fallback = await buildPostCallResolveContext(ownerId);
  store.listLifecyclesByOwner = originalList;
  assert(
    JSON.stringify(fallback) === JSON.stringify({ ownerId, briefs: [], accounts: [], deals: [] }),
    "permission fallback returns empty context",
  );

  console.log("test-postcall-resolve-context: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
