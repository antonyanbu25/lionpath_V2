#!/usr/bin/env node
/** Unit tests for deal motion routing (no browser). */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};
globalThis.sessionStorage = globalThis.localStorage;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const { initDomainStore } = await import("../domain/store.js");
initDomainStore(null);

const {
  resolveEngagementDealInput,
  isNewBusinessActor,
  isAccountOnNbAllowlistSync,
  NEW_BUSINESS_TEAM_IDS,
} = await import("../domain/deal-motion.js");
const { TEAM_AJAY_ID, TEAM_NIKIL_ID } = await import("../domain/constants.js");

assert(NEW_BUSINESS_TEAM_IDS.has(TEAM_AJAY_ID), "International - NB team in NB set");
assert(NEW_BUSINESS_TEAM_IDS.has(TEAM_NIKIL_ID), "North America - NB team in NB set");

const ajaySe = { id: "usr_a", teamId: TEAM_AJAY_ID, role: "se" };
const preethiSe = { id: "usr_p", teamId: "team_preethi", role: "se" };
assert(isNewBusinessActor(ajaySe), "International - NB actor → NB");
assert(!isNewBusinessActor(preethiSe), "Preethi squad → not NB actor by default");

const allowlist = { accountIds: new Set(["acc_nb"]), slugs: new Set(["nb-ic-co"]) };
const nbAccount = { id: "acc_nb", slug: "nb-ic-co" };
assert(isAccountOnNbAllowlistSync(nbAccount, allowlist), "allowlist by id");
assert(
  isAccountOnNbAllowlistSync({ id: "acc_x", slug: "NB-IC-CO" }, allowlist),
  "allowlist slug case insensitive"
);

let r = resolveEngagementDealInput({
  account: nbAccount,
  actor: preethiSe,
  allowlist,
});
assert(r.prepType === "new_business" && r.source === "allowlist", "allowlist forces NB");

r = resolveEngagementDealInput({ account: { id: "acc_x" }, actor: ajaySe, allowlist });
assert(r.prepType === "new_business" && r.source === "actor", "International - NB actor → NB");

r = resolveEngagementDealInput({ account: { id: "acc_x" }, actor: preethiSe, allowlist });
assert(r.prepType === "expansion" && r.source === "default", "Preethi → expansion default");

r = resolveEngagementDealInput({
  account: { id: "acc_x", metadata: { engagementOverride: { dealType: "new_business" } } },
  actor: preethiSe,
  allowlist,
});
assert(r.prepType === "new_business" && r.source === "account", "account override wins");

r = resolveEngagementDealInput({
  explicitDealId: "deal_manual",
  explicitPrepType: "expansion",
  account: nbAccount,
  actor: ajaySe,
});
assert(r.dealId === "deal_manual" && r.source === "manual", "explicit dealId wins");

console.log("test-deal-motion: ok");
