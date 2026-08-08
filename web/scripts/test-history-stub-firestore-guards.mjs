import assert from "node:assert/strict";
import { createFirestoreStore } from "../domain/firestore-store.js";

let firestoreCalls = 0;
const fail = () => {
  firestoreCalls++;
  throw new Error("Firestore should not be touched for history stub ids");
};

const store = createFirestoreStore({
  db: {},
  collection: fail,
  doc: fail,
  getDoc: fail,
  getDocs: fail,
  setDoc: fail,
  updateDoc: fail,
  deleteDoc: fail,
  addDoc: fail,
  query: fail,
  where: fail,
  orderBy: fail,
  limit: fail,
  documentId: () => "__name__",
  writeBatch: null,
  select: null,
  onSnapshot: fail,
});

assert.deepEqual(await store.listDealsByAccount("hist_healthydietqa"), []);
assert.equal(await store.getDeal("deal_hist_healthydietqa"), null);
assert.equal(await store.getPostCall("hist_healthydietqa"), null);
assert.equal(await store.getCall("hist_healthydietqa"), null);
assert.equal(await store.getTechnicalCommitByDeal("deal_hist_healthydietqa"), null);

let dealDetail = undefined;
const unsubDeal = store.subscribeDealDetail("deal_hist_healthydietqa", (snap) => {
  dealDetail = snap;
});
assert.equal(typeof unsubDeal, "function");
assert.equal(dealDetail?.deal, null);
assert.deepEqual(dealDetail?.arrLines, []);

let callDetail = undefined;
const unsubCall = store.subscribeCallDetail("hist_healthydietqa", (snap) => {
  callDetail = snap;
});
assert.equal(typeof unsubCall, "function");
assert.equal(callDetail?.postCall, null);
assert.deepEqual(callDetail?.scorecards, []);

assert.equal(firestoreCalls, 0);
console.log("history stub Firestore guards passed");
