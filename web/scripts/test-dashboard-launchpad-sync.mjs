/** Dashboard launchpad — lazy history + remote briefs for KPIs and recent activity. */

import { savePostCallAnalysis, listPostCallAnalyses, storageKey } from "../history.js";
import { buildLaunchpadCallMetricsFromRecords } from "../calls-list-view.js";
import { countPrepsGenerated, loadAllLocalBriefs } from "../precall.js";
import { mergeAllBriefs } from "../briefs-list-view.js";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};

const TEST_EMAIL = "se@freshworks.com";
const STORAGE_KEY = storageKey(TEST_EMAIL);
const BRIEFS_KEY = "lionpath_briefs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sampleCall(id, company, ts) {
  return {
    id,
    timestamp: ts,
    title: `${company} · Discovery`,
    analysis: {
      callHeader: { title: `${company} · Discovery` },
      momentum: { status: "Advancing" },
    },
    scorecard: {
      callType: "discovery",
      rubricVersion: "2.1",
      provisional: false,
      overall: 72,
      confidence: 0.9,
      lines: [
        { themeKey: "call_flow", grade: 72, credit: 3, category: "communication_control", applicable: true },
        { themeKey: "customer_engagement", grade: 70, credit: 3, category: "communication_control", applicable: true },
        { themeKey: "objections", grade: 68, credit: 2, category: "credibility_objections", applicable: true },
        { themeKey: "camera_on", grade: 75, credit: 2, category: "communication_control", applicable: true },
      ],
    },
  };
}

store.delete(STORAGE_KEY);
store.delete(BRIEFS_KEY);

// Local storage empty — simulates dashboard render before Worker KV sync.
const remoteHistory = [
  sampleCall("remote-call-1", "Freshdesk", Date.now() - 3600000),
  sampleCall("remote-call-2", "Acme", Date.now() - 7200000),
];

const remoteBriefs = [
  {
    id: "remote-brief-1",
    company: "Globex",
    when: new Date().toLocaleDateString(),
    prep: { facts: [{ key: "Industry", value: "Retail" }] },
    meta: { company: "Globex" },
  },
];

async function mockFetchRemoteHistory() {
  const list = listPostCallAnalyses(TEST_EMAIL);
  const byId = new Map(list.map((r) => [r.id, r]));
  for (const entry of remoteHistory) byId.set(entry.id, entry);
  const merged = [...byId.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  store.set(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

async function mockFetchAllRemotePreps() {
  return remoteBriefs;
}

assert(listPostCallAnalyses(TEST_EMAIL).length === 0, "starts with empty local history");

const synced = await mockFetchRemoteHistory();
const metrics = buildLaunchpadCallMetricsFromRecords(synced);
assert(metrics.totalCalls === 2, "calls analysed KPI uses synced history");
assert(metrics.callsThisWeek === 2, "calls this week uses synced history");

const kpiBriefs = await countPrepsGenerated(mockFetchAllRemotePreps);
assert(kpiBriefs === 1, "briefs KPI includes remote-only briefs");

const mergedBriefs = mergeAllBriefs(loadAllLocalBriefs(), remoteBriefs);
assert(mergedBriefs.length === 1, "recent activity brief merge includes remote briefs");

// Activity should combine calls + briefs when local cache was empty before sync.
const activityCount = synced.length + mergedBriefs.length;
assert(activityCount === 3, "activity feed has calls and briefs after lazy fetch");

console.log("test-dashboard-launchpad-sync: ok");
