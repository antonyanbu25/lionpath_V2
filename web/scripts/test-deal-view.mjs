/**
 * Smoke tests for Deals nav list + deal record (spec §11.6).
 */
import { listDealsForSession } from "../domain/account-service.js";
import { initDomainStore, getStore } from "../domain/store.js";
import {
  renderDealView,
  formatCallMovement,
  formatMeddpiccDeltaPhrase,
  formatTcDeltaPhrase,
  sortDealListRows,
  tractionSortRank,
  formatDealListMoneyBand,
} from "../deal-view.js";
import { filterDealRows } from "../search-service.js";
import { now } from "../domain/types.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const storeData = new Map();
globalThis.localStorage = {
  getItem: (k) => storeData.get(k) ?? null,
  setItem: (k, v) => storeData.set(k, v),
  removeItem: (k) => storeData.delete(k),
};

initDomainStore(null);
const store = getStore();

const session = { uid: "user_deal_nav", teamId: "team_test", email: "deals@freshworks.com" };
const accountId = "account_deal_nav";
const ts = now();

await store.createAccount({
  id: accountId,
  name: "Globex",
  domain: "globex.com",
  slug: "globex-globex-com",
  seTeam: [{ seUserId: session.uid, role: "primary", addedAt: ts }],
  primarySeUserId: session.uid,
  createdAt: ts,
  updatedAt: ts,
});

await store.upsertUser({
  id: session.uid,
  email: session.email,
  authUid: null,
  displayName: "Deal Nav SE",
  role: "se",
  teamId: session.teamId,
  orgId: null,
  managerId: null,
  jobTitle: "Solution Engineer",
  status: "active",
  createdAt: ts,
  updatedAt: ts,
});

await store.createLifecycle({
  id: "lc_deal_nav",
  accountId,
  ownerId: session.uid,
  teamId: session.teamId,
  primaryContactId: null,
  title: "Globex",
  stage: "discovery",
  status: "active",
  prepCount: 0,
  postCallCount: 0,
  openTaskCount: 0,
  lastActivityAt: ts,
  createdAt: ts,
  updatedAt: ts,
});

await store.createDeal({
  id: "deal_globex_nb",
  accountId,
  type: "new_business",
  stage: "discovery",
  status: "active",
  ownerId: session.uid,
  teamId: session.teamId,
  orgId: null,
  title: "Globex NB",
  prepCount: 0,
  postCallCount: 1,
  openTaskCount: 0,
  latestQualityScore: null,
  arrEstimateLow: 12000,
  arrEstimateHigh: 18000,
  arrEstimatePoint: 15000,
  metadata: {
    meddpicc: {
      economicBuyer: { value: "Jordan Smith", status: "confirmed" },
      completionScore: 25,
      lastUpdatedAt: ts,
    },
  },
  createdAt: ts,
  updatedAt: ts,
  lastActivityAt: ts,
});

await store.createDeal({
  id: "deal_globex_hot",
  accountId,
  type: "new_business",
  stage: "negotiation",
  status: "active",
  ownerId: session.uid,
  teamId: session.teamId,
  orgId: null,
  title: "Globex expansion",
  prepCount: 0,
  postCallCount: 3,
  openTaskCount: 0,
  arrEstimatePoint: 96000,
  arrEstimateLow: 82000,
  arrEstimateHigh: 96000,
  metadata: {
    meddpicc: {
      economicBuyer: { value: "Jordan Smith", status: "confirmed" },
      champion: { value: "Alex", status: "confirmed" },
      completionScore: 82,
      lastUpdatedAt: ts,
    },
  },
  createdAt: ts - 86400000,
  updatedAt: ts,
  lastActivityAt: ts,
});

await store.updateLifecycle("lc_deal_nav", { dealId: "deal_globex_nb" });

await store.upsertDealSummary({
  id: "dsum_globex",
  dealId: "deal_globex_nb",
  summary: "Consolidating support onto FD Omni with Copilot for all agents.",
  generatedAt: ts,
  sourceCallIds: ["call_globex_1"],
  createdAt: ts,
  updatedAt: ts,
});

await store.upsertTechnicalCommit({
  id: "tc_globex",
  dealId: "deal_globex_nb",
  accountId,
  status: "yes",
  justification: "Straightforward helpdesk consolidation — no technical block identified.",
  incumbent: { value: "Email, WhatsApp" },
  ownerId: session.uid,
  teamId: session.teamId,
  orgId: "",
  updatedAt: ts,
  createdAt: ts,
});

