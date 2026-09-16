#!/usr/bin/env node
/**
 * Smoke: deal ↔ call linking — engagement context, prep dual-write, resolveDealId priority.
 * See docs/DEAL_CALL_LINKING.md
 */

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function testEngagementContextRoundTrip() {
  const { setAccountEngagementContext, getAccountEngagementContext, clearAccountEngagementContext } =
    await import("../domain/account-context.js");
  clearAccountEngagementContext();
  setAccountEngagementContext({
    accountId: "acc_link",
    dealId: "deal_link",
    prepType: "expansion",
    lifecycleId: "lc_link",
  });
  const ctx = getAccountEngagementContext();
  assert(ctx.dealId === "deal_link", "engagement context dealId");
  assert(ctx.accountId === "acc_link", "engagement context accountId");
  assert(ctx.prepType === "expansion", "engagement context prepType");
  console.log("engagement context: ok");
}

async function testLinkPrepStampsDealId() {
  const { initDomainStore, getStore } = await import("../domain/store.js");
  initDomainStore(null);
  const store = getStore();
  store.clearAll();

  const ts = Date.now();
  const ownerId = "usr_prep_link";
  const dealId = "deal_prep_link";

  // Account must match upsertAccountFromPrep slug lookup (name + domain), not a random id.
  const account = await store.createAccount({
    id: "acc_prep_link",
    name: "Link Co",
    slug: "link.co",
    domain: "link.co",
    createdAt: ts,
    updatedAt: ts,
    seTeam: [{ seUserId: ownerId, role: "primary", addedAt: ts }],
    primarySeUserId: ownerId,
  });
  const accountId = account.id;

  await store.upsertUser({
    id: ownerId,
    email: "link@test.com",
    authUid: null,
    displayName: "Link SE",
    role: "se",
    teamId: "team_1",
    orgId: null,
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: ts,
    updatedAt: ts,
  });
  await store.createDeal({
    id: dealId,
    accountId,
    type: "expansion",
    stage: "discovery",
    status: "active",
    ownerId,
    teamId: "team_1",
    orgId: null,
    title: "Expansion opp",
    prepCount: 0,
    postCallCount: 0,
    openTaskCount: 0,
    latestQualityScore: null,
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });

  const { linkPrepToLifecycle } = await import("../domain/dual-write.js");
  const session = { email: "link@test.com", teamId: "team_1", orgId: null, userId: ownerId };
  const payload = {
    companyName: "Link Co",
    companyDomain: "link.co",
    prospectEmail: "buyer@link.co",
    prospectEmails: ["buyer@link.co"],
    prepType: "expansion",
    dealId,
  };
  const prep = { companyOverview: "Test prep" };
  const result = await linkPrepToLifecycle(session, payload, prep, { company: "Link Co", companyDomain: "link.co" });

  assert(result?.lifecycle?.dealId === dealId, `lifecycle.dealId after prep (got ${result?.lifecycle?.dealId})`);
  assert(result?.prepBrief?.dealId === dealId, "prepBrief.dealId after prep");
  assert(result?.prepBrief?.input?.dealId === dealId, "prepBrief.input.dealId for Pass 0 matching");
  console.log("linkPrepToLifecycle dealId: ok");
}

async function testResolveDealIdPriority() {
  const { resolveDealId } = await import("../call-view.js");

  const confirmed = {
    result: { confirmed: { dealId: "deal_confirmed" }, resolve: { deals: [{ dealId: "deal_pre", preselected: true }] } },
    dealId: "deal_record",
  };
  assert(resolveDealId(confirmed) === "deal_confirmed", "confirmed.dealId wins");

  const recordOnly = {
    dealId: "deal_record",
    result: { resolve: { deals: [{ dealId: "deal_pre", preselected: true }] } },
  };
  assert(resolveDealId(recordOnly) === "deal_record", "record.dealId second");

  const preselectedOnly = {
    result: { resolve: { deals: [{ dealId: "deal_pre", preselected: true }] } },
  };
  assert(resolveDealId(preselectedOnly) === "deal_pre", "preselected resolve deal third");

  assert(resolveDealId({}) === null, "null when no deal signals");
  console.log("resolveDealId priority: ok");
}

try {
  await testEngagementContextRoundTrip();
  await testLinkPrepStampsDealId();
  await testResolveDealIdPriority();
  console.log("test-deal-call-linking: ok");
} catch (e) {
  console.error(e);
  process.exit(1);
}
