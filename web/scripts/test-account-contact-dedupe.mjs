#!/usr/bin/env node
/**
 * Two SEs with the same prospect email must resolve to one shared account.
 * Run: node web/scripts/test-account-contact-dedupe.mjs
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

const { initDomainStore, getStore } = await import("../domain/store.js");
const { linkPrepToLifecycle } = await import("../domain/dual-write.js");
const { updateAccountSeTeam } = await import("../domain/account-service.js");
const { listActiveLifecyclesForAccount } = await import("../domain/lifecycle-service.js");

initDomainStore(null);
const store = getStore();

const TEAM_ID = "team_dedupe";
const ORG_ID = "org_dedupe";
const SE_A = "usr_se_dedupe_a";
const SE_B = "usr_se_dedupe_b";
const TS = 1_700_200_000_000;

async function seedUser(id, email) {
  await store.upsertUser({
    id,
    email,
    authUid: null,
    displayName: email.split("@")[0],
    role: "se",
    teamId: TEAM_ID,
    orgId: ORG_ID,
    managerId: null,
    jobTitle: "SE",
    status: "active",
    createdAt: TS,
    updatedAt: TS,
  });
}

await seedUser(SE_A, "se-a-dedupe@test.com");
await seedUser(SE_B, "se-b-dedupe@test.com");

const sessionA = { email: "se-a-dedupe@test.com", teamId: TEAM_ID, orgId: ORG_ID, userId: SE_A };
const sessionB = { email: "se-b-dedupe@test.com", teamId: TEAM_ID, orgId: ORG_ID, userId: SE_B };

const linkedA = await linkPrepToLifecycle(
  sessionA,
  {
    companyName: "Acme Corporation",
    companyDomain: "acmecorp.com",
    prospectEmail: "buyer@acmecorp.com",
    prospectEmails: ["buyer@acmecorp.com"],
    prepType: "new_business",
  },
  { prospects: [{ name: "Buyer", email: "buyer@acmecorp.com" }] },
  { company: "Acme Corporation", companyDomain: "acmecorp.com" },
);
assert.ok(linkedA?.accountId, "SE A creates account");

// SE B uses a different typed company name but the same contact email.
const linkedB = await linkPrepToLifecycle(
  sessionB,
  {
    companyName: "ACME Corp",
    companyDomain: "acmecorp.com",
    prospectEmail: "buyer@acmecorp.com",
    prospectEmails: ["buyer@acmecorp.com"],
    prepType: "new_business",
  },
  { prospects: [{ name: "Buyer", email: "buyer@acmecorp.com" }] },
  { company: "ACME Corp", companyDomain: "acmecorp.com" },
);

assert.equal(linkedB?.accountId, linkedA.accountId, "same contact email → same account for both SEs");

const accounts = await store.listAccounts?.();
assert.equal(accounts?.length ?? 1, 1, "only one account doc exists");

const lcs = await listActiveLifecyclesForAccount(linkedA.accountId);
assert.equal(lcs.length, 2, "each SE gets their own lifecycle on the shared account");

// Re-adding SE B must still guarantee a lifecycle (idempotent self-join path).
const again = await updateAccountSeTeam(sessionB, linkedA.accountId, "add_secondary", { seUserId: SE_B });
assert.ok(again.success, "re-add secondary succeeds");
const lcsAfter = await listActiveLifecyclesForAccount(linkedA.accountId);
assert.equal(lcsAfter.length, 2, "lifecycle count unchanged after idempotent add");

console.log("test-account-contact-dedupe: ok");
