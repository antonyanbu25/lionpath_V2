/**
 * Tests for post-call ARR storage (task 2.5b wiring).
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};
globalThis.sessionStorage = globalThis.localStorage;

import { initDomainStore, getStore } from "../domain/store.js";
import {
  accountAllowanceConsumedForDeal,
  persistArrAfterPostCall,
  resolveAllowanceConsumerDealId,
} from "../domain/arr-service.js";

initDomainStore(null);
const store = getStore();

const accountId = "acc_arr_test";
const dealA = "deal_arr_a";
const dealB = "deal_arr_b";
const callId = "call_arr_1";
const ts = Date.now();

await store.createAccount({
  id: accountId,
  name: "ARR Test Co",
  slug: "arr-test-co",
  domain: "arr.test",
  createdAt: ts - 10000,
  updatedAt: ts,
});

await store.createDeal({
  id: dealA,
  accountId,
  type: "new_business",
  stage: "discovery",
  status: "active",
  ownerId: "usr_test",
  teamId: "team_test",
  orgId: "org_test",
  primaryContactId: null,
  title: "Deal A",
  prepCount: 0,
  postCallCount: 1,
  openTaskCount: 0,
  createdAt: ts - 5000,
  updatedAt: ts,
  lastActivityAt: ts,
});

await store.createDeal({
  id: dealB,
  accountId,
  type: "expansion",
  stage: "discovery",
  status: "active",
  ownerId: "usr_test",
  teamId: "team_test",
  orgId: "org_test",
  primaryContactId: null,
  title: "Deal B",
  prepCount: 0,
  postCallCount: 0,
  openTaskCount: 0,
  createdAt: ts - 1000,
  updatedAt: ts,
  lastActivityAt: ts,
});

await store.upsertPostCall({
  id: callId,
  lifecycleId: "lc_test",
  dealId: dealA,
  ownerId: "usr_test",
  teamId: "team_test",
  orgId: "org_test",
  accountId,
  callIdentityKey: "arr-test-key",
  analysis: {},
  createdAt: ts,
  updatedAt: ts,
});

const computeResult = {
  arrPoint: 77827,
  arrLow: 70044,
  arrHigh: 85610,
  priceBookVersion: "2026-07-24-usd-list",
  inputs: {
    agents: 40,
    conversationVolume: { evidence: "12k conversations/month" },
    addons: [{ addonKey: "freddy_ai_copilot", evidence: "14 of 40" }],
  },
  lines: [
    {
      kind: "base",
      addonKey: null,
      quantity: 40,
      unit: "agent_month",
      unitPrice: 79,
      annualValue: 37920,
      recurring: true,
      stated: true,
      inScope: true,
      excluded: false,
      exclusionReason: null,
      confidence: 1,
      derivationJson: [],
    },
    {
      kind: "addon",
      addonKey: "freddy_ai_agent_sessions",
      quantity: 715,
      unit: "per_100_sessions",
      unitPrice: 49,
      annualValue: 35035,
      recurring: false,
      stated: false,
      inScope: true,
      excluded: false,
      exclusionReason: null,
      confidence: 0.7,
      derivationJson: [{ step: "priced", annualValue: 35035 }],
    },
  ],
};

const ctx = {
  callId,
  accountId,
  ownerId: "usr_test",
  teamId: "team_test",
  orgId: "org_test",
};

const result = await persistArrAfterPostCall(dealA, computeResult, ctx);
const deal = await store.getDeal(dealA);
const lines = await store.listArrLinesByCall(callId);
const postCall = await store.getPostCall(callId);
const account = await store.getAccount(accountId);

const checks = [
  ["deal arrEstimatePoint", deal?.arrEstimatePoint === 77827],
  ["deal arrSource derived", deal?.arrSource === "derived_from_agents"],
  ["deal arrPriceBookVersion", deal?.arrPriceBookVersion === "2026-07-24-usd-list"],
  ["deal assumptionsBookVersion", deal?.assumptionsBookVersion === "2026-07-24-usd-list"],
  ["deal arrInputsJson stored", deal?.arrInputsJson?.agents === 40],
  ["deal arrActual untouched", deal?.arrActual == null],
  ["two arr lines written", lines.length === 2],
  ["base line kind", lines.some((l) => l.kind === "base")],
  ["sessions line addonKey", lines.some((l) => l.addonKey === "freddy_ai_agent_sessions")],
  ["call arrSnapshot point", postCall?.arrSnapshot?.arrEstimatePoint === 77827],
  ["call arrSnapshot lines", postCall?.arrSnapshot?.lines?.length === 2],
  ["allowance pinned to deal A", account?.metadata?.arrSessionAllowanceDealId === dealA],
  ["deal B allowance consumed", (await accountAllowanceConsumedForDeal(store, accountId, dealB)) === true],
  ["consumer resolves to deal A", (await resolveAllowanceConsumerDealId(store, accountId, dealB, null)) === dealA],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    console.error("FAIL:", name);
    failed++;
  } else {
    console.log("ok:", name);
  }
}

if (failed) process.exit(1);
console.log(`\n${checks.length} arr-persist checks passed.`);