await store.upsertDealSignal({
  id: "dsig_globex_hot",
  callId: "call_globex_2",
  dealId: "deal_globex_hot",
  traction: "hot",
  reasonsJson: ["Customer committed to next milestone on calendar"],
  recommendedAction: "Maintain cadence",
  daysSilent: 2,
  daysInStage: 12,
  stageMedianDays: 34,
  ownerId: session.uid,
  teamId: session.teamId,
  orgId: "",
  accountId,
  createdAt: ts,
  updatedAt: ts,
});

await store.upsertTechnicalCommit({
  id: "tc_globex_hot",
  dealId: "deal_globex_hot",
  accountId,
  status: "yes",
  justification: "Expansion on existing footprint.",
  aiAttach: { product: "Copilot", agentCount: 14, agentTotal: 14, summary: "Copilot 14/14" },
  ownerId: session.uid,
  teamId: session.teamId,
  orgId: "",
  updatedAt: ts,
  createdAt: ts,
});

await store.upsertArrLine({
  id: "arrline_globex_lowconf",
  dealId: "deal_globex_nb",
  callId: "call_globex_1",
  accountId,
  kind: "base",
  product: "freshdesk_omni",
  tier: "growth",
  annualValue: 15000,
  confidence: 0.42,
  recurring: true,
  excluded: false,
  computedAt: ts,
  ownerId: session.uid,
  teamId: session.teamId,
  orgId: "",
  createdAt: ts,
  updatedAt: ts,
});

await store.upsertDealSignal({
  id: "dsig_globex",
  callId: "call_globex_1",
  dealId: "deal_globex_nb",
  traction: "cold",
  reasonsJson: [
    "Customer said they'd get back on 12 May. They didn't.",
    "No decision maker has joined a call.",
  ],
  recommendedAction: "Go around ops — request a call with whoever owns the support budget.",
  daysSilent: 60,
  daysInStage: 86,
  stageMedianDays: 34,
  ownerId: session.uid,
  teamId: session.teamId,
  orgId: "",
  accountId,
  createdAt: ts,
  updatedAt: ts,
});

await store.upsertPostCall({
  id: "call_globex_1",
  lifecycleId: "lc_deal_nav",
  dealId: "deal_globex_nb",
  accountId,
  ownerId: session.uid,
  teamId: session.teamId,
  orgId: "",
  title: "FD Omni with Copilot",
  callIdentityKey: "call_globex_1",
  analysis: { callHeader: { title: "FD Omni with Copilot", duration: "48 min" } },
  createdAt: ts,
  updatedAt: ts,
});

await store.upsertMeddpiccDelta({
  id: "mdd_eb",
  callId: "call_globex_1",
  dealId: "deal_globex_nb",
  slot: "economicBuyer",
  previous: { value: "Unknown", status: "partial" },
  current: { value: "Jordan Smith", status: "confirmed" },
  changeType: "confirmed",
  evidence: "Jordan introduced as budget owner",
  ownerId: session.uid,
  teamId: session.teamId,
  orgId: "",
  accountId,
  createdAt: ts,
  updatedAt: ts,
});

await store.upsertTcDelta({
  id: "tcd_risk",
  callId: "call_globex_1",
  dealId: "deal_globex_nb",
  field: "identifiedRisk",
  previous: null,
  current: { value: "data residency risk" },
  changeType: "new",
  evidence: "Customer asked where data is stored",
  ownerId: session.uid,
  teamId: session.teamId,
  orgId: "",
  accountId,
  createdAt: ts,
  updatedAt: ts,
});

const movement = formatCallMovement(
  [{ slot: "economicBuyer", changeType: "confirmed", current: { value: "Jordan Smith" } }],
  [{ field: "identifiedRisk", changeType: "new", current: { value: "data residency risk" } }],
);
assert(movement.includes("Confirmed economic buyer"), "movement includes MEDDPICC phrase");
assert(movement.includes("Raised data residency risk"), "movement includes TC phrase");

assert(
  formatMeddpiccDeltaPhrase({
    slot: "economicBuyer",
    changeType: "confirmed",
    current: { value: "Jordan Smith" },
  }).startsWith("Confirmed economic buyer"),
  "meddpicc delta phrase",
);

assert(
  formatTcDeltaPhrase({
    field: "identifiedRisk",
    changeType: "new",
    current: { value: "data residency risk" },
  }) === "Raised data residency risk",
  "tc delta phrase",
);

const rows = await listDealsForSession(session);
assert(rows.length >= 1, "listDealsForSession returns deals");
assert(rows.some((r) => r.deal.id === "deal_globex_nb"), "list includes globex deal");

const filtered = filterDealRows(rows, "globex");
assert(filtered.length >= 1, "filterDealRows matches account name");

assert(tractionSortRank("hot") < tractionSortRank("cold"), "traction rank hot before cold");
assert(
  formatDealListMoneyBand(12000, 18000, 15000) === "$12K–$18K",
  "ARR band formatting",
);

