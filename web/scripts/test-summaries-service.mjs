#!/usr/bin/env node
/** Unit tests for Pass 9 summaries context + persist (no LLM). */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};
globalThis.sessionStorage = globalThis.localStorage;

const { initDomainStore } = await import("../domain/store.js");
initDomainStore(null);
const { newId, now } = await import("../domain/types.js");
const { getStore } = await import("../domain/store.js");
const { buildSummariesContext, regenerateDealAndAccountSummaries } = await import(
  "../domain/summaries-service.js"
);
const { buildCallSummaryFromPostCall } = await import("../domain/call-summary.js");

const store = getStore();

const ts = now();
const accountId = newId("account");
const dealId = newId("deal");
const callA = newId("postCall");
const callB = newId("postCall");

await store.createAccount({
  id: accountId,
  name: "Pioneer Metering",
  domain: "pioneermetering.co.za",
  slug: "pioneermetering-co-za",
  createdAt: ts,
  updatedAt: ts,
});

await store.createDeal({
  id: dealId,
  accountId,
  type: "new_business",
  stage: "demo",
  status: "active",
  ownerId: "usr_test",
  teamId: "team_test",
  orgId: "org_test",
  title: "FD Omni",
  prepCount: 1,
  postCallCount: 2,
  openTaskCount: 0,
  latestQualityScore: null,
  createdAt: ts,
  updatedAt: ts,
  lastActivityAt: ts,
});

await store.createDeal({
  id: newId("deal"),
  accountId,
  type: "expansion",
  stage: "discovery",
  status: "active",
  ownerId: "usr_test",
  teamId: "team_test",
  orgId: "org_test",
  title: "Freshservice",
  prepCount: 0,
  postCallCount: 1,
  openTaskCount: 0,
  latestQualityScore: null,
  createdAt: ts - 1000,
  updatedAt: ts - 1000,
  lastActivityAt: ts - 1000,
});

const baseCall = {
  lifecycleId: newId("lifecycle"),
  dealId,
  ownerId: "usr_test",
  teamId: "team_test",
  orgId: "org_test",
  accountId,
  callIdentityKey: "key-a",
  createdAt: ts - 86400000,
  updatedAt: ts - 86400000,
  analysis: {
    callNotes: "Customer confirmed routing pain; no next step owned by customer.",
    momentum: "Stalled",
    callHeader: { date: "2026-07-20" },
  },
};

const postCallA = { ...baseCall, id: callA };
const postCallB = {
  ...baseCall,
  id: callB,
  callIdentityKey: "key-b",
  createdAt: ts,
  updatedAt: ts,
  analysis: {
    callNotes: "Demo landed; POC exit criteria discussed.",
    momentum: "Advancing",
    callHeader: { date: "2026-07-23" },
  },
};
await store.upsertPostCall(postCallA);
await store.upsertPostCall(postCallB);
// buildSummariesContext reads from the callSummaries collection (a derived
// view of postCalls), not postCalls directly. In production this is
// populated by dual-write.js's buildCallSummaryFromPostCall() as part of
// linkPostCallToLifecycle — this raw-store-write test path bypasses that,
// so it must derive+persist the summary rows itself, orphaned until now.
//
// The digest's `callNotes` field (summaries-service.js#buildCallDigestFromSummary)
// reads call.aiShortForm, not analysis.callNotes directly — aiShortForm is a
// separately-generated short-form summary in production (a real Pass-9-ish
// step, not a copy of the raw notes). Setting it to the notes text here
// simulates that step for this unit test's purposes.
await store.upsertCallSummary({
  ...buildCallSummaryFromPostCall(postCallA),
  aiShortForm: postCallA.analysis.callNotes,
});
await store.upsertCallSummary({
  ...buildCallSummaryFromPostCall(postCallB),
  aiShortForm: postCallB.analysis.callNotes,
});

const ctx = await buildSummariesContext(dealId, accountId);
assert(ctx?.deal?.calls?.length === 2, "deal calls collected");
assert(ctx?.account?.calls?.length === 2, "account calls collected");
assert(ctx.deal.calls[0].callNotes?.includes("routing pain"), "call notes in digest");
assert(ctx.account.deals.length === 2, "both deals on account");

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    dealSummary: {
      summary: "Pioneer is in demo on FD Omni with routing pain confirmed across two calls.",
      sourceCallIds: [callA, callB],
    },
    accountSummary: {
      summary: "Freshservice expansion mentioned once with no follow-up; FD Omni is primary.",
      sourceCallIds: [callA, callB],
    },
  }),
});

const result = await regenerateDealAndAccountSummaries(dealId, accountId, {
  ownerId: "usr_test",
  teamId: "team_test",
  orgId: "org_test",
});

globalThis.fetch = originalFetch;

assert(result?.dealSummary?.dealId === dealId, "deal summary persisted");
assert(result?.accountSummary?.accountId === accountId, "account summary persisted");
assert(result.dealSummary.sourceCallIds.length === 2, "deal sourceCallIds stored");

const rereadDeal = await store.getDealSummaryByDeal(dealId);
const rereadAccount = await store.getAccountSummaryByAccount(accountId);
assert(rereadDeal?.summary?.includes("FD Omni"), "deal summary reread");
assert(rereadAccount?.summary?.includes("Freshservice"), "account summary reread");

console.log("test-summaries-service: ok");
