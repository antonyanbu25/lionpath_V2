#!/usr/bin/env node
/**
 * NB vs Expansion motion — resolveEngagementDealInput, findActiveDeal, deal creation,
 * won-deal 90-day gap, activity dealId stamping.
 * Run: node web/scripts/test-deal-motion-nb-expansion.mjs
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
    console.log("ok:", name);
    results.push(true);
  } catch (err) {
    console.error("FAIL:", name, "—", err?.message || err);
    results.push(false);
  }
}

const { initDomainStore, getStore } = await import("../domain/store.js");
const { clearLocalStoreCache } = await import("../domain/local-store.js");
const { TEAM_AJAY_ID } = await import("../domain/constants.js");
const {
  resolveEngagementDealInput,
  resolveEngagementMotion,
  isNewBusinessActor,
  isAccountOnNbAllowlistSync,
} = await import("../domain/deal-motion.js");
const {
  getOrCreateNewBusinessDeal,
  createExpansionDeal,
  archiveDeal,
} = await import("../domain/deal-service.js");
const { linkPrepToLifecycle, linkPostCallToLifecycle } = await import("../domain/dual-write.js");
const { setAccountEngagementContext, clearAccountEngagementContext } = await import("../domain/account-context.js");

initDomainStore(null);
const store = getStore();

const OWNER_ID = "usr_motion_se";
const TEAM_ID = "team_motion";
const ORG_ID = "org_motion";
const TS = 1_700_100_000_000;

async function resetStore() {
  store.clearAll();
  localStorage.removeItem("se-singha-domain:dealContacts");
  clearLocalStoreCache();
  clearAccountEngagementContext();
  await store.upsertUser({
    id: OWNER_ID,
    email: "motion@test.com",
    authUid: null,
    displayName: "Motion SE",
    role: "se",
    teamId: TEAM_ID,
    orgId: ORG_ID,
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: TS,
    updatedAt: TS,
  });
}

const allowlist = { accountIds: new Set(["acc_nb"]), slugs: new Set(["nb-co"]) };
const nbAccount = { id: "acc_nb", slug: "nb-co" };
const expansionActor = { id: "usr_exp", teamId: "team_preethi", role: "se" };
const nbActor = { id: "usr_nb", teamId: TEAM_AJAY_ID, role: "se" };

// --- resolveEngagementDealInput paths ---

await check("allowlist forces NB over expansion-default actor", () => {
  const r = resolveEngagementDealInput({ account: nbAccount, actor: expansionActor, allowlist });
  assert.equal(r.prepType, "new_business");
  assert.equal(r.source, "allowlist");
});

await check("NB actor on non-allowlist account → new_business", () => {
  const r = resolveEngagementDealInput({
    account: { id: "acc_x" },
    actor: nbActor,
    allowlist,
  });
  assert.equal(r.prepType, "new_business");
  assert.equal(r.source, "actor");
});

await check("expansion actor without override → expansion default", () => {
  const r = resolveEngagementDealInput({
    account: { id: "acc_x" },
    actor: expansionActor,
    allowlist,
  });
  assert.equal(r.prepType, "expansion");
  assert.equal(r.source, "default");
});

await check("account engagementOverride dealType wins", () => {
  const r = resolveEngagementDealInput({
    account: { id: "acc_x", metadata: { engagementOverride: { dealType: "new_business" } } },
    actor: expansionActor,
    allowlist,
  });
  assert.equal(r.prepType, "new_business");
  assert.equal(r.source, "account");
});

await check("account engagementOverride dealId pins deal", () => {
  const r = resolveEngagementDealInput({
    account: {
      id: "acc_x",
      metadata: { engagementOverride: { dealId: "deal_pinned", dealType: "expansion" } },
    },
    actor: nbActor,
    allowlist,
  });
  assert.equal(r.dealId, "deal_pinned");
  assert.equal(r.prepType, "expansion");
  assert.equal(r.source, "account");
});

await check("session context dealId + prepType", () => {
  const r = resolveEngagementDealInput({
    account: { id: "acc_x" },
    actor: expansionActor,
    sessionContext: { dealId: "deal_ctx", prepType: "expansion" },
    allowlist,
  });
  assert.equal(r.dealId, "deal_ctx");
  assert.equal(r.prepType, "expansion");
  assert.equal(r.source, "context");
});

await check("explicit dealId wins (manual source)", () => {
  const r = resolveEngagementDealInput({
    explicitDealId: "deal_manual",
    explicitPrepType: "expansion",
    account: nbAccount,
    actor: nbActor,
  });
  assert.equal(r.dealId, "deal_manual");
  assert.equal(r.prepType, "expansion");
  assert.equal(r.source, "manual");
});

await check("programPhase expansion routes to expansion", () => {
  const r = resolveEngagementDealInput({
    account: { id: "acc_x", programPhase: "expansion" },
    actor: nbActor,
    allowlist,
  });
  assert.equal(r.prepType, "expansion");
  assert.equal(r.source, "phase");
});

// --- findActiveDeal + deal creation ---

await check("findActiveDeal scopes by accountId and type", async () => {
  await resetStore();
  const accountId = "acc_find";
  await store.createAccount({
    id: accountId,
    name: "Find Co",
    slug: "find.co",
    domain: "find.co",
    createdAt: TS,
    updatedAt: TS,
  });

  const nb = await getOrCreateNewBusinessDeal(accountId, OWNER_ID, TEAM_ID, ORG_ID);
  assert.ok(nb?.id, "NB deal created");
  assert.equal(nb.type, "new_business");

  const nbAgain = await getOrCreateNewBusinessDeal(accountId, OWNER_ID, TEAM_ID, ORG_ID);
  assert.equal(nbAgain.id, nb.id, "getOrCreateNewBusinessDeal reuses active NB");

  const foundNb = await store.findActiveDeal(accountId, "new_business");
  assert.equal(foundNb?.id, nb.id);

  const foundExp = await store.findActiveDeal(accountId, "expansion");
  assert.equal(foundExp, null, "no expansion deal yet");

  const exp = await createExpansionDeal(accountId, OWNER_ID, TEAM_ID, ORG_ID);
  assert.equal(exp.type, "expansion");

  const expAgain = await createExpansionDeal(accountId, OWNER_ID, TEAM_ID, ORG_ID);
  assert.equal(expAgain.id, exp.id, "createExpansionDeal reuses active expansion");

  const deals = await store.listDealsByAccount(accountId);
  assert.equal(deals.length, 2, "one NB + one expansion active on same account");
});

await check("resolveEngagementMotion async path matches sync rules", async () => {
  await resetStore();
  const accountId = "acc_async";
  await store.createAccount({
    id: accountId,
    name: "Async Co",
    slug: "async.co",
    domain: null,
    createdAt: TS,
    updatedAt: TS,
  });
  await store.upsertUser({
    id: nbActor.id,
    email: "nb@test.com",
    authUid: null,
    displayName: "NB SE",
    role: "se",
    teamId: TEAM_AJAY_ID,
    orgId: ORG_ID,
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: TS,
    updatedAt: TS,
  });

  const motion = await resolveEngagementMotion(accountId, nbActor.id, {
    useSessionContext: false,
  });
  assert.equal(motion.prepType, "new_business");
  assert.equal(motion.source, "actor");
});

// --- Activity association dealId stamping ---

await check("linkPrepToLifecycle stamps dealId on prepBrief and lifecycle", async () => {
  await resetStore();
  const session = { email: "motion@test.com", teamId: TEAM_ID, orgId: ORG_ID, userId: OWNER_ID };
  const payload = {
    companyName: "Stamp Co",
    companyDomain: "stamp.co",
    prospectEmail: "ceo@stamp.co",
    prospectEmails: ["ceo@stamp.co"],
    prepType: "new_business",
  };
  const prep = { companyOverview: "Stamp", prospects: [] };
  const res = await linkPrepToLifecycle(session, payload, prep, { company: "Stamp Co" });
  assert.ok(res?.dealId, "prep link returned dealId");
  assert.equal(res.prepBrief.dealId, res.dealId, "prepBrief.dealId matches lifecycle deal");
  assert.equal(res.lifecycle.dealId, res.dealId);
});

await check("linkPostCallToLifecycle reuses same deal when account matches", async () => {
  await resetStore();
  const session = { email: "motion@test.com", teamId: TEAM_ID, orgId: ORG_ID, userId: OWNER_ID };
  const prepRes = await linkPrepToLifecycle(
    session,
    {
      companyName: "Match Co",
      companyDomain: "match.co",
      prospectEmail: "vp@match.co",
      prospectEmails: ["vp@match.co"],
      prepType: "new_business",
    },
    { companyOverview: "Match", prospects: [] },
    { company: "Match Co" },
  );
  const dealId = prepRes.dealId;

  const analysis = { callHeader: { company: "Match Co" }, qualityCoach: { overall: 8 } };
  const pcRes = await linkPostCallToLifecycle(
    session,
    { companyName: "Match Co", prospectEmails: ["vp@match.co"], prepType: "new_business" },
    { analysis },
    { id: "call_match_1", title: "Match Co — Call", analysis },
  );
  assert.equal(pcRes.postCall.dealId, dealId, "post-call should attach to same deal as prep");
});

// --- 90-day NB → Expansion grace routing ---

await check("won NB deal stays routable as NB for 90 days then expansion", async () => {
  await resetStore();
  const accountId = "acc_won90";
  await store.createAccount({
    id: accountId,
    name: "Won90 Co",
    slug: "won90.co",
    domain: "won90.co",
    programPhase: "new_business",
    createdAt: TS,
    updatedAt: TS,
  });

  const nbDeal = await getOrCreateNewBusinessDeal(accountId, OWNER_ID, TEAM_ID, ORG_ID);
  await archiveDeal(nbDeal.id, OWNER_ID, { stage: "closed_won" });

  const archived = await store.getDeal(nbDeal.id);
  assert.equal(archived.status, "archived");
  assert.equal(archived.stage, "closed_won");
  assert.ok(archived.metadata?.closedWonAt || archived.closedWonAt, "closedWonAt must be stamped");

  const { shouldRouteWonNbToExpansion, resolveEngagementDealInput, NB_GRACE_PERIOD_MS } = await import(
    "../domain/deal-motion.js"
  );
  const wonAt = archived.metadata?.closedWonAt || archived.closedWonAt;
  const withinGrace = resolveEngagementDealInput({
    account: { id: accountId, programPhase: "live" },
    actor: expansionActor,
    allowlist,
    wonNbDealInGrace: archived,
    asOfMs: wonAt + 1,
  });
  assert.equal(withinGrace.prepType, "new_business");
  assert.equal(withinGrace.dealId, nbDeal.id);
  assert.equal(withinGrace.source, "won_grace");

  const after91Days = wonAt + NB_GRACE_PERIOD_MS + 86_400_000;
  assert.equal(shouldRouteWonNbToExpansion(archived, after91Days), "expansion");

  const afterGrace = resolveEngagementDealInput({
    account: { id: accountId, programPhase: "live" },
    actor: expansionActor,
    allowlist,
    wonNbDealInGrace: archived,
    asOfMs: after91Days,
  });
  assert.equal(afterGrace.prepType, "expansion");
  assert.equal(afterGrace.dealId, null);
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\ntest-deal-motion-nb-expansion: ${passed}/${results.length} passed`);
if (failed) process.exit(1);
