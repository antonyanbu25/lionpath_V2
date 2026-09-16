/**
 * UAT-005 (2026-09-11 staging report): score/deal-field flicker on first
 * open of a deal-linked call record.
 *
 * Root cause: renderCallView() does two content paints for a cold open —
 * an immediate "local bundle" paint built purely from this browser's cached
 * post-call history (buildLocalCallBundle in call-view.js), followed by an
 * "enriched bundle" paint once loadCallBundle() finishes fetching the real
 * deal record from the store. For a deal-linked call, two fields are
 * genuinely at risk of differing between those two paints because the local
 * pass never sees the store's deal doc:
 *
 *   - ARR: the local pass only ever reads this call's own
 *     result.arrCompute; the enriched pass prefers the deal's own
 *     arrSnapshot (deal-service.js persistArrAfterPostCall), which can be a
 *     different, more current number.
 *   - MEDDPICC (Qualification KPI): the local pass rolls up MEDDPICC purely
 *     from records this browser has cached for the deal
 *     (history-deal-enrichment.js enrichDealFromHistoryRecords); the
 *     enriched pass fetches the real deal doc, which can already carry
 *     MEDDPICC signals from calls/sources this browser's local history
 *     never saw.
 *
 * This fixture pins exactly that: a deal whose store-side ARR snapshot and
 * MEDDPICC metadata disagree with what this call's own local record would
 * compute alone. Before the fix, the first content paint committed to the
 * local (wrong) numbers, which then visibly changed on the very next paint.
 * The fix (call-view.js `dealUnconfirmed`) makes that first paint show a
 * loading skeleton for just those two fields instead of a value that is
 * about to change — so there is nothing to flicker from.
 *
 * Calls with no linked deal are untouched by this fix (buildLocalCallBundle
 * and loadCallBundle compute ARR/MEDDPICC identically in that case), so
 * this fixture intentionally exercises the deal-linked path only.
 */
import assert from "node:assert/strict";
import { initDomainStore, getStore } from "../domain/store.js";
import { savePostCallAnalysis } from "../history.js";
import { renderCallView } from "../call-view.js";

const storeData = new Map();
globalThis.localStorage = {
  getItem: (k) => storeData.get(k) ?? null,
  setItem: (k, v) => storeData.set(k, v),
  removeItem: (k) => storeData.delete(k),
  key: (i) => [...storeData.keys()][i] ?? null,
  get length() { return storeData.size; },
};
globalThis.sessionStorage = {
  getItem: (k) => storeData.get(`ss:${k}`) ?? null,
  setItem: (k, v) => storeData.set(`ss:${k}`, v),
  removeItem: (k) => storeData.delete(`ss:${k}`),
};

initDomainStore(null);
const store = getStore();

const email = "se-dealflicker@freshworks.com";
const session = { role: "se", email, name: "Test SE", authUid: "auth-dealflicker", teamId: "team_ajay" };

await store.createAccount({
  id: "acct-dealflicker-1",
  name: "Riverton Robotics",
  domain: "riverton-robotics.example.com",
});

// The store's deal already carries a *different* ARR snapshot and a fuller
// MEDDPICC rollup than this one call's own local data — e.g. written by an
// earlier call/rep this browser's local history never cached.
await store.createDeal({
  id: "deal-dealflicker-1",
  accountId: "acct-dealflicker-1",
  title: "Riverton Robotics - New Business - 2026-09-01",
  stage: "evaluation",
  type: "new_business",
  arrSnapshot: { arrEstimatePoint: 120000 },
  metadata: {
    meddpicc: {
      metrics: { value: "30% support cost cut", status: "confirmed" },
      economicBuyer: { value: "VP Eng", status: "confirmed" },
      decisionCriteria: { value: "Security review", status: "confirmed" },
      decisionProcess: { value: "Committee vote", status: "confirmed" },
      paperProcess: { value: "Procurement", status: "confirmed" },
      // identifyPain, champion, competition intentionally left unset — 5 of 8.
    },
  },
});

// This call's own local record: no qualification data at all (so the local
// rollup over cached history is empty) and its own ARR compute disagrees
// with the deal's stored snapshot above.
const saved = await savePostCallAnalysis(
  email,
  {
    recordingUrl: "https://zoom.us/rec/dealflicker-test",
    dealId: "deal-dealflicker-1",
    accountId: "acct-dealflicker-1",
  },
  {
    analysis: { callHeader: { title: "Riverton Robotics · Demo", duration: "30 min", attendees: [] } },
    confirmed: { dealId: "deal-dealflicker-1", accountId: "acct-dealflicker-1" },
    arrCompute: { arrPoint: 50000 },
  },
);
assert.equal(saved.dealId, "deal-dealflicker-1", "fixture record carries the dealId (exercises the deal-fetch path)");

/** Records every innerHTML assignment so intermediate paints stay inspectable. */
function snapshottingContainer() {
  const snapshots = [];
  let html = "";
  const container = {};
  Object.defineProperty(container, "innerHTML", {
    get() { return html; },
    set(v) { html = v; snapshots.push(v); },
    configurable: true,
  });
  Object.defineProperty(container, "querySelector", { value: () => null, configurable: true });
  Object.defineProperty(container, "querySelectorAll", { value: () => [], configurable: true });
  Object.defineProperty(container, "snapshots", { get() { return snapshots; }, configurable: true });
  return container;
}

const container = snapshottingContainer();
await renderCallView(container, session, { callId: saved.id });

// Content paints are the ones past the loading shell — the loading skeleton
// panel never contains the KPI row.
const contentPaints = container.snapshots.filter((html) => html.includes("call-postcall-summary-row"));
assert.ok(contentPaints.length >= 2, `expected at least 2 content paints (local + enriched), got ${contentPaints.length}`);

const firstPaint = contentPaints[0];
const finalPaint = contentPaints[contentPaints.length - 1];

// --- First (local-bundle) paint: must not commit to either at-risk value ---
assert.ok(
  !firstPaint.includes("$50,000"),
  "first paint must not show this call's own (possibly-stale) local ARR figure",
);
assert.ok(
  !firstPaint.includes("$120,000"),
  "first paint must not show the real ARR figure either — it hasn't loaded yet, sanity check",
);
assert.ok(
  firstPaint.includes('aria-label="ARR loading"'),
  "first paint shows an ARR loading skeleton rather than any committed ARR figure",
);
assert.ok(
  firstPaint.includes("mcard--pending") && firstPaint.includes('aria-label="Qualification loading"'),
  "first paint shows the MEDDPICC KPI as a loading skeleton, not a premature score",
);
assert.ok(
  !firstPaint.includes("5 of 8 surfaced"),
  "first paint must not show the deal's real MEDDPICC fill count yet",
);

// --- Final (enriched-bundle) paint: must show the confirmed, real values ---
assert.ok(
  finalPaint.includes("$120,000"),
  "final paint shows the deal's real ARR snapshot",
);
assert.ok(
  !finalPaint.includes("$50,000"),
  "final paint never leaks this call's stale local ARR figure",
);
assert.ok(
  finalPaint.includes("5 of 8 surfaced"),
  "final paint shows the deal's real MEDDPICC fill count",
);
assert.ok(
  !finalPaint.includes("mcard--pending"),
  "final paint has resolved out of the MEDDPICC loading skeleton",
);

console.log("test-call-view-deal-field-flicker: local-bundle paint no longer commits to values the enriched paint changes — ok");
