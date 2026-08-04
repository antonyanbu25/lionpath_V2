/**
 * Smoke tests for All briefs list — #precall/briefs.
 */
import {
  mergeAllBriefs,
  filterBriefRecords,
  buildBriefListRow,
  normalizeRemoteBrief,
} from "../briefs-list-view.js";
import { countPrepsGenerated } from "../precall.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const BRIEFS_KEY = "lionpath_briefs";
const storeData = new Map();
globalThis.localStorage = {
  getItem: (k) => storeData.get(k) ?? null,
  setItem: (k, v) => storeData.set(k, v),
  removeItem: (k) => storeData.delete(k),
};

const localBriefs = [
  {
    id: "acme-1000",
    company: "Acme Corp",
    kind: "Discovery",
    when: "1/15/2026",
    prep: { version: 8, headline: "Acme prep" },
    meta: { company: "Acme Corp", domain: "acme.com" },
  },
  {
    id: "beta-2000",
    company: "Beta Inc",
    kind: "Discovery",
    when: "1/10/2026",
    prep: { version: 8, headline: "Beta prep" },
    meta: { company: "Beta Inc", domain: "beta.io" },
  },
];

localStorage.setItem(BRIEFS_KEY, JSON.stringify(localBriefs));

const remoteRaw = [
  {
    id: "fs-doc-1",
    company: "Gamma LLC",
    when: "1/20/2026",
    prep: { version: 8, headline: "Gamma prep" },
    prospectEmail: "ceo@gamma.com",
  },
  {
    id: "acme-1000",
    company: "Acme Corp",
    when: "1/15/2026",
    prep: { version: 8, headline: "Duplicate remote" },
  },
];

const merged = mergeAllBriefs(localBriefs, remoteRaw.map(normalizeRemoteBrief));
assert(merged.length === 3, "dedupes remote brief with same company|when|id key");
assert(merged[0].company === "Gamma LLC", "newest brief first");

const filtered = filterBriefRecords(merged, { query: "acme" });
assert(filtered.length === 1, "search filters by company");
assert(filterBriefRecords(merged, { query: "gamma.com" }).length === 1, "search filters by domain");

const row = buildBriefListRow(merged[0]);
assert(row.companyMono.length >= 2, "mono initials");
assert(row.kind === "Discovery", "kind label");

async function mockFetchRemote() {
  return remoteRaw.map(normalizeRemoteBrief);
}

const kpiCount = await countPrepsGenerated(mockFetchRemote);
assert(kpiCount === merged.length, "KPI count matches merged list length");

console.log("test-briefs-list-view: ok");
