/** Regression: realtime Firestore calls must persist to local history so the
 *  dashboard renders the Calls tile value instantly on return (no shimmer until
 *  the network snapshot fires). */
import assert from "node:assert/strict";
import { initDomainStore } from "../domain/store.js";
import {
  mergePostCallRecordsIntoLocal,
  listPostCallAnalyses,
} from "../history.js";

const storeData = new Map();
globalThis.localStorage = {
  getItem: (k) => storeData.get(k) ?? null,
  setItem: (k, v) => storeData.set(k, v),
  removeItem: (k) => storeData.delete(k),
  key: (i) => [...storeData.keys()][i] ?? null,
  get length() { return storeData.size; },
};
initDomainStore(null);

const email = "realtime@freshworks.com";

// Simulate Firestore postCall docs (createdAt = Firestore Timestamp, updatedAt ISO).
const calls = [
  {
    id: "call-1",
    title: "Discovery with Acme",
    createdAt: { seconds: 1700000000, nanoseconds: 0 },
    updatedAt: "2026-08-08T09:00:00Z",
    analysis: { callHeader: { attendees: [] } },
  },
  {
    id: "call-2",
    title: "Demo with Globex",
    createdAt: 1700000100000,
    updatedAt: "2026-08-08T10:00:00Z",
    analysis: { callHeader: { attendees: [] } },
  },
];

const count = mergePostCallRecordsIntoLocal(email, calls);
assert.equal(count, 2, "merges both remote calls into local history");
const stored = listPostCallAnalyses(email);
assert.equal(stored.length, 2, "local history now has both calls");
assert.ok(
  stored.every((r) => typeof r.timestamp === "number" && r.timestamp > 0),
  "timestamp is a number (sortable) even from Firestore Timestamp objects",
);
assert.equal(stored[0].id, "call-2", "newest first (sort by timestamp desc)");

// Idempotent: re-merge same docs must not duplicate.
const count2 = mergePostCallRecordsIntoLocal(email, calls);
assert.equal(count2, 2, "re-merge is idempotent (no duplicates)");

console.log("test-realtime-persist: ok");
