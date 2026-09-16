/**
 * Regression (astra-audit P14 items 1-2, F-029-035): a cold open of a saved
 * call record used to do up to 6 full #call-panel.innerHTML replacements —
 * two loading-skeleton paints, a local-bundle paint, a technical-commit
 * quick-patch repaint, and a final enriched-bundle repaint — each one a full
 * destroy-and-rebuild that lost scroll position and replayed the KPI
 * count-up animations. This proves the content phase (after the loading
 * skeleton settles) now repaints at most twice: once from the fast local
 * bundle, once with the fully enriched bundle — the technical-commit fetch
 * no longer triggers its own extra repaint in between.
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

const email = "se-paintcount@freshworks.com";
const session = { role: "se", email, name: "Test SE", authUid: "auth-paintcount", teamId: "team_ajay" };

await store.createAccount({ id: "acct-paintcount-1", name: "Acme Paintcount", domain: "acme-paintcount.example.com" });
await store.createDeal({
  id: "deal-paintcount-1",
  accountId: "acct-paintcount-1",
  title: "Acme Paintcount · Demo",
  stage: "research",
  type: "new_business",
});

const saved = await savePostCallAnalysis(
  email,
  { recordingUrl: "https://zoom.us/rec/paintcount-test", dealId: "deal-paintcount-1", accountId: "acct-paintcount-1" },
  {
    analysis: { callHeader: { title: "Acme · Demo", duration: "20 min", attendees: [] } },
    confirmed: { dealId: "deal-paintcount-1", accountId: "acct-paintcount-1" },
  },
);
assert.equal(saved.dealId, "deal-paintcount-1", "fixture record carries the dealId (exercises the TC-fetch path)");

/** Counts every assignment to container.innerHTML, the proxy for a full repaint. */
function countingContainer() {
  let html = "";
  let setCount = 0;
  const container = {};
  Object.defineProperty(container, "innerHTML", {
    get() { return html; },
    set(v) { html = v; setCount += 1; },
    configurable: true,
  });
  Object.defineProperty(container, "querySelector", { value: () => null, configurable: true });
  Object.defineProperty(container, "querySelectorAll", { value: () => [], configurable: true });
  Object.defineProperty(container, "paintCount", { get() { return setCount; }, configurable: true });
  return container;
}

const container = countingContainer();
await renderCallView(container, session, { callId: saved.id });

// 2 loading-skeleton paints (preview-record shell, then resolved-record shell)
// + at most 2 content paints (local bundle, then the enriched bundle) = 4.
// Before this fix the technical-commit quick-patch added a 5th full repaint
// for a call with a linked deal specifically — the case this fixture exercises.
assert.ok(
  container.paintCount <= 4,
  `expected at most 4 total repaints (2 skeleton + 2 content) for a dealId-linked call, got ${container.paintCount}`,
);

console.log(`test-call-view-paint-count: ${container.paintCount} total repaints for a dealId-linked cold open — ok`);
