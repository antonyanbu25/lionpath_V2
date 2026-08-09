import assert from "node:assert/strict";
import { firebaseConfig } from "../firebase-config.js";
import { initDomainStore } from "../domain/store.js";

firebaseConfig.projectId = "test-project";
globalThis.location = { hostname: "portal.test", search: "" };
// resolveReadMode() (domain/store.js) now branches on session role — added
// as part of today's SE-Firestore-permission-denied-loop fix, so it isn't a
// scenario this test anticipated when written. A session-less mock (as this
// was) resolves straight to api mode for every read, never exercising the
// firestore-primary + api-fallback path this file exists to test. Managers
// still default to firestore-primary (rules allow their broader reads), so
// mocking a manager session is what actually reaches the fallback wrapper —
// confirmed by tracing resolveReadMode()/createReadFallbackStore() directly.
const SESSION_JSON = JSON.stringify({
  email: "manager@freshworks.com",
  role: "manager",
  name: "Test Manager",
});
globalThis.sessionStorage = {
  getItem: (key) => (key === "se-sp-session" ? SESSION_JSON : null),
  setItem: () => {},
};
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const fetches = [];
globalThis.fetch = async (url) => {
  fetches.push(String(url));
  return {
    ok: true,
    async json() {
      return {
        deal: { id: "deal_1", title: "Fallback deal" },
        technicalCommit: { id: "tc_1", dealId: "deal_1", status: "yes" },
        postCall: { id: "call_1", title: "Fallback call" },
      };
    },
  };
};

const permissionDenied = Object.assign(new Error("Missing or insufficient permissions"), {
  code: "permission-denied",
});

const fb = {
  auth: { currentUser: { getIdToken: async () => "token" } },
  db: {},
  collection: (_db, col) => ({ col }),
  doc: (_db, col, id) => ({ col, id }),
  getDoc: async () => {
    throw permissionDenied;
  },
  getDocs: async () => {
    throw permissionDenied;
  },
  setDoc: async () => {},
  updateDoc: async () => {},
  deleteDoc: async () => {},
  addDoc: async () => {},
  query: (...args) => ({ args }),
  where: (...args) => ({ where: args }),
  orderBy: (...args) => ({ orderBy: args }),
  limit: (...args) => ({ limit: args }),
  documentId: () => "__name__",
  writeBatch: null,
  select: null,
  onSnapshot: () => () => {},
};

const store = initDomainStore(fb);
const deal = await store.getDeal("deal_1");
assert.equal(deal.id, "deal_1");
assert(fetches.some((url) => url.endsWith("/api/deals/deal_1")));

let detail = null;
store.subscribeDealDetail("deal_1", (snap) => {
  detail = snap;
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(detail?.deal?.id, "deal_1");
assert.equal(detail?.technicalCommit?.status, "yes");

console.log("firestore read API fallback passed");