const tractionSorted = sortDealListRows(
  [
    { deal: { id: "a" }, traction: "cold", daysSilent: 60, arrPoint: 15000 },
    { deal: { id: "b" }, traction: "hot", daysSilent: 2, arrPoint: 96000 },
  ],
  "traction",
);
assert(tractionSorted[0].deal.id === "b", "sort by traction puts hot first");

const arrSorted = sortDealListRows(
  [
    { deal: { id: "a" }, traction: "hot", arrPoint: 15000 },
    { deal: { id: "b" }, traction: "cold", arrPoint: 96000 },
  ],
  "arr",
);
assert(arrSorted[0].deal.id === "b", "sort by ARR descending");

const mrrSorted = sortDealListRows(
  [
    { deal: { id: "a" }, traction: "hot", arrPoint: 15000 },
    { deal: { id: "b" }, traction: "cold", arrPoint: 96000 },
  ],
  "mrr",
);
assert(
  arrSorted.map((r) => r.deal.id).join(",") === mrrSorted.map((r) => r.deal.id).join(","),
  "MRR sort matches ARR sort order",
);

function mockContainer() {
  return { innerHTML: "", querySelector() { return null; }, querySelectorAll() { return []; } };
}

const listContainer = mockContainer();
await renderDealView(listContainer, session);
assert(listContainer.innerHTML.includes("deal-list-item"), "deal list renders row");
assert(listContainer.innerHTML.includes("deal-list-view--compact"), "deal list uses compact layout");
assert(listContainer.innerHTML.includes("Globex"), "deal list shows account name");
assert(listContainer.innerHTML.includes("Sorted by traction"), "deal list subtitle mentions traction sort");
assert(listContainer.innerHTML.includes("deal-list-col--meddpicc"), "deal list has MEDPICC column");
assert(listContainer.innerHTML.includes("deal-list-col--traction"), "deal list has traction column");
assert(listContainer.innerHTML.includes("data-deal-sort=\"arr\""), "ARR column is sortable");
assert(listContainer.innerHTML.includes("data-deal-sort=\"mrr\""), "MRR column is sortable");
assert(listContainer.innerHTML.includes("deal-list-money--low-confidence"), "low-confidence ARR marked");
assert(listContainer.innerHTML.includes("60d"), "days silent shown");
assert(listContainer.innerHTML.includes("Cold"), "traction tag shown");
assert(!listContainer.innerHTML.includes("deal-list-col--se"), "no primary SE column");
assert(!listContainer.innerHTML.includes("deal-list-col--qip"), "no QIP column on deal list");
assert(listContainer.innerHTML.includes("QIP grades you"), "footnote explains QIP vs MEDPICC");
assert(
  listContainer.innerHTML.indexOf("Globex expansion") < listContainer.innerHTML.indexOf("Globex NB"),
  "hot deal listed before cold deal when sorted by traction",
);

const detailContainer = mockContainer();
await renderDealView(detailContainer, session, { dealId: "deal_globex_nb", surface: "deals" });
assert(detailContainer.innerHTML.includes("deal-record"), "deal drill uses deal record shell");
assert(detailContainer.innerHTML.includes("← All deals"), "deals surface uses All deals back");
assert(detailContainer.innerHTML.includes("Deal summary"), "section 1 deal summary");
assert(detailContainer.innerHTML.includes("MEDDPICC"), "section 2 MEDDPICC");
assert(detailContainer.innerHTML.includes("Deal velocity"), "section 3 velocity");
assert(detailContainer.innerHTML.includes("Traction"), "section 4 traction");
assert(detailContainer.innerHTML.includes("Recommended action"), "traction recommended action");
assert(detailContainer.innerHTML.includes("Fitment"), "section 5 fitment");
assert(detailContainer.innerHTML.includes("Technical commit"), "section 6 TC");
assert(detailContainer.innerHTML.includes("Calls on this deal"), "section 7 calls");
assert(detailContainer.innerHTML.includes("What it moved"), "calls table movement column");
assert(detailContainer.innerHTML.includes("Confirmed economic buyer"), "call row shows MEDDPICC movement");
assert(detailContainer.innerHTML.includes("Raised data residency risk"), "call row shows TC movement");
assert(detailContainer.innerHTML.includes("deal-arr-module-mount"), "ARR module mount point");
assert(detailContainer.innerHTML.includes("Reporting fields"), "section 8 reporting fields");
assert(!detailContainer.innerHTML.includes("latestQualityScore"), "no QIP on deal screen");
assert(!detailContainer.innerHTML.includes("QIP"), "no QIP label on deal screen");
assert(!detailContainer.innerHTML.includes("account-command-deck"), "deal record replaces opportunity shell");

console.log("test-deal-view: ok");
