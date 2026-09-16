/**
 * Regression (astra-audit P14 item 3, F-029-035): the "Technical commit" and
 * "Minutes" tabs used to render a hard "not captured, re-run post-call
 * analysis" message whenever the field was empty — even right after a read
 * for it had just failed. Unknown must never render as empty: a failed
 * section shows a retry affordance, and only a proven-absent one shows the
 * "re-run analysis" copy.
 *
 * The equivalent "still pending" skeleton branch (mirroring the pre-existing
 * "signal"/gaps tab) is exercised by the same pending/errors plumbing but
 * only visible during the two transient paints before loadCallBundle
 * completes — loadCallBundle unconditionally marks commit/summarise/gaps
 * "completed" once it finishes (call-view.js's hydrationCompleted list), so
 * by the time an awaited renderCallView call returns, that window has
 * already closed and there is nothing left to assert on the final DOM.
 */
import { initDomainStore } from "../domain/store.js";
import { savePostCallAnalysis } from "../history.js";
import { renderCallView } from "../call-view.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

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

const email = "se-tabpending@freshworks.com";
const session = { role: "se", email, name: "Test SE", authUid: "auth-tabpending", teamId: "team_ajay" };

function fakeContainer() {
  const container = { innerHTML: "" };
  Object.defineProperty(container, "querySelector", { value: () => null, configurable: true });
  Object.defineProperty(container, "querySelectorAll", { value: () => [], configurable: true });
  return container;
}

const minimalAnalysis = {
  callHeader: { title: "Acme · Discovery", duration: "20 min", attendees: [] },
};

// 1) A read just failed: errors.commit / errors.summarise set, nothing pending.
const failedSaved = await savePostCallAnalysis(
  email,
  { recordingUrl: "https://zoom.us/rec/failed-test" },
  {
    analysis: minimalAnalysis,
    hydration: {
      pending: [],
      errors: { commit: "Couldn't load technical commit data.", summarise: "Couldn't load minutes data." },
    },
  },
);
const failedContainer = fakeContainer();
await renderCallView(failedContainer, session, { callId: failedSaved.id });
assert(
  !failedContainer.innerHTML.includes("Re-run post-call analysis to extract it"),
  "failed commit read must not show the hard 're-run analysis' message",
);
assert(
  failedContainer.innerHTML.includes('data-retry-section="commit"'),
  "failed commit read shows a retry affordance",
);
assert(
  failedContainer.innerHTML.includes('data-retry-section="summarise"'),
  "failed summarise read shows a retry affordance",
);
console.log("test-call-view-tab-pending: failed read shows retry, not a false 're-run' claim — ok");

// 2) Genuinely finished with nothing there: the "re-run analysis" copy is
// correct and must still show — this fix must not blank it out for real.
const emptySaved = await savePostCallAnalysis(
  email,
  { recordingUrl: "https://zoom.us/rec/empty-test" },
  { analysis: minimalAnalysis, hydration: { pending: [], errors: {} } },
);
const emptyContainer = fakeContainer();
await renderCallView(emptyContainer, session, { callId: emptySaved.id });
assert(
  emptyContainer.innerHTML.includes("Re-run post-call analysis to extract it"),
  "proven-empty commit still correctly instructs re-running analysis",
);
assert(
  emptyContainer.innerHTML.includes("Re-run analysis to generate one"),
  "proven-empty minutes still correctly instructs re-running analysis",
);
console.log("test-call-view-tab-pending: proven-empty state unaffected — ok");
