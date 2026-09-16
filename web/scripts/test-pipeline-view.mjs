/**
 * Smoke tests for pipeline review (spec §11.9).
 */
import { initDomainStore, getStore } from "../domain/store.js";
import { seedDevDomainIfNeeded, enrichSessionFromStore } from "../domain/seed-dev.js";
import { stableUserIdForEmail } from "../domain/id.js";
import { now } from "../domain/types.js";
import {
  buildPipelineView,
  fiscalQuarterLabelFromMonth,
  filterPipelineRows,
  renderPipelineView,
  summarizePipelineRows,
} from "../pipeline-view.js";
import {
  enrichDealListRows,
  isOpenPipelineDeal,
  resolveDealAgentCount,
  sortPipelineDealRows,
} from "../deal-view.js";
import { listDealsForSession } from "../domain/account-service.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => ls.get(k) ?? null,
  setItem: (k, v) => ls.set(k, v),
  removeItem: (k) => ls.delete(k),
};

initDomainStore(null);
await seedDevDomainIfNeeded();
const store = getStore();

assert(fiscalQuarterLabelFromMonth("2025-08") === "Q3 FY26", "Aug 2025 → Q3 FY26");
assert(fiscalQuarterLabelFromMonth("2025-01") === "Q4 FY25", "Jan 2025 → Q4 FY25");

const vipinId = stableUserIdForEmail("vipin.thomas@freshworks.com");
const leaderSession = await enrichSessionFromStore({
  email: "vipin.thomas@freshworks.com",
  role: "manager",
  userId: vipinId,
});
assert(leaderSession.isOrgDirector === true, "vipin is org director");

const seSession = await enrichSessionFromStore({
  email: "saketh.poruri@freshworks.com",
  role: "se",
  userId: stableUserIdForEmail("saketh.poruri@freshworks.com"),
});

const ts = now();
const pipelineAccountId = "account_pipeline_test";
const bigDealId = "deal_pipeline_big";
const smallDealId = "deal_pipeline_small";

await store.createAccount({
  id: pipelineAccountId,
  name: "Pipeline Test Co",
  domain: "pipelinetest.com",
  slug: "pipeline-test-co",
  orgId: leaderSession.orgId,
  metadata: { sub_region: "MEA", region: "APMEA" },
  seTeam: [{ seUserId: vipinId, role: "primary", addedAt: ts }],
  primarySeUserId: vipinId,
  createdAt: ts,
  updatedAt: ts,
});

await store.createLifecycle({
  id: "lc_pipeline_test",
  accountId: pipelineAccountId,
  dealId: bigDealId,
  ownerId: vipinId,
  teamId: leaderSession.teamId,
  orgId: leaderSession.orgId,
  primaryContactId: null,
  title: "Pipeline Test Co",
  stage: "evaluation",
  status: "active",
  prepCount: 0,
  postCallCount: 1,
  openTaskCount: 0,
  lastActivityAt: ts,
  createdAt: ts,
  updatedAt: ts,
});

for (const spec of [
  {
    id: bigDealId,
    title: "Big FD Omni",
    agents: 140,
    arr: 70000,
    forecastMonth: "2025-08",
    traction: "hot",
    tc: "yes",
    risk: null,
    aiAttach: { product: "Copilot", agentCount: 140, agentTotal: 140, summary: "Copilot 140/140" },
  },
  {
    id: smallDealId,
    title: "Small trial",
    agents: 12,
    arr: 12000,
    forecastMonth: "2025-05",
    traction: "cold",
    tc: "pending",
    risk: "Data residency",
    aiAttach: null,
  },
]) {
  await store.createDeal({
    id: spec.id,
    accountId: pipelineAccountId,
    type: "new_business",
    stage: "evaluation",
    status: "active",
    ownerId: vipinId,
    teamId: leaderSession.teamId,
    orgId: leaderSession.orgId,
    title: spec.title,
    forecastMonth: spec.forecastMonth,
    arrEstimatePoint: spec.arr,
    arrEstimateLow: spec.arr,
    arrEstimateHigh: spec.arr,
    arrInputsJson: { agents: spec.agents },
    openTaskCount: spec.id === smallDealId ? 3 : 1,
    prepCount: 0,
    postCallCount: 1,
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });
  await store.upsertTechnicalCommit?.({
    id: `tc_${spec.id}`,
    dealId: spec.id,
    accountId: pipelineAccountId,
    status: spec.tc,
    identifiedRisk: spec.risk ? { value: spec.risk } : null,
    aiAttach: spec.aiAttach,
    ownerId: vipinId,
    teamId: leaderSession.teamId,
    orgId: leaderSession.orgId,
    createdAt: ts,
    updatedAt: ts,
  });
  await store.upsertDealSignal?.({
    id: `sig_${spec.id}`,
    dealId: spec.id,
    accountId: pipelineAccountId,
    traction: spec.traction,
    daysSilent: spec.traction === "cold" ? 45 : 3,
    ownerId: vipinId,
    teamId: leaderSession.teamId,
    orgId: leaderSession.orgId,
    createdAt: ts,
    updatedAt: ts,
  });
}

