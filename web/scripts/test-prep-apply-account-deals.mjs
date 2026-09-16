/**
 * Prefetched deal rows must be filtered to the target account before reuse.
 */
import assert from "node:assert/strict";
import { pickPrefetchedDealsForAccount } from "../prep-crm-resolve.js";

const mixed = [
  { id: "d1", accountId: "acct_a" },
  { id: "d2", accountId: "acct_b" },
  { id: "d3", accountId: "acct_a" },
];

const forA = pickPrefetchedDealsForAccount(mixed, "acct_a");
assert.equal(forA.length, 2);
assert.ok(forA.every((d) => d.accountId === "acct_a"));

assert.equal(pickPrefetchedDealsForAccount(mixed, "acct_missing").length, 0);
assert.equal(pickPrefetchedDealsForAccount([], "acct_a").length, 0);

console.log("test-prep-apply-account-deals.mjs: ok");
