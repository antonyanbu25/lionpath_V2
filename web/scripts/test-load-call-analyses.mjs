/**
 * loadCallAnalysesForSession reads postCalls when callSummaries are missing.
 */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};

const { initDomainStore, getStore } = await import("../domain/store.js");
const { loadCallAnalysesForSession } = await import("../domain/se-access-service.js");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

initDomainStore(null);
const store = getStore();

const ownerId = "usr_test_nivedha";

await store.upsertPostCall({
  id: "call_test_1",
  ownerId,
  teamId: "team_nikil",
  orgId: "org_freshworks_se",
  accountId: "acc_test",
  title: "Gamersheek · Demo",
  callType: "demo",
  createdAt: Date.now() - 86400000,
  updatedAt: Date.now() - 86400000,
  analysis: { callHeader: { title: "Gamersheek · Demo", company: "Gamersheek" } },
  qualityScore: 7.2,
});

const session = {
  email: "nivedha.natarajan@freshworks.com",
  userId: ownerId,
  uid: ownerId,
  role: "se",
  teamId: "team_nikil",
};
const rows = await loadCallAnalysesForSession(session, { syncRemoteHistory: false });
assert(rows.some((r) => r.id === "call_test_1"), "postCalls-only call surfaces in loadCallAnalysesForSession");
assert(rows.some((r) => /Gamersheek/i.test(r.title || "")), "call title preserved");

console.log("test-load-call-analyses: ok");
