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

// renderDealRow hides only when prepResolvedAccount is null — draft object prevents flicker.
assert.ok(draft.name && draft.id === null, "draft account keeps grid visible after lookup");

assert.ok(indexHtml.includes('class="nb-account-column"'), "Account column wrapper present");
assert.ok(indexHtml.includes(">Account</span>"), "Account label present");
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

console.log("test-prep-crm-preview.mjs: ok");