const baseRows = await listDealsForSession(leaderSession);
const enriched = await enrichDealListRows(store, baseRows);
const testRows = enriched.filter((r) => r.deal?.id === bigDealId || r.deal?.id === smallDealId);
assert(testRows.length === 2, "pipeline test deals visible to org director");

const big = testRows.find((r) => r.deal.id === bigDealId);
const small = testRows.find((r) => r.deal.id === smallDealId);
assert(big.agentCount === 140, "agent count from arrInputsJson");
assert(big.blocker == null, "no blocker when risk absent");
assert(small.blocker === "Data residency", "blocker from TC identified risk");
assert(small.pendingActions === 3, "pending from openTaskCount");
assert(resolveDealAgentCount(big.deal, []) === 140, "resolveDealAgentCount");

const defaultSort = sortPipelineDealRows(testRows, "agents");
assert(defaultSort[0].deal.id === bigDealId, "default sort: agent count desc");

const arrSort = sortPipelineDealRows(testRows, "arr");
assert(arrSort[0].deal.id === bigDealId, "ARR sort matches point ordering");

const mrrSort = sortPipelineDealRows(testRows, "mrr");
assert(mrrSort[0].deal.id === bigDealId, "MRR sort matches ARR ordering");

const q3Only = filterPipelineRows(enriched, { quarter: "Q3 FY26" });
assert(q3Only.some((r) => r.deal.id === bigDealId), "quarter filter includes Q3 deal");
assert(!q3Only.some((r) => r.deal.id === smallDealId), "quarter filter excludes Q2 deal");

const meaOnly = filterPipelineRows(enriched, { subRegion: "MEA" });
assert(meaOnly.some((r) => r.deal.id === bigDealId), "sub-region filter");

const view = await buildPipelineView(leaderSession, { sortKey: "agents" });
assert(view.rows.some((r) => r.deal.id === bigDealId), "buildPipelineView returns rows");
assert(view.summary.dealCount >= 2, "summary counts open deals");

const container = { innerHTML: "" };
await renderPipelineView(container, seSession);
assert(container.innerHTML.includes("org leadership only"), "SE blocked from pipeline");

const leaderContainer = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
Object.assign(leaderContainer, {
  innerHTML: "",
  querySelector(sel) {
    const tmp = document.createElement("div");
    tmp.innerHTML = this.innerHTML;
    return tmp.querySelector(sel);
  },
  querySelectorAll(sel) {
    const tmp = document.createElement("div");
    tmp.innerHTML = this.innerHTML;
    return tmp.querySelectorAll(sel);
  },
});

// jsdom-less: patch mount hooks by using real DOM if available
if (typeof document !== "undefined") {
  const mountEl = document.createElement("div");
  await renderPipelineView(mountEl, leaderSession, { sortKey: "agents" });
  const html = mountEl.innerHTML;
  assert(html.includes("Pipeline deal review"), "renders title");
  assert(html.includes("pipeline-col--ai"), "AI attach column");
  assert(html.includes("Copilot 140/140"), "AI attach shows summary not boolean");
  assert(html.includes("Big FD Omni"), "deal row");
  assert(html.includes("pipeline-money--low-confidence") || html.includes("deal-arr-confidence"), "confidence badge");
  assert(html.includes("rotting ones first"), "sort footnote");
  assert(html.includes('data-pipeline-sort="arr"'), "ARR sort header");
  assert(html.includes('data-pipeline-sort="mrr"'), "MRR sort header");
  assert(!html.includes("deal-list-col--traction"), "uses pipeline grid not deal list");
}

console.log("test-pipeline-view.mjs: all passed");
