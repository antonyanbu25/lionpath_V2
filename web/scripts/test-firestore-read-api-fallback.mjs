import assert from "node:assert/strict";
import { firebaseConfig } from "../firebase-config.js";
import { initDomainStore } from "../domain/store.js";

firebaseConfig.projectId = "test-project";
globalThis.location = { hostname: "portal.test", search: "" };
// resolveReadMode() (domain/store.js) — since the Janus SQL migration
// (ADR-008), the worker API is the default read path for ALL roles;
// direct browser Firestore reads (firestore-primary + api-fallback) are only
// reachable via an explicit `lionpath.readVia=firestore` opt-in or a local
// dev host. This test targets that firestore-primary + api-fallback wrapper
// (createReadFallbackStore's special subscribeDealDetail handling), so we
// force the firestore opt-in while keeping the non-local host — which keeps
// writeMode=api — to reproduce exactly the split read/write fallback path.
// Confirmed by tracing resolveReadMode()/resolveWriteMode() directly.
globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
};
globalThis.localStorage = {
  getItem: (key) => (key === "lionpath.readVia" ? "firestore" : null),
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
