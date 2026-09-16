#!/usr/bin/env node
/**
 * Requirement tests for the contact ↔ account ↔ deal cascade (local store).
 *
 * Salesforce shape: Account is the hub, Contact.accountId is 1:1, Deal.accountId is 1:many,
 * and membership of a contact on a deal lives ONLY in the dealContacts join
 * (OpportunityContactRole). Deal.primaryContactId is a denormalised pointer at the join row
 * with isPrimary: true — both must agree.
 *
 * The failure mode these tests exist to catch is duplication (a second account/contact/deal
 * per brief) and the opposite error of treating "contacts of the account" as "contacts of the
 * deal", which makes two deals on one account render identical people.
 *
 * Run: node web/scripts/test-contact-deal-mapping.mjs
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
const { clearLocalStoreCache, exportLocalDomainData } = await import("../domain/local-store.js");
const { clearAccountEngagementContext } = await import("../domain/account-context.js");
const { linkPrepToLifecycle, linkPostCallToLifecycle } = await import("../domain/dual-write.js");
const { resolveContactsForEmails } = await import("../postcall-contact-resolve.js");

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

initDomainStore(null);
const store = getStore();

const OWNER_ID = "usr_map_se";
const TEAM_ID = "team_map";
const ORG_ID = "org_map";
const TS = 1_700_000_000_000; // fixed. no Date.now()-dependent assertions below
const session = { email: "map@test.com", teamId: TEAM_ID, orgId: ORG_ID, userId: OWNER_ID };

/** Full reset between scenarios so a duplicate-count assertion can never be masked. */
async function resetStore() {
  store.clearAll();
  // clearAll() does not list "dealContacts" (asserted in test-deal-contacts-store.mjs), so
  // drop the join collection explicitly — otherwise scenarios inherit each other's links.
  localStorage.removeItem("se-singha-domain:dealContacts");
  clearLocalStoreCache();
  clearAccountEngagementContext();
  await store.upsertUser({
    id: OWNER_ID,
    email: session.email,
    authUid: null,
    displayName: "Map SE",
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

/** Run the prep dual-write exactly as precall does. */
function runPrep({ companyName, companyDomain, emails, prospects, dealId, createNewDeal }) {
  const payload = {
    companyName,
    companyDomain,
    prospectEmail: emails[0],
    prospectEmails: emails,
    prepType: "new_business",
    ...(dealId ? { dealId } : {}),
    ...(createNewDeal ? { createNewDeal: true } : {}),
  };
  const prep = { companyOverview: `${companyName} overview`, prospects: prospects || [] };
  return linkPrepToLifecycle(session, payload, prep, { company: companyName, companyDomain });
}

/** Run the post-call dual-write with SE-typed participant emails. */
function runPostCall({ companyName, companyDomain, emails, callId }) {
  const analysis = {
    callHeader: { company: companyName, attendees: [] },
    qualityCoach: { overall: 7 },
  };
  const payload = {
    companyName,
    companyDomain,
    prospectEmails: emails,
    prepType: "new_business",
  };
  const record = { id: callId, title: `${companyName} — Discovery`, analysis };
  return linkPostCallToLifecycle(session, payload, { analysis }, record);
}

const contactIdsOf = (rows) => (rows || []).map((r) => r.contactId).sort();

// ---------------------------------------------------------------------------
// 1. A brief for a previously unseen contact email cascades to exactly one of each.
// ---------------------------------------------------------------------------
await check("new contact cascades to exactly one account, one deal, one linked contact", async () => {
  await resetStore();
  const res = await runPrep({
    companyName: "Cascade Co",
    companyDomain: "cascade.co",
    emails: ["dana@cascade.co"],
    prospects: [{ name: "Dana Rao", role: "VP Support", email: "dana@cascade.co" }],
  });
  assert.ok(res?.accountId, "linkPrepToLifecycle returned no accountId — the cascade did not run");

  const accounts = await store.listAccounts();
  assert.equal(accounts.length, 1, `expected exactly 1 account after one brief, got ${accounts.length} (${accounts.map((a) => a.slug).join(", ")})`);

  const deals = await store.listDealsByAccount(res.accountId);
  assert.equal(deals.length, 1, `expected exactly 1 deal on the new account, got ${deals.length}`);

  const contacts = await store.listContactsByAccount(res.accountId);
  assert.equal(contacts.length, 1, `expected exactly 1 contact on the new account, got ${contacts.length} (${contacts.map((c) => c.email).join(", ")})`);
  assert.equal(contacts[0].email, "dana@cascade.co", `contact email should be the typed prospect email, got ${contacts[0].email}`);

  const links = await store.listContactsByDeal(deals[0].id);
  assert.equal(links.length, 1, `the brief's contact must be linked to the new deal via dealContacts — expected 1 join row on ${deals[0].id}, got ${links.length}`);
  assert.equal(links[0].contactId, contacts[0].id, `the deal's join row must point at the account's contact (${contacts[0].id}), got ${links[0].contactId}`);
  assert.equal(links[0].accountId, res.accountId, `join row accountId must be ${res.accountId}, got ${links[0].accountId}`);
});

// ---------------------------------------------------------------------------
// 2. The same email a second time maps onto the existing records, never duplicates.
// ---------------------------------------------------------------------------
await check("existing contact maps rather than duplicating account, contact or deal", async () => {
  await resetStore();
  const first = await runPrep({
    companyName: "Cascade Co",
    companyDomain: "cascade.co",
    emails: ["dana@cascade.co"],
    prospects: [{ name: "Dana Rao", role: "VP Support", email: "dana@cascade.co" }],
  });
  const firstDeals = await store.listDealsByAccount(first.accountId);
  const firstContacts = await store.listContactsByAccount(first.accountId);

  const second = await runPrep({
    companyName: "Cascade Co",
    companyDomain: "cascade.co",
    emails: ["dana@cascade.co"],
    prospects: [{ name: "Dana Rao", role: "VP Support", email: "dana@cascade.co" }],
  });

  assert.equal(second.accountId, first.accountId, `second brief for the same company must reuse account ${first.accountId}, got ${second.accountId}`);
  const accounts = await store.listAccounts();
  assert.equal(accounts.length, 1, `a repeat brief must not create a second account — got ${accounts.length} (${accounts.map((a) => a.slug).join(", ")})`);

  const contacts = await store.listContactsByAccount(first.accountId);
  assert.equal(contacts.length, 1, `a repeat brief for the same email must not create a second contact — got ${contacts.length}`);
  assert.equal(contacts[0].id, firstContacts[0].id, `the repeat brief must update contact ${firstContacts[0].id}, not replace it with ${contacts[0].id}`);

  const deals = await store.listDealsByAccount(first.accountId);
  assert.equal(deals.length, 1, `no second deal was asked for, so the existing deal must be reused — got ${deals.length} deals`);
  assert.equal(deals[0].id, firstDeals[0].id, `the repeat brief must reuse deal ${firstDeals[0].id}, got ${deals[0].id}`);

  const links = await store.listContactsByDeal(deals[0].id);
  assert.equal(links.length, 1, `the join must stay a single row for the same (deal, contact) pair — got ${links.length} rows on ${deals[0].id}`);
});

// ---------------------------------------------------------------------------
// 3. Two deals on one account with different contact sets. This is the bug that makes
//    the relation look like it already works: deal-view.js renders
//    store.listContactsByAccount(accountId), i.e. ALL of the account's contacts, so both
//    deals show identical people. Assert against the join, never against the account.
// ---------------------------------------------------------------------------
await check("two deals on one account keep different contact sets", async () => {
  await resetStore();
  const accountId = "acc_map_multi";
  await store.createAccount({
    id: accountId,
    name: "Multi Co",
    slug: "multi.co",
    domain: "multi.co",
    createdAt: TS,
    updatedAt: TS,
    seTeam: [{ seUserId: OWNER_ID, role: "primary", addedAt: TS }],
    primarySeUserId: OWNER_ID,
  });
  const dealA = "deal_map_multi_a";
  const dealB = "deal_map_multi_b";
  for (const [id, title] of [[dealA, "Multi Co - Deal 1"], [dealB, "Multi Co - Deal 2"]]) {
    await store.createDeal({
      id,
      accountId,
      type: "new_business",
      stage: "research",
      status: "active",
      ownerId: OWNER_ID,
      teamId: TEAM_ID,
      orgId: ORG_ID,
      primaryContactId: null,
      title,
      prepCount: 0,
      postCallCount: 0,
      openTaskCount: 0,
      latestQualityScore: null,
      createdAt: TS,
      updatedAt: TS,
      lastActivityAt: TS,
    });
  }

  await runPrep({
    companyName: "Multi Co",
    companyDomain: "multi.co",
    emails: ["ann@multi.co"],
    prospects: [{ name: "Ann Iyer", role: "Head of Support", email: "ann@multi.co" }],
    dealId: dealA,
  });
  await runPrep({
    companyName: "Multi Co",
    companyDomain: "multi.co",
    emails: ["bob@multi.co"],
    prospects: [{ name: "Bob Sen", role: "CTO", email: "bob@multi.co" }],
    dealId: dealB,
  });

  const deals = await store.listDealsByAccount(accountId);
  assert.equal(deals.length, 2, `both briefs targeted existing deals, so the account must still have 2 deals — got ${deals.length}`);

  const accountContacts = await store.listContactsByAccount(accountId);
  assert.equal(accountContacts.length, 2, `both prospects belong to the one account — expected 2 account contacts, got ${accountContacts.length}`);
  const ann = accountContacts.find((c) => c.email === "ann@multi.co");
  const bob = accountContacts.find((c) => c.email === "bob@multi.co");
  assert.ok(ann && bob, `expected contacts ann@multi.co and bob@multi.co on the account, got ${accountContacts.map((c) => c.email).join(", ")}`);

  const onA = contactIdsOf(await store.listContactsByDeal(dealA));
  const onB = contactIdsOf(await store.listContactsByDeal(dealB));
  assert.deepEqual(onA, [ann.id], `deal ${dealA} must carry only ann@multi.co — got ${onA.length} join row(s)`);
  assert.deepEqual(onB, [bob.id], `deal ${dealB} must carry only bob@multi.co — got ${onB.length} join row(s)`);
  assert.notDeepEqual(onA, onB, "the two deals on this account must not resolve to the same contact list — reading listContactsByAccount instead of the dealContacts join is the bug");
});

// ---------------------------------------------------------------------------
// 4. Deal.primaryContactId is a denormalised pointer at the isPrimary join row. Asserted
//    through the cascade, which is the only supported way to move the primary: the raw
//    store.setPrimaryDealContact() is a join-only primitive by design (deal-service.js
//    linkDealContacts owns "join first, then patch the pointer").
// ---------------------------------------------------------------------------
await check("deal.primaryContactId agrees with the isPrimary join row", async () => {
  await resetStore();
  const res = await runPrep({
    companyName: "Primary Co",
    companyDomain: "primary.co",
    emails: ["ada@primary.co", "ben@primary.co"],
    prospects: [
      { name: "Ada Pillai", role: "VP Support", email: "ada@primary.co" },
      { name: "Ben Rao", role: "Support Lead", email: "ben@primary.co" },
    ],
  });
  const deals = await store.listDealsByAccount(res.accountId);
  assert.equal(deals.length, 1, `expected 1 deal from the first brief, got ${deals.length}`);
  const dealId = deals[0].id;

  const contacts = await store.listContactsByAccount(res.accountId);
  const ada = contacts.find((c) => c.email === "ada@primary.co");
  assert.ok(ada, `expected contact ada@primary.co on the account, got ${contacts.map((c) => c.email).join(", ")}`);

  const links = await store.listContactsByDeal(dealId);
  const primaries = links.filter((l) => l.isPrimary === true);
  assert.equal(primaries.length, 1, `a deal must have exactly one isPrimary join row — got ${primaries.length} on ${dealId}`);
  assert.equal(primaries[0].contactId, ada.id, `the first typed prospect should be the primary on the join, got ${primaries[0].contactId}`);
  assert.equal(
    deals[0].primaryContactId,
    primaries[0].contactId,
    `deal.primaryContactId (${JSON.stringify(deals[0].primaryContactId)}) must equal the isPrimary join row's contactId (${primaries[0].contactId}) — the denormalised pointer and the join disagree`,
  );

  // A later brief that nominates a different primary must leave the two representations
  // agreeing, whichever way the backfill rule resolves it.
  await runPrep({
    companyName: "Primary Co",
    companyDomain: "primary.co",
    emails: ["cyd@primary.co"],
    prospects: [{ name: "Cyd Menon", role: "CIO", email: "cyd@primary.co" }],
    dealId,
  });
  const dealAfter = await store.getDeal(dealId);
  const linksAfter = await store.listContactsByDeal(dealId);
  const primariesAfter = linksAfter.filter((l) => l.isPrimary === true);
  assert.equal(primariesAfter.length, 1, `still exactly one isPrimary join row after a second brief — got ${primariesAfter.length}`);
  assert.equal(
    dealAfter.primaryContactId,
    primariesAfter[0].contactId,
    `after a second brief the pointer (${JSON.stringify(dealAfter.primaryContactId)}) and the isPrimary join row (${primariesAfter[0].contactId}) diverged — two writers are applying different primary-contact policies`,
  );
});

// ---------------------------------------------------------------------------
// 5. Post-call must not leave behind an account with no contacts. dual-write calls
//    upsertAccountFromPrep without the typed emails (collectEmails returns []), so the
//    contact has to arrive some other way before the flow ends.
// ---------------------------------------------------------------------------
await check("post-call does not create an account with zero contacts", async () => {
  await resetStore();
  const res = await runPostCall({
    companyName: "Newpc Co",
    companyDomain: "newpc.co",
    emails: ["ravi@newpc.co"],
    callId: "call_map_newpc",
  });
  assert.ok(res?.accountId, "linkPostCallToLifecycle returned no accountId — the post-call cascade did not run");

  const accounts = await store.listAccounts();
  assert.equal(accounts.length, 1, `expected exactly 1 account after one post-call, got ${accounts.length} (${accounts.map((a) => a.slug).join(", ")})`);

  for (const account of accounts) {
    const contacts = await store.listContactsByAccount(account.id);
    assert.ok(
      contacts.length >= 1,
      `account ${account.slug} (${account.id}) ended the post-call flow with 0 contacts — a typed participant email must become a contact on the account`,
    );
  }

  const contacts = await store.listContactsByAccount(res.accountId);
  assert.ok(
    contacts.some((c) => c.email === "ravi@newpc.co"),
    `the typed participant ravi@newpc.co must exist as a contact on the account — got ${contacts.map((c) => c.email).join(", ") || "none"}`,
  );
});

// ---------------------------------------------------------------------------
// 6. A contact cannot exist without an account (existing invariant).
// ---------------------------------------------------------------------------
await check("no contact exists without a resolvable account", async () => {
  await resetStore();
  await runPrep({
    companyName: "Invariant Co",
    companyDomain: "invariant.co",
    emails: ["kay@invariant.co", "lee@invariant.co"],
    prospects: [
      { name: "Kay Nair", role: "Director", email: "kay@invariant.co" },
      { name: "Lee Das", role: "Manager", email: "lee@invariant.co" },
    ],
  });
  await runPostCall({
    companyName: "Invariant Co",
    companyDomain: "invariant.co",
    emails: ["mia@invariant.co"],
    callId: "call_map_invariant",
  });

  const all = exportLocalDomainData().contacts || [];
  assert.ok(all.length >= 3, `expected the cascade to have written at least 3 contacts, got ${all.length} — the check would otherwise be vacuous`);
  for (const c of all) {
    assert.ok(c.accountId, `contact ${c.id} (${c.email}) has no accountId — a contact must belong to exactly one account`);
    const account = await store.getAccount(c.accountId);
    assert.ok(account, `contact ${c.id} (${c.email}) points at missing account ${c.accountId} — orphaned contact`);
  }
});

// ---------------------------------------------------------------------------
// 6b. Referential integrity of the join itself: a join row must never straddle accounts.
// ---------------------------------------------------------------------------
await check("dealContacts rows never straddle two accounts", async () => {
  await resetStore();
  await runPrep({
    companyName: "Straddle Co",
    companyDomain: "straddle.co",
    emails: ["nia@straddle.co"],
    prospects: [{ name: "Nia Roy", role: "VP", email: "nia@straddle.co" }],
  });
  // Walk the join through the public API — exportLocalDomainData() does not list
  // "dealContacts", so the raw dump cannot be used here.
  const contactsById = new Map((exportLocalDomainData().contacts || []).map((c) => [c.id, c]));
  const links = [];
  for (const account of await store.listAccounts()) {
    for (const deal of await store.listDealsByAccount(account.id)) {
      for (const link of await store.listContactsByDeal(deal.id)) links.push({ link, deal });
    }
  }
  assert.ok(links.length >= 1, "the prep cascade wrote no dealContacts rows, so join integrity cannot be checked");
  for (const { link, deal } of links) {
    assert.ok(await store.getAccount(link.accountId), `join row ${link.id} points at missing account ${link.accountId}`);
    assert.equal(link.accountId, deal.accountId, `join row ${link.id} claims account ${link.accountId} but its deal belongs to ${deal.accountId}`);
    const contactRow = contactsById.get(link.contactId);
    assert.ok(contactRow, `join row ${link.id} points at missing contact ${link.contactId}`);
    assert.equal(
      contactRow.accountId,
      deal.accountId,
      `join row ${link.id} links contact ${link.contactId} (account ${contactRow.accountId}) to a deal on account ${deal.accountId} — a contact can only be on its own account's deals`,
    );
  }
});

// ---------------------------------------------------------------------------
// 7. Free-mail emails must not match an unrelated account by domain. isFreeMailDomain()
//    gates the domain fallback in postcall-contact-resolve.js.
// ---------------------------------------------------------------------------
await check("free-mail contact does not bleed into an unrelated account by domain", async () => {
  await resetStore();

  // A corporate account with a contact — the domain fallback SHOULD still find this one.
  const corpId = "acc_map_corp";
  await store.createAccount({
    id: corpId,
    name: "Corp Co",
    slug: "corp.co",
    domain: "corp.co",
    createdAt: TS,
    updatedAt: TS,
    seTeam: [{ seUserId: OWNER_ID, role: "primary", addedAt: TS }],
    primarySeUserId: OWNER_ID,
  });
  await store.createContact({
    id: "con_map_corp",
    accountId: corpId,
    email: "bob@corp.co",
    name: "Bob Corp",
    createdAt: TS,
    updatedAt: TS,
  });

  // An account that mis-stored a free-mail domain. It must never be matched by domain.
  const freeId = "acc_map_freemail";
  await store.createAccount({
    id: freeId,
    name: "Free Mail Co",
    slug: "free-mail-co",
    domain: "gmail.com",
    createdAt: TS,
    updatedAt: TS,
  });

  // The gmail-only prospect gets their own account via the normal prep cascade.
  const solo = await runPrep({
    companyName: "Solo Ventures",
    emails: ["solo@gmail.com"],
    prospects: [{ name: "Solo Singh", role: "Founder", email: "solo@gmail.com" }],
  });
  assert.notEqual(solo.accountId, freeId, "the gmail prospect must not be filed under the account whose domain is gmail.com");

  const resolved = await resolveContactsForEmails(["solo@gmail.com"]);
  const entry = resolved.byEmail[0];
  assert.ok(entry, "resolveContactsForEmails returned no entry for solo@gmail.com");
  assert.equal(entry.contact?.email, "solo@gmail.com", `expected the direct contact match for solo@gmail.com, got ${JSON.stringify(entry.contact?.email)}`);
  const matchedIds = resolved.accounts.map((a) => a.id).sort();
  assert.deepEqual(
    matchedIds,
    [solo.accountId],
    `a gmail address must resolve only to its own account (${solo.accountId}) — got [${matchedIds.join(", ")}]; the free-mail domain fallback bled in`,
  );
  assert.ok(
    !resolved.deals.some((d) => d.accountId === freeId || d.accountId === corpId),
    "no deal from an unrelated account may surface for a free-mail address",
  );

  // Sanity: the gate is selective, not blanket-off — a corporate domain still falls back.
  const corpResolved = await resolveContactsForEmails(["newperson@corp.co"]);
  assert.ok(
    corpResolved.accounts.some((a) => a.id === corpId),
    "a previously unseen corporate address must still match its account by domain — the free-mail gate must not disable the fallback entirely",
  );
});

/**
 * "+ New deal" must actually create a second deal.
 *
 * Three separate branches used to swallow this: getOrCreateLifecycle returned the account's
 * existing active lifecycle before deal resolution ran, resolveDealForEngagement reused
 * motion.dealId from session context, and getOrCreateNewBusinessDeal short-circuited on
 * findActiveDeal. Any one of them left the UI promising a deal it could not create, so this
 * asserts the count — not just that the call succeeded.
 */
await check("createNewDeal opens a second deal on the same account", async () => {
  await resetStore();
  const first = await runPrep({
    companyName: "Twodeal Co",
    companyDomain: "twodeal.co",
    emails: ["ceo@twodeal.co"],
  });
  assert.ok(first?.dealId, "first prep produced no deal");

  const dealsAfterFirst = await store.listDealsByAccount(first.accountId);
  assert.equal(dealsAfterFirst.length, 1, `expected 1 deal after the first brief, got ${dealsAfterFirst.length}`);

  const second = await runPrep({
    companyName: "Twodeal Co",
    companyDomain: "twodeal.co",
    emails: ["cto@twodeal.co"],
    createNewDeal: true,
  });
  assert.ok(second?.dealId, "createNewDeal prep produced no deal");
  assert.notEqual(
    second.dealId,
    first.dealId,
    "createNewDeal returned the existing deal — a reuse branch still swallows the flag",
  );

  const dealsAfterSecond = await store.listDealsByAccount(second.accountId);
  assert.equal(
    dealsAfterSecond.length,
    2,
    `expected 2 deals on the account, got ${dealsAfterSecond.length}`,
  );
  assert.equal(second.accountId, first.accountId, "the second deal must land on the SAME account");
});

/** Without the flag the existing deal is still reused — the fix must not fork on every brief. */
await check("a repeat brief without the flag reuses the deal", async () => {
  await resetStore();
  const first = await runPrep({
    companyName: "Onedeal Co",
    companyDomain: "onedeal.co",
    emails: ["ceo@onedeal.co"],
  });
  const second = await runPrep({
    companyName: "Onedeal Co",
    companyDomain: "onedeal.co",
    emails: ["ceo@onedeal.co"],
  });
  assert.equal(second.dealId, first.dealId, "a repeat brief must reuse the account's active deal");
  const deals = await store.listDealsByAccount(first.accountId);
  assert.equal(deals.length, 1, `expected the account to still have 1 deal, got ${deals.length}`);
});

/** The new deal must carry its own contacts, not inherit the first deal's. */
await check("the second deal gets its own join rows", async () => {
  await resetStore();
  const first = await runPrep({
    companyName: "Scoped Co",
    companyDomain: "scoped.co",
    emails: ["first@scoped.co"],
  });
  const second = await runPrep({
    companyName: "Scoped Co",
    companyDomain: "scoped.co",
    emails: ["second@scoped.co"],
    createNewDeal: true,
  });

  const firstLinks = await store.listContactsByDeal(first.dealId);
  const secondLinks = await store.listContactsByDeal(second.dealId);
  assert.ok(firstLinks.length, "the first deal lost its join rows");
  assert.ok(secondLinks.length, "the second deal has no join rows — B4's link step did not run");
  assert.notDeepEqual(
    firstLinks.map((l) => l.contactId).sort(),
    secondLinks.map((l) => l.contactId).sort(),
    "both deals show the same contacts — the join is being read account-wide again",
  );
  // The pointer and the join must agree on each deal independently.
  for (const [dealId, links] of [[first.dealId, firstLinks], [second.dealId, secondLinks]]) {
    const deal = await store.getDeal(dealId);
    const primaryRow = links.find((l) => l.isPrimary);
    assert.ok(primaryRow, `deal ${dealId} has join rows but none is primary`);
    assert.equal(
      deal.primaryContactId,
      primaryRow.contactId,
      `deal ${dealId}: primaryContactId disagrees with the join's isPrimary row`,
    );
  }
});

/**
 * An account the SE explicitly picked in the CRM panel must be used as-is.
 *
 * payload.accountId was resolved by the panel and then dropped before upsertAccountFromPrep,
 * which re-derived the account from the typed company name. Selecting "Acme Corporation"
 * (slug `acme.com`) while typing the shorthand "Acme" with a free-mail prospect — so no domain
 * to slug from — missed the account and created a duplicate the SE had just pointed at.
 */
await check("an explicitly selected accountId is honoured, not re-derived", async () => {
  await resetStore();
  await store.createAccount({
    id: "account_selected",
    name: "Acme Corporation",
    domain: "acme.com",
    slug: "acme.com",
    seTeam: [{ seUserId: OWNER_ID, role: "primary", addedAt: TS }],
    primarySeUserId: OWNER_ID,
    createdAt: TS,
    updatedAt: TS,
  });

  const res = await linkPrepToLifecycle(
    session,
    {
      companyName: "Acme", // slugs to `acme`; the account is `acme.com`
      prospectEmails: ["buyer@gmail.com"], // free-mail, so no domain is recoverable
      prepType: "new_business",
      accountId: "account_selected",
    },
    { prospects: [] },
    { company: "Acme" },
  );

  assert.equal(
    res.accountId,
    "account_selected",
    "the brief must attach to the account the SE selected, not one re-derived from the typed name",
  );
  const accounts = await store.listAccounts();
  assert.equal(
    accounts.length,
    1,
    `selecting an existing account must not fork a second one — got ${accounts.length} (${accounts.map((a) => a.slug).join(", ")})`,
  );
  const account = await store.getAccount("account_selected");
  assert.equal(
    account.name,
    "Acme Corporation",
    "a search-box shorthand must not rename the selected account — the name feeds generated deal titles",
  );
});

/** A stale/deleted id must degrade to the slug path, not throw or strand the brief. */
await check("an unresolvable selected accountId falls back to slug resolution", async () => {
  await resetStore();
  const res = await linkPrepToLifecycle(
    session,
    {
      companyName: "Ghost Co",
      companyDomain: "ghost.co",
      prospectEmails: ["someone@ghost.co"],
      prepType: "new_business",
      accountId: "account_does_not_exist",
    },
    { prospects: [] },
    { company: "Ghost Co" },
  );
  assert.ok(res?.accountId, "a stale selected accountId must not strand the brief");
  assert.notEqual(res.accountId, "account_does_not_exist", "the missing id must not be adopted verbatim");
  const account = await store.getAccount(res.accountId);
  assert.equal(account.slug, "ghost.co", `expected slug resolution to take over, got ${account.slug}`);
});

/** Name-only post-call match must not attach to wrong duplicate (CONT-002). */
await check("ambiguous name-only attendee skips framework merge", async () => {
  await resetStore();
  const accountId = "account_dup_names";
  await store.createAccount({
    id: accountId,
    name: "Dup Names Co",
    slug: "dup.co",
    domain: "dup.co",
    createdAt: TS,
    updatedAt: TS,
    seTeam: [{ seUserId: "usr_se", role: "primary", addedAt: TS }],
    primarySeUserId: "usr_se",
  });
  await store.createContact({
    id: "con_jordan_a",
    accountId,
    email: "jordan.a@dup.co",
    name: "Jordan Lee",
    createdAt: TS,
    updatedAt: TS,
  });
  await store.createContact({
    id: "con_jordan_b",
    accountId,
    email: "jordan.b@dup.co",
    name: "Jordan Lee",
    createdAt: TS,
    updatedAt: TS,
  });

  const { findContactByAccountName, applyPostCallContactFrameworks } = await import(
    "../domain/contact-service.js"
  );
  const contacts = await store.listContactsByAccount(accountId);
  assert.equal(await findContactByAccountName(accountId, "Jordan Lee", contacts), null);

  const result = await applyPostCallContactFrameworks(
    accountId,
    { callHeader: { attendees: [{ name: "Jordan Lee" }] } },
    { actorId: "usr_se", postCallId: "pc_dup" },
  );
  assert.equal(result.contactChanges.length, 0, "ambiguous name-only must not merge frameworks");
});

const passed = results.filter(Boolean).length;
if (passed !== results.length) {
  console.error(`\n${passed}/${results.length} contact-deal mapping checks passed.`);
  process.exit(1);
}
console.log(`\n${results.length} contact-deal mapping checks passed.`);
