/**
 * Smoke tests for product signal dashboard (spec §11.10, ADR-006).
 */
import { initDomainStore, getStore } from "../domain/store.js";
import { seedDevDomainIfNeeded, enrichSessionFromStore } from "../domain/seed-dev.js";
import { stableUserIdForEmail } from "../domain/id.js";
import { now } from "../domain/types.js";
import {
  aggregateAiAttachThemes,
  aggregateWhatWorksClusters,
  buildAiResidencyJoinInsight,
  classifyTextToTheme,
  isGapLoopClosed,
  isProductSignalCurator,
  loadProductSignalDashboard,
} from "../domain/product-signal-service.js";
import { renderProductSignalView } from "../product-signal-view.js";

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

assert(isGapLoopClosed("published") === true, "published closes loop");
assert(isGapLoopClosed("draft") === false, "draft does not close loop");

assert(isProductSignalCurator({ role: "pm" }) === true, "pm is curator");
assert(isProductSignalCurator({ role: "se" }) === false, "se is not curator");

const pmSession = await enrichSessionFromStore({
  email: "product.pm@freshworks.com",
  role: "pm",
  userId: stableUserIdForEmail("product.pm@freshworks.com"),
});
assert(pmSession.role === "pm", "PM session role");

const dashboard = await loadProductSignalDashboard(store, pmSession.orgId);
assert(dashboard.clusterRows.length >= 4, "seeded gap clusters present");
assert(dashboard.workingRows.length >= 3, "seeded what-works rows present");
assert(dashboard.summary.distinctClusters >= 4, "distinct cluster count");
assert(dashboard.summary.loopClosed >= 1, "loop closed count");

const residencyInsight = buildAiResidencyJoinInsight(
  dashboard.topCluster,
  dashboard.aiThemes.decline,
  dashboard.residencyGaps,
  (n) => `$${Math.round(n / 1000)}K`,
);
assert(residencyInsight?.includes("Residency"), "residency join insight");

const theme = classifyTextToTheme(
  [{ key: "x", label: "Test", patterns: [/residen/i] }],
  "data residency blocker",
);
assert(theme?.key === "x", "classifyTextToTheme");

const ts = now();
const aiThemes = aggregateAiAttachThemes(
  [
    {
      accountId: "a1",
      reasonForEvaluation: { value: "Deflection volume" },
      aiAttach: { agentCount: 10, summary: "10/10" },
    },
    {
      accountId: "a2",
      whyAi: { value: "Data residency compliance" },
      aiAttach: { product: "Copilot", agentCount: 0, summary: "declined" },
    },
  ],
  [],
);
assert(aiThemes.optInDeals === 1, "opt-in deal count");
assert(aiThemes.declineDeals === 1, "decline deal count");

const works = aggregateWhatWorksClusters([
  { productArea: "channels", verbatim: "Unified inbox wins", accountId: "acc1", referenceCandidate: true },
  { productArea: "channels", verbatim: "Unified inbox wins", accountId: "acc2", referenceCandidate: false },
]);
assert(works.length === 1 && works[0].dealCount === 2, "what works cluster by theme");

function mockPanel() {
  const panel = {
    _html: "",
    set innerHTML(v) {
      this._html = v;
    },
    get innerHTML() {
      return this._html;
    },
    querySelector(sel) {
      if (typeof document === "undefined") return null;
      const tmp = document.createElement("div");
      tmp.innerHTML = this._html;
      return tmp.querySelector(sel);
    },
    querySelectorAll(sel) {
      if (typeof document === "undefined") return [];
      const tmp = document.createElement("div");
      tmp.innerHTML = this._html;
      return tmp.querySelectorAll(sel);
    },
  };
  return panel;
}

const panel = mockPanel();
await renderProductSignalView(pmSession, panel, {});
assert(panel.innerHTML.includes("Product signal"), "renders title");
assert(panel.innerHTML.includes("What's not working"), "renders not working half");
assert(panel.innerHTML.includes("What's working"), "renders working half");
assert(panel.innerHTML.includes("Why customers opt into AI"), "renders AI opt-in");
assert(panel.innerHTML.includes("Why they don't"), "renders AI decline");
assert(panel.innerHTML.includes("Data residency for ASEAN tenants"), "renders residency cluster");
assert(panel.innerHTML.includes("Loop closed"), "renders loop metric");

const sePanel = mockPanel();
await renderProductSignalView(
  await enrichSessionFromStore({
    email: "saketh.poruri@freshworks.com",
    role: "se",
    userId: stableUserIdForEmail("saketh.poruri@freshworks.com"),
  }),
  sePanel,
  {},
);
assert(sePanel.innerHTML.includes("PM and admin"), "SE blocked from product signal");

console.log("test-product-signal-view.mjs: all assertions passed");
