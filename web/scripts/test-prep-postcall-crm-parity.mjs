#!/usr/bin/env node
/**
 * Prep vs post-call CRM parity: same company + emails → same account, deal, contacts.
 * Run: node web/scripts/test-prep-postcall-crm-parity.mjs
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
const { clearLocalStoreCache } = await import("../domain/local-store.js");
const { clearAccountEngagementContext } = await import("../domain/account-context.js");
const { linkPrepToLifecycle, linkPostCallToLifecycle } = await import("../domain/dual-write.js");
const { collectParticipantEmails } = await import("../domain/engagement-entities.js");

initDomainStore(null);
const store = getStore();

const OWNER_ID = "usr_parity_se";
const TEAM_ID = "team_parity";
const ORG_ID = "org_parity";
const TS = 1_700_200_000_000;
const session = { email: "parity@test.com", teamId: TEAM_ID, orgId: ORG_ID, userId: OWNER_ID };

async function reset() {
  store.clearAll();
  localStorage.removeItem("se-singha-domain:dealContacts");
  clearLocalStoreCache();
  clearAccountEngagementContext();
  await store.upsertUser({
    id: OWNER_ID,
    email: session.email,
    authUid: null,
    displayName: "Parity SE",
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

const COMPANY = "Parity Co";
const DOMAIN = "parity.co";
const EMAILS = ["lead@parity.co", "peer@parity.co"];

// collectParticipantEmails: confirmed identities win primary slot
const ordered = collectParticipantEmails({
  prospectEmails: EMAILS,
  confirmedIdentities: { customerIdentities: ["Peer Person <peer@parity.co>"] },
});
assert.deepEqual(ordered, ["peer@parity.co", "lead@parity.co"], "confirmed email must be primary order");

await reset();

const prepPayload = {
  companyName: COMPANY,
  companyDomain: DOMAIN,
  prospectEmail: EMAILS[0],
  prospectEmails: EMAILS,
  prepType: "new_business",
};

const prep = {
  companyOverview: `${COMPANY} overview`,
  prospects: EMAILS.map((email, i) => ({
    email,
    name: i === 0 ? "Lead" : "Peer",
    title: "VP",
  })),
};

const prepRes = await linkPrepToLifecycle(session, prepPayload, prep, {
  company: COMPANY,
  companyDomain: DOMAIN,
});
assert.ok(prepRes?.accountId, "prep must create account");
assert.ok(prepRes?.dealId, "prep must create deal");
assert.equal(prepRes.contactIds.length, 2, "prep must create two contacts");

const postPayload = {
  companyName: COMPANY,
  companyDomain: DOMAIN,
  prospectEmails: EMAILS,
  participantEmails: EMAILS,
  prepType: "new_business",
};
const analysis = { callHeader: { company: COMPANY }, qualityCoach: { overall: 8 } };
const record = { id: "pc_parity_1", title: `${COMPANY} — Discovery`, analysis };

const postRes = await linkPostCallToLifecycle(session, postPayload, { analysis }, record);
assert.ok(postRes?.accountId, "post-call must resolve account");
assert.equal(postRes.accountId, prepRes.accountId, "post-call must reuse prep account");
assert.equal(postRes.dealId || postRes.lifecycle?.dealId, prepRes.dealId, "post-call must reuse prep deal");

const accounts = await store.listAccounts();
assert.equal(accounts.length, 1, "must not duplicate account");

const deals = await store.listDealsByAccount(prepRes.accountId);
assert.equal(deals.length, 1, "must not duplicate deal");

const contacts = await store.listContactsByAccount(prepRes.accountId);
assert.equal(contacts.length, 2, "contacts must be deduped by email");
const emails = contacts.map((c) => c.email).sort();
assert.deepEqual(emails, [...EMAILS].sort());

const primary = contacts.find((c) => c.id === prepRes.primaryContactId);
assert.equal(primary?.email, "lead@parity.co", "prep primary is first typed email when no confirm gate");

// Reverse order: post-call first, then prep on same inputs
await reset();

const postFirst = await linkPostCallToLifecycle(session, postPayload, { analysis }, {
  ...record,
  id: "pc_parity_2",
});
assert.ok(postFirst?.accountId, "post-call first must create account");

const prepSecond = await linkPrepToLifecycle(session, prepPayload, prep, {
  company: COMPANY,
  companyDomain: DOMAIN,
});
assert.equal(prepSecond.accountId, postFirst.accountId, "prep must reuse post-call account");
assert.equal(prepSecond.dealId, postFirst.lifecycle?.dealId, "prep must reuse post-call deal");

assert.equal((await store.listAccounts()).length, 1, "reverse order: one account");
assert.equal((await store.listDealsByAccount(postFirst.accountId)).length, 1, "reverse order: one deal");

// Vivid Pix: prep duckdiver email + post-call vivid-pix email → one Howard contact
await reset();
const vividPrep = await linkPrepToLifecycle(
  session,
  {
    companyName: "Vivid Pix QA",
    companyDomain: "vivid-pix.com",
    prospectEmail: "rick@vivid-pix.com",
    prospectEmails: ["rick@vivid-pix.com", "howard@duckdiverllc.com"],
    prepType: "new_business",
  },
  {
    prospects: [
      { name: "Rick Voight", email: "rick@vivid-pix.com" },
      { name: "Howard Ehrenberg", email: "howard@duckdiverllc.com" },
    ],
  },
  { company: "Vivid Pix QA", domain: "vivid-pix.com" },
);
await linkPostCallToLifecycle(
  session,
  {
    companyName: "Vivid Pix QA",
    companyDomain: "vivid-pix.com",
    accountId: vividPrep.accountId,
    dealId: vividPrep.dealId,
    prospectEmails: ["rick@vivid-pix.com", "howard.ehrenberg@vivid-pix.com"],
    confirmedIdentities: {
      customerIdentities: ["Howard Ehrenberg <howard.ehrenberg@vivid-pix.com>"],
    },
    prepType: "new_business",
  },
  { analysis: { callHeader: { company: "Vivid Pix QA" } } },
  { id: "pc_vivid", dealId: vividPrep.dealId },
);
const vividContacts = await store.listContactsByAccount(vividPrep.accountId);
const howards = vividContacts.filter((c) => /howard/i.test(c.name || c.email || ""));
assert.equal(howards.length, 1, "Howard must merge to one contact across prep/post-call");

console.log("test-prep-postcall-crm-parity.mjs: ok");
