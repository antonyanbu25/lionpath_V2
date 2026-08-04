/**
 * Smoke tests for search-service (no browser).
 */
import { searchIndex, filterAccountRows, accountRowTokens, searchContacts, invalidateSearchIndex } from "../search-service.js";

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

invalidateSearchIndex();
assert(true, "invalidateSearchIndex runs");

console.log("test-search-service: ok");
