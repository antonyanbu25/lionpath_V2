/**
 * Smoke tests — call record view renders from local history without Firestore profile.
 */
import { initDomainStore } from "../domain/store.js";
import { savePostCallAnalysis, getPostCallAnalysis } from "../history.js";
import { renderCallView } from "../call-view.js";
import {
  effectiveSessionUserId,
  withEffectiveUserId,
} from "../domain/session.js";
import { stableUserIdForEmail } from "../domain/id.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const storeData = new Map();
globalThis.localStorage = {
  getItem: (k) => storeData.get(k) ?? null,
  setItem: (k, v) => storeData.set(k, v),
  removeItem: (k) => storeData.delete(k),
  key: (i) => [...storeData.keys()][i] ?? null,
  get length() {
    return storeData.size;
  },
};
globalThis.sessionStorage = {
  getItem: (k) => storeData.get(`ss:${k}`) ?? null,
  setItem: (k, v) => storeData.set(`ss:${k}`, v),
  removeItem: (k) => storeData.delete(`ss:${k}`),
};

initDomainStore(null);

const email = "se@freshworks.com";

/** Firebase SSO shape when Firestore upsert fails — email + authUid only. */
const firebaseSession = {
  role: "se",
  email,
  name: "Test SE",
  authUid: "firebase-auth-uid-abc123",
  teamId: "team_ajay",
};

assert(
  effectiveSessionUserId(firebaseSession) === stableUserIdForEmail(email),
  "effectiveSessionUserId falls back to stable id from email",
);
const enriched = withEffectiveUserId(firebaseSession);
assert(
  enriched.userId === stableUserIdForEmail(email),
  "withEffectiveUserId assigns stable domain id",
);
assert(enriched.uid === enriched.userId, "uid mirrors userId");

const saved = await savePostCallAnalysis(
  email,
  { recordingUrl: "https://zoom.us/rec/sso-test" },
  {
    analysis: {
      callHeader: { title: "Acme · Demo", duration: "48 min", attendees: [{ name: "Pat", role: "Customer" }] },
      callNotes: "- Strong demo overall.\n- Pricing objection surfaced at 35m and was not fully closed.",
      momentum: { status: "Advancing" },
    },
    scorecard: {
      callType: "demo",
      rubricVersion: "1.0",
      provisional: false,
      confidence: 0.85,
      lines: [{ themeKey: "call_flow", score: 78, maxScore: 100, applicable: true, weight: 10 }],
    },
    analysisMeta: { callType: "demo", analysisConfidence: 0.85 },
  },
);
assert(saved?.id, "history save returned record id");
const callId = saved.id;
assert(getPostCallAnalysis(email, callId)?.id === callId, "record readable from local history");

const container = { innerHTML: "" };
Object.defineProperty(container, "querySelector", {
  value: () => null,
  configurable: true,
});
Object.defineProperty(container, "querySelectorAll", {
  value: () => [],
  configurable: true,
});

await renderCallView(container, firebaseSession, { callId });

assert(container.innerHTML.includes("call-record"), "renders call record shell");
assert(container.innerHTML.includes("Acme · Demo"), "shows call title");
assert(container.innerHTML.includes("QIP"), "shows verdict strip");
assert(container.innerHTML.includes("How the 48 minutes went"), "timeline title from duration");
assert(container.innerHTML.includes("QIP scorecard"), "shows QIP tab");
assert(container.innerHTML.includes("Technical commit"), "shows TC tab");
assert(container.innerHTML.includes("qip-grid-header"), "shows QIP column header");
assert(container.innerHTML.includes("Weighted"), "shows weighted column");
assert(container.innerHTML.includes("call-notes-bullets"), "shows call notes bullets");
assert(container.innerHTML.includes("Edit notes"), "shows edit notes action");
assert(container.innerHTML.includes("Re-run"), "shows re-run action");
assert(
  !container.innerHTML.includes("We could not load your profile"),
  "must not show profile gate error",
);

console.log("test-call-view: ok");
