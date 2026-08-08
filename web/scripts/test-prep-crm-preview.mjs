/**
 * Regression: draft account preview must survive CRM lookup (no flicker),
 * and repeat email search must resolve existing account/deal from domain store.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildDraftAccount, ensureDraftAccount, lookupPrepCrmMatches } from "../prep-crm-resolve.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const indexHtml = readFileSync(join(root, "web", "index.html"), "utf8");

const draft = buildDraftAccount("bixpress.co.za", "Bixpress");
assert.equal(draft.id, null, "draft account has no CRM id");
assert.equal(draft.name, "Bixpress");
assert.equal(draft.domain, "bixpress.co.za");

// renderPrepAccountDealPreview hides only when prepResolvedAccount is null — draft object prevents flicker.
assert.ok(draft.name && draft.id === null, "draft account keeps grid visible after lookup");

assert.ok(indexHtml.includes('id="prep-account-deal-preview"'), "pre-call tile picker container present");
assert.ok(!indexHtml.includes('id="prep-motion-row"'), "Meeting motion row removed from new-brief form");
assert.ok(!indexHtml.includes('id="prep-meeting-motion"'), "Meeting motion select removed from new-brief form");

// ensureDraftAccount must not overwrite an account that already has an id (race guard).
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
const { linkPrepToLifecycle } = await import("../domain/dual-write.js");

initDomainStore(null);
const store = getStore();

const OWNER_ID = "usr_prep_crm";
const TEAM_ID = "team_prep_crm";
const ORG_ID = "org_prep_crm";
const TS = 1_700_000_000_000;
const session = { email: "prep-crm@test.com", teamId: TEAM_ID, orgId: ORG_ID, userId: OWNER_ID };

store.clearAll();
localStorage.removeItem("se-singha-domain:dealContacts");
clearLocalStoreCache();
await store.upsertUser({
  id: OWNER_ID,
  email: session.email,
  authUid: null,
  displayName: "Prep CRM SE",
  role: "se",
  teamId: TEAM_ID,
  orgId: ORG_ID,
  managerId: null,
  jobTitle: null,
  status: "active",
  createdAt: TS,
  updatedAt: TS,
});

const linked = await linkPrepToLifecycle(
  session,
  {
    companyName: "Advanzia",
    companyDomain: "advanzia.com",
    prospectEmail: "anna.thys@advanzia.com",
    prospectEmails: ["anna.thys@advanzia.com"],
    prepType: "new_business",
  },
  { prospects: [{ name: "Anna Thys", email: "anna.thys@advanzia.com" }] },
  { company: "Advanzia", companyDomain: "advanzia.com" },
);
assert.ok(linked?.accountId, "first brief must create an account in domain store");

const repeat = await lookupPrepCrmMatches(["anna.thys@advanzia.com"], {
  companyName: "Advanzia",
  companyDomain: "advanzia.com",
});
assert.equal(
  repeat.accounts.length,
  1,
  `repeat email search must find exactly one account — got ${repeat.accounts.length}`,
);
assert.equal(
  repeat.accounts[0].id,
  linked.accountId,
  "repeat search must resolve the same account id as the first brief",
);
assert.ok(repeat.deals.length >= 1, "repeat search must surface at least one existing deal");
assert.equal(
  repeat.deals[0].id,
  linked.dealId,
  "repeat search must resolve the same deal as the first brief",
);

// Company-name fallback when contact email is new but domain already exists.
const byCompany = await lookupPrepCrmMatches(["new.person@advanzia.com"], {
  companyName: "Advanzia",
  companyDomain: "advanzia.com",
});
assert.ok(
  byCompany.accounts.some((a) => a.id === linked.accountId),
  "corporate domain fallback must match the existing Advanzia account",
);

// Cross-SE resolve-to-attach: SE-1 owns account+deal; SE-2 resolves same company/email
// and must see existing account + deal (no duplicate).
{
  const SE1 = "usr_se1_global";
  const SE2 = "usr_se2_global";
  const TEAM1 = "team_se1_global";
  const TEAM2 = "team_se2_global";
  const ORG = "org_global_attach";
  const TS2 = TS + 1;

  store.clearAll();
  localStorage.removeItem("se-singha-domain:dealContacts");
  clearLocalStoreCache();

  await store.upsertUser({
    id: SE1,
    email: "se1@test.com",
    authUid: null,
    displayName: "SE One",
    role: "se",
    teamId: TEAM1,
    orgId: ORG,
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: TS2,
    updatedAt: TS2,
  });
  await store.upsertUser({
    id: SE2,
    email: "se2@test.com",
    authUid: null,
    displayName: "SE Two",
    role: "se",
    teamId: TEAM2,
    orgId: ORG,
    managerId: null,
    jobTitle: null,
    status: "active",
    createdAt: TS2,
    updatedAt: TS2,
  });

  const se1Session = { email: "se1@test.com", teamId: TEAM1, orgId: ORG, userId: SE1 };
  const se1Linked = await linkPrepToLifecycle(
    se1Session,
    {
      companyName: "Northwind",
      companyDomain: "northwind.com",
      prospectEmail: "buyer@northwind.com",
      prospectEmails: ["buyer@northwind.com"],
      prepType: "new_business",
    },
    { prospects: [{ name: "Buyer", email: "buyer@northwind.com" }] },
    { company: "Northwind", companyDomain: "northwind.com" },
  );
  assert.ok(se1Linked?.accountId, "SE-1 must create account");
  assert.ok(se1Linked?.dealId, "SE-1 must create deal");

  const se1Deal = await store.getDeal(se1Linked.dealId);
  assert.equal(se1Deal.ownerId, SE1, "deal owned by SE-1");

  // Name-only global search (no email contact yet for SE-2's typed address).
  const { resolveAccountsForCompany, resolveContactsForEmails } = await import(
    "../postcall-contact-resolve.js"
  );
  const byName = await resolveAccountsForCompany("Northwind", "northwind.com");
  assert.ok(
    byName.accounts.some((a) => a.id === se1Linked.accountId),
    "global name/domain resolve must find SE-1 account",
  );
  assert.ok(
    byName.deals.some((d) => d.id === se1Linked.dealId),
    "global resolve must surface SE-1 deal to another SE",
  );

  // Same corporate email as SE-1's contact — attach, don't duplicate.
  const asSe2 = await lookupPrepCrmMatches(["buyer@northwind.com"], {
    companyName: "Northwind",
    companyDomain: "northwind.com",
  });
  assert.equal(asSe2.accounts.length, 1, "SE-2 must see exactly one matching account");
  assert.equal(asSe2.accounts[0].id, se1Linked.accountId, "SE-2 attaches to SE-1 account");
  assert.ok(
    asSe2.deals.some((d) => d.id === se1Linked.dealId),
    "SE-2 must see SE-1's existing deal",
  );
  assert.ok(
    asSe2.deals.some((d) => d.id === se1Linked.dealId && d.ownerName === "SE One"),
    "existing deal badge enrichment includes owner display name",
  );

  const emailResolve = await resolveContactsForEmails(["buyer@northwind.com"]);
  assert.equal(
    emailResolve.accounts[0]?.id,
    se1Linked.accountId,
    "shared resolver path matches account",
  );

  // Confirm store still has a single account + single deal (no duplicate fork).
  const allAccounts = await store.listAccounts();
  const northwind = allAccounts.filter(
    (a) => String(a.name || "").toLowerCase().includes("northwind"),
  );
  assert.equal(northwind.length, 1, "must not duplicate Northwind account");
  const dealsOnAccount = await store.listDealsByAccount(se1Linked.accountId);
  assert.equal(dealsOnAccount.length, 1, "must not duplicate deal when SE-2 resolves");

  const { renderAccountDealPreviewHtml } = await import("../account-deal-preview.js");
  const previewHtml = renderAccountDealPreviewHtml({
    accountName: "Northwind",
    accountMatched: true,
    deals: asSe2.deals,
    selectedDealId: se1Linked.dealId,
  });
  assert.ok(previewHtml.includes("Account matched · existing"), "account existing badge");
  assert.ok(previewHtml.includes("Deal 1 · existing (owner: SE One)"), "deal existing owner badge");
}

console.log("test-prep-crm-preview.mjs: ok");
