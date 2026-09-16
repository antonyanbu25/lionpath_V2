/**
 * Smoke: scoped account/deal read handlers are exported for routing.
 */
import assert from "node:assert/strict";
import {
  handleAccountsListGet,
  handleAccountDealsListGet,
} from "../src/routes/domain-reads.ts";

assert.equal(typeof handleAccountsListGet, "function");
assert.equal(typeof handleAccountDealsListGet, "function");
console.log("test-domain-reads-precall: ok");
