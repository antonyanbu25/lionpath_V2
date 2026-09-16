/** Regression (astra-audit P14 item 5, F-029-035): mergeHistoryLists used to
 *  resolve same-id collisions by argument order alone, so whichever list was
 *  passed last won even if it carried a staler updatedAt. This proves the
 *  newest updatedAt wins regardless of which list it arrived in. */
import assert from "node:assert/strict";
import { mergeHistoryLists } from "../history.js";

const stale = { id: "call-1", updatedAt: "2026-08-01T00:00:00Z", timestamp: 100, title: "stale" };
const fresh = { id: "call-1", updatedAt: "2026-08-08T00:00:00Z", timestamp: 200, title: "fresh" };

// Stale passed LAST — argument-order-wins would incorrectly pick it.
const a = mergeHistoryLists([fresh], [stale]);
assert.equal(a.find((r) => r.id === "call-1")?.title, "fresh", "fresher updatedAt wins even when passed first");

// Fresh passed LAST — argument-order-wins would happen to get this one right,
// so it alone would not catch a regression; both directions must be checked.
const b = mergeHistoryLists([stale], [fresh]);
assert.equal(b.find((r) => r.id === "call-1")?.title, "fresh", "fresher updatedAt wins even when passed last");

// No updatedAt on either side: falls back to timestamp, not just "last wins".
const older = { id: "call-2", timestamp: 100, title: "older" };
const newer = { id: "call-2", timestamp: 200, title: "newer" };
const c = mergeHistoryLists([newer], [older]);
assert.equal(c.find((r) => r.id === "call-2")?.title, "newer", "falls back to timestamp when updatedAt is absent");

// Distinct ids from multiple lists all survive the merge.
const d = mergeHistoryLists(
  [{ id: "x", timestamp: 1 }],
  [{ id: "y", timestamp: 2 }],
  [{ id: "z", timestamp: 3 }],
);
assert.equal(d.length, 3, "entries with distinct ids are unioned, not just deduped");

console.log("test-history-merge-precedence: ok");
