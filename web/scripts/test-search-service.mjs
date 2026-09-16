/**
 * Smoke + integration tests for search-service (no browser).
 */
import { initDomainStore } from "../domain/store.js";
import { savePostCallAnalysis, storageKey } from "../history.js";
import {
  searchIndex,
  filterAccountRows,
  accountRowTokens,
  searchContacts,
  invalidateSearchIndex,
  buildSearchIndex,
  getSearchIndexStats,
  getCachedSearchIndex,
} from "../search-service.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const mockIndex = [
  {
    type: "account",
    id: "acc_1",
    accountId: "acc_1",
    label: "Acme Corp",
    subtitle: "acme.com · Discovery",
    tokens: ["acme corp", "acme.com", "discovery"],
    lastActivityAt: 1000,
  },
  {
    type: "brief",
    id: "brief_1",
    label: "Acme Corp",
    subtitle: "acme.com · Discovery brief",
    tokens: ["acme corp", "acme.com", "brief"],
    lastActivityAt: 900,
  },
  {
    type: "call",
    id: "call_1",
    label: "Acme discovery call",
    subtitle: "Strong discovery",
    tokens: ["acme discovery call", "call"],
    lastActivityAt: 800,
  },
];

const acmeResults = searchIndex(mockIndex, "acme");
assert(acmeResults.length >= 2, "search matches multiple entity types");
assert(acmeResults[0].type === "account" || acmeResults.some((r) => r.type === "account"), "includes account");

const domainResults = searchIndex(mockIndex, "acme.com");
assert(domainResults.some((r) => r.id === "acc_1"), "domain search finds account");

const rows = [
  {
    account: { id: "acc_1", name: "Acme Corp", domain: "acme.com" },
    lifecycle: { stage: "discovery", title: "Acme Corp", lastActivityAt: 1 },
    contacts: [{ name: "Alex Lee", email: "alex@acme.com" }],
  },
  {
    account: { id: "acc_2", name: "Beta Inc", domain: "beta.io" },
    lifecycle: { stage: "demo", title: "Beta Inc", lastActivityAt: 2 },
    contacts: [],
  },
];

const filtered = filterAccountRows(rows, "alex");
assert(filtered.length === 1 && filtered[0].account.id === "acc_1", "filterAccountRows matches contact");

const stageFiltered = filterAccountRows(rows, "demo");
assert(stageFiltered.length === 1 && stageFiltered[0].account.id === "acc_2", "filterAccountRows matches stage");

const tokens = accountRowTokens(rows[0], rows[0].contacts);
assert(tokens.includes("alex lee"), "accountRowTokens includes contact name");

const contactIndex = [
  {
    type: "contact",
    id: "c1",
    accountId: "acc_1",
    email: "alex@acme.com",
    label: "Alex Lee",
    subtitle: "VP · alex@acme.com · Acme Corp",
    tokens: ["alex lee", "alex@acme.com"],
    lastActivityAt: 1,
  },
];
const contactHits = searchContacts(contactIndex, "alex");
assert(contactHits.length === 1 && contactHits[0].id === "c1", "searchContacts finds by name");

const freshworksIndex = [
  {
    type: "account",
    id: "acc_fw",
    accountId: "acc_fw",
    label: "Freshworks",
    subtitle: "freshworks.com · Demo",
    tokens: ["freshworks", "freshworks.com", "demo"],
    lastActivityAt: 2000,
  },
];
const fwHits = searchIndex(freshworksIndex, "freshworks");
assert(fwHits.length === 1 && fwHits[0].id === "acc_fw", "freshworks token match");

const fwPartial = searchIndex(freshworksIndex, "freshwo");
assert(fwPartial.length === 1 && fwPartial[0].id === "acc_fw", "partial freshwo matches freshworks");

invalidateSearchIndex();
assert(true, "invalidateSearchIndex runs");

// Integration: buildSearchIndex from localStorage history + briefs
const TEST_EMAIL = "search-test@freshworks.com";
const session = {
  email: TEST_EMAIL,
  name: "Search Test SE",
  userId: "usr_search_test",
  uid: "usr_search_test",
  teamId: "team_demo",
};

const lsStore = new Map();
globalThis.localStorage = {
  getItem: (k) => lsStore.get(k) ?? null,
  setItem: (k, v) => lsStore.set(k, v),
  removeItem: (k) => lsStore.delete(k),
};

initDomainStore(null);
invalidateSearchIndex();

localStorage.setItem(
  storageKey(TEST_EMAIL),
  JSON.stringify([
    {
      id: "pc_fw_1",
      timestamp: Date.now(),
      title: "Freshworks · Discovery",
      analysis: { company: "Freshworks", callHeader: { company: "Freshworks" } },
      prospectEmails: ["ceo@freshworks.com"],
    },
  ]),
);
localStorage.setItem(
  "lionpath_briefs",
  JSON.stringify([
    {
      id: "brief_fw_1",
      company: "Freshworks",
      meta: { company: "Freshworks", domain: "freshworks.com" },
      savedAt: Date.now(),
    },
  ]),
);

const built = await buildSearchIndex(session);
assert(built.length >= 2, "buildSearchIndex indexes history + briefs");
const builtFw = searchIndex(built, "freshwo");
assert(builtFw.some((r) => /freshworks/i.test(r.label)), "built index matches freshwo");
assert(getCachedSearchIndex(session)?.length === built.length, "getCachedSearchIndex returns warm index");
const stats = getSearchIndexStats(session);
assert(stats.cached && stats.size >= 2, "getSearchIndexStats reports cached index");

for (const item of built) {
  if (item.type === "account") {
    assert(item.accountId === item.id, "account hit accountId must match id for navigation");
    assert(item.accountId, "account hit must carry accountId");
  }
  if (item.type === "contact" && item.accountId) {
    assert(item.contactId === item.id, "contact hit contactId must match id");
  }
  if (item.type === "deal") {
    assert(item.dealId === item.id, "deal hit dealId must match id");
    assert(item.accountId, "deal hit must carry accountId for drill-down fallback");
  }
}

localStorage.removeItem(storageKey(TEST_EMAIL));
localStorage.removeItem("lionpath_briefs");
lsStore.clear();
invalidateSearchIndex();

console.log("test-search-service: ok");
