#!/usr/bin/env node
/**
 * End-to-end: pre-call payload → linkPrepToLifecycle → account, deal, contact, lifecycle, prepBrief.
 * Run: node web/scripts/test-precall-dual-write-e2e.mjs
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
const { linkPrepToLifecycle } = await import("../domain/dual-write.js");
const { listAccountsForSession } = await import("../domain/account-service.js?v=2.1");
const { lookupPrepCrmMatches } = await import("../prep-crm-resolve.js");
const { resolveCompanyDomainForSubmit } = await import("../prep-domain.js");

initDomainStore(null);
const store = getStore();

const OWNER_ID = "usr_precall_e2e";
const TEAM_ID = "team_precall_e2e";
const ORG_ID = "org_precall_e2e";
const TS = 1_700_100_000_000;
const session = { email: "precall-e2e@test.com", teamId: TEAM_ID, orgId: ORG_ID, userId: OWNER_ID };

async function reset() {
  store.clearAll();
  localStorage.removeItem("se-singha-domain:dealContacts");
  clearLocalStoreCache();
  clearAccountEngagementContext();
  await store.upsertUser({
    id: OWNER_ID,
    email: session.email,
    authUid: null,
    displayName: "Precall E2E SE",
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

await reset();

const rawEmails = "buyer@acmecorp.com";
const companyDomain = resolveCompanyDomainForSubmit("", rawEmails);
assert.equal(companyDomain, "acmecorp.com", "domain must infer from corporate email");

const payload = {
  companyName: "Acmecorp",
  companyDomain,
  prospectEmail: "buyer@acmecorp.com",
  prospectEmails: ["buyer@acmecorp.com"],
  prepType: "new_business",
};

const prep = {
  companyOverview: "Acme makes widgets.",
  prospects: [{ name: "Buyer", email: "buyer@acmecorp.com", title: "VP Ops" }],
  facts: [{ key: "Company size", value: "500", category: "signal" }],
};

const meta = {
  company: "Acmecorp",
  companyDomain,
  domain: companyDomain,
  researchBundle: {
    inputHash: "hash-e2e",
    facts: prep.facts,
    sources: [],
    snippets: [],
    lastResearchedAt: TS,
    playbookVersion: "1",
  },
};

const linked = await linkPrepToLifecycle(session, payload, prep, meta);
assert.ok(linked?.accountId, "account must be created");
assert.ok(linked?.dealId, "deal must be created");
assert.ok(linked?.lifecycle?.id, "lifecycle must be created");
assert.ok(linked?.prepBrief?.id, "prepBrief must be created");
assert.ok(linked?.contactIds?.length === 1, "one contact must be linked");

const account = await store.getAccount(linked.accountId);
assert.equal(account.domain, "acmecorp.com", "account domain must match email domain");

const deal = await store.getDeal(linked.dealId);
assert.equal(deal.accountId, linked.accountId, "deal must belong to account");

const lifecycle = await store.getLifecycle(linked.lifecycle.id);
assert.equal(lifecycle.dealId, linked.dealId, "lifecycle must reference deal");

const prepBrief = await store.getPrepBrief?.(linked.prepBrief.id);
assert.ok(prepBrief || linked.prepBrief, "prepBrief persisted");

const rows = await listAccountsForSession(session);
assert.equal(rows.length, 1, "account must appear in Accounts nav list");
assert.equal(rows[0].account.id, linked.accountId, "listed account must match created account");

const crm = await lookupPrepCrmMatches(["buyer@acmecorp.com"], {
  companyName: "Acmecorp",
  companyDomain,
});
assert.ok(crm.accounts.some((a) => a.id === linked.accountId), "CRM lookup must find account by email domain");
assert.ok(crm.deals.some((d) => d.id === linked.dealId), "CRM lookup must find deal");

// Personal email + explicit company domain still resolves account on repeat brief.
await reset();
const gmailPayload = {
  companyName: "Widget Co",
  companyDomain: "widget.co",
  prospectEmail: "ceo@gmail.com",
  prospectEmails: ["ceo@gmail.com"],
  prepType: "new_business",
};
const gmailLinked = await linkPrepToLifecycle(
  session,
  gmailPayload,
  { prospects: [{ email: "ceo@gmail.com" }] },
  { company: "Widget Co", companyDomain: "widget.co" },
);
assert.ok(gmailLinked?.accountId, "free-mail prospect with explicit domain must still create account");
const byDomain = await lookupPrepCrmMatches(["ceo@gmail.com"], {
  companyName: "Widget Co",
  companyDomain: "widget.co",
});
assert.ok(
  byDomain.accounts.some((a) => a.id === gmailLinked.accountId),
  "CRM lookup must match by company domain when email is personal",
);

console.log("test-precall-dual-write-e2e.mjs: ok");
