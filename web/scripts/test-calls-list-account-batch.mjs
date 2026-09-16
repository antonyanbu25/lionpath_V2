#!/usr/bin/env node
/**
 * UAT-007 regression test — Activities list took 20-30s+ to load for users
 * with many accounts.
 *
 * Root cause: web/calls-list-view.js's enrichDealsAndAccounts() resolved
 * account metadata (name/domain) for every accountId referenced by the
 * activity feed via batchGetByIds("accounts", ids, ...), which routed
 * through store.getReadModels("accounts", ids). "accounts" is not a
 * registered read-model collection (worker/src/routes/read-models.ts
 * `allowed` set is teamMetrics/orgMetrics/dealTraction/accountRollup/
 * seLaunchpad only), so every one of those requests 404'd -- for a session
 * with K unique accounts, that meant K doomed concurrent requests fired on
 * every render, which is what actually cost the 20-30s.
 *
 * The fix collects all referenced accountIds up front and resolves them from
 * ONE call to store.listAccounts() (-> GET /api/accounts), which already
 * returns the full account directory and was already being called elsewhere
 * in this same function for company-name fuzzy matching.
 *
 * This test proves three things against a fixture of 20 activities spanning
 * 15 unique accounts:
 *
 *   1. The NEW path costs exactly one /api/accounts request, not K.
 *   2. The OLD path (still present, preserved as the fallback branch for
 *      store implementations without listAccounts) really did cost K
 *      requests to the dead read-models endpoint, and resolved nothing --
 *      reproducing the bug rather than asserting it from memory.
 *   3. Scoping/authorization is unchanged: the accounts the new batched path
 *      resolves are byte-identical to what per-id resolution via the
 *      WORKING single-account endpoint (GET /api/accounts/:id, the fallback
 *      that never actually ran in production because getReadModels masked
 *      it) would have produced. No account is added or dropped by batching.
 *
 * On scoping: worker/src/routes/domain-reads.ts handleAccountsListGet and
 * handleAccountGetById, and worker/src/data/repositories/accounts.ts
 * listAccounts/getAccount, apply NO canReadResource/scope check at all --
 * unlike the calls/deals list endpoints, which do filter by caller. Account
 * metadata reads are, and always have been, unscoped for any signed-in
 * user. This test does not (and cannot honestly) prove a permission filter
 * that doesn't exist; what it proves is that batching doesn't change WHICH
 * of those (equally unscoped) account records end up attached to which
 * activity row -- i.e. no visibility change, only fewer round trips.
 */
import assert from "node:assert/strict";
import { firebaseConfig } from "../firebase-config.js";
import { initDomainStore } from "../domain/store.js";
import { enrichDealsAndAccounts } from "../calls-list-view.js";

// Force resolveReadMode()/resolveWriteMode() (web/domain/store.js) to "api"
// so getStore() inside enrichDealsAndAccounts returns a real createApiStore
// instance talking to our mocked fetch below, the same technique used by
// web/scripts/test-firestore-read-api-fallback.mjs. fb stays null so no
// Firestore delegate is constructed at all (getAccount/listAccounts never
// fall back to it here).
firebaseConfig.projectId = "test-project";

// ---- Fixture: 20 activities across 15 unique accounts ----------------
const ACCOUNT_IDS = Array.from({ length: 14 }, (_, i) => `account_${i + 1}`);
const records = [];
for (let i = 0; i < 20; i++) {
  const referencesUnknownAccount = i === 19; // 1 activity points at an id absent from the directory
  records.push({
    id: `call_${i}`,
    timestamp: Date.now() - i * 1000,
    accountId: referencesUnknownAccount ? "account_missing" : ACCOUNT_IDS[i % ACCOUNT_IDS.length],
  });
}
// 14 real accountIds (account_1..account_14, all referenced at least once
// since 19 cycles >= 14) + 1 unresolvable id (account_missing) = 15 unique.
const uniqueAccountIds = new Set(records.map((r) => r.accountId));
assert.equal(uniqueAccountIds.size, 15, "fixture must reference 15 unique accounts");

const ACCOUNT_DIRECTORY = ACCOUNT_IDS.map((id, idx) => ({
  id,
  name: `Account ${idx + 1}`,
  domain: `acct${idx + 1}.example.com`,
  updatedAt: Date.now(),
}));
// Directory also has accounts nobody in the activity feed references, to
// prove the fix doesn't leak the whole directory into the result -- only
// ids actually asked for should land in the returned Map.
ACCOUNT_DIRECTORY.push({ id: "account_unrelated_1", name: "Unrelated One", domain: "unrelated1.example.com" });
ACCOUNT_DIRECTORY.push({ id: "account_unrelated_2", name: "Unrelated Two", domain: "unrelated2.example.com" });
// "account_missing" is deliberately NOT in the directory (deleted / unknown
// id) so both old and new resolution paths must treat it as "not found"
// rather than fabricating a row.

const session = { email: "se@example.com" };

// ---- Mocked worker: no live network, fixed latency-free responses ----
const fetchLog = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  fetchLog.push(u);
  if (/\/api\/read-models\/accounts\//.test(u)) {
    // Real worker behavior (worker/src/routes/read-models.ts): "accounts" is
    // not in the allowed collection set, so this always 404s.
    return { ok: false, status: 404, async json() { return { error: "Unknown read-model collection." }; } };
  }
  if (/\/api\/accounts\/[^/]+\/deals/.test(u)) {
    return { ok: true, async json() { return { deals: [] }; } };
  }
  const singleMatch = u.match(/\/api\/accounts\/([^/?]+)$/);
  if (singleMatch) {
    const account = ACCOUNT_DIRECTORY.find((a) => a.id === decodeURIComponent(singleMatch[1]));
    if (!account) return { ok: false, status: 404, async json() { return { error: "Account not found." }; } };
    return { ok: true, async json() { return { account, summary: null }; } };
  }
  if (/\/api\/accounts(\?|$)/.test(u)) {
    return { ok: true, async json() { return { accounts: ACCOUNT_DIRECTORY }; } };
  }
  if (/\/api\/deals/.test(u)) {
    return { ok: true, async json() { return { deals: [] }; } };
  }
  return { ok: false, status: 404, async json() { return { error: "not found" }; } };
};

const store = initDomainStore(null);
assert.equal(typeof store.listAccounts, "function", "sanity: expected a real api-store with listAccounts");
assert.equal(typeof store.getReadModels, "function", "sanity: expected a real api-store with getReadModels");
assert.equal(typeof store.getAccount, "function", "sanity: expected a real api-store with getAccount");

const originalListAccounts = store.listAccounts;
const originalGetReadModels = store.getReadModels;

// ======================================================================
// Scenario 1 (AFTER / the fix): store.listAccounts is available, which is
// always true for the real api-store — this is what production actually
// exercises today.
// ======================================================================
fetchLog.length = 0;
const after = await enrichDealsAndAccounts(records, session, []);

const accountListRequests = fetchLog.filter((u) => /\/api\/accounts(\?|$)/.test(u));
const readModelAccountRequests = fetchLog.filter((u) => /\/api\/read-models\/accounts\//.test(u));
const scopedDealsRequests = fetchLog.filter((u) => /\/api\/accounts\/[^/]+\/deals/.test(u));

assert.equal(
  accountListRequests.length,
  1,
  `expected exactly ONE /api/accounts request for 15 unique accounts, got ${accountListRequests.length}: ${JSON.stringify(accountListRequests)}`,
);
assert.equal(readModelAccountRequests.length, 0, "fixed path must not touch the dead read-models/accounts endpoint");
// listDealsForAccount uses GET /api/accounts/:id/deals (scoped). One request per unique
// account id in the feed (in-flight dedupe is per account id, not one global list).
assert.equal(
  scopedDealsRequests.length,
  uniqueAccountIds.size,
  `expected one scoped /deals request per unique account id in feed, got ${scopedDealsRequests.length}`,
);

// Every referenced account that exists in the directory must resolve, with
// the right fields; the one unresolvable id must be absent, not fabricated;
// unrelated directory accounts nobody asked for must not leak in.
for (let i = 0; i < ACCOUNT_IDS.length; i++) {
  const id = ACCOUNT_IDS[i];
  const resolved = after.accounts.get(id);
  assert.ok(resolved, `expected ${id} to resolve`);
  assert.equal(resolved.name, `Account ${i + 1}`);
  assert.equal(resolved.domain, `acct${i + 1}.example.com`);
}
assert.equal(after.accounts.has("account_missing"), false, "unresolvable account must not be fabricated");
assert.equal(after.accounts.has("account_unrelated_1"), false, "unreferenced directory accounts must not leak in");
assert.equal(after.accounts.has("account_unrelated_2"), false, "unreferenced directory accounts must not leak in");
assert.equal(after.accounts.size, ACCOUNT_IDS.length, "exactly the 14 resolvable referenced accounts, nothing more");

// ======================================================================
// Scenario 2 (BEFORE, reproduced): simulate a store without listAccounts —
// this is the code path calls-list-view.js's per-id resolution actually
// took before the fix (batchGetByIds -> store.getReadModels("accounts",
// ids)), preserved verbatim as the fallback branch. Proves the bug is real:
// K round trips fired, all doomed, zero accounts resolved.
// ======================================================================
fetchLog.length = 0;
store.listAccounts = undefined;
const before = await enrichDealsAndAccounts(records, session, []);
store.listAccounts = originalListAccounts;

const beforeReadModelRequests = fetchLog.filter((u) => /\/api\/read-models\/accounts\//.test(u));
assert.equal(
  beforeReadModelRequests.length,
  15,
  `expected the pre-fix path to fire one request per unique account (15), got ${beforeReadModelRequests.length}`,
);
assert.equal(before.accounts.size, 0, "pre-fix path never actually resolved any account (dead read-models collection)");

// ======================================================================
// Scenario 3 (scoping/authorization equivalence): force per-id resolution
// through the WORKING single-account endpoint (GET /api/accounts/:id —
// the fallback that never ran in production because getReadModels masked
// it) and confirm it resolves the exact same accounts, with the exact same
// fields, as the batched fix in Scenario 1. Both endpoints apply zero
// caller-based scoping server-side (verified by reading
// handleAccountsListGet / handleAccountGetById / listAccounts / getAccount
// in worker/src) — so this proves batching didn't change WHICH accounts
// become visible on which row, only how many requests it took to find out.
// ======================================================================
fetchLog.length = 0;
store.listAccounts = undefined;
store.getReadModels = undefined;
const viaSingleGet = await enrichDealsAndAccounts(records, session, []);
store.listAccounts = originalListAccounts;
store.getReadModels = originalGetReadModels;

const singleGetRequests = fetchLog.filter((u) => /\/api\/accounts\/[^/?]+$/.test(u));
assert.equal(
  singleGetRequests.length,
  15,
  `expected one GET /api/accounts/:id per unique account attempted, including the one that 404s (15), got ${singleGetRequests.length}`,
);
assert.deepEqual(
  [...viaSingleGet.accounts.entries()].sort(),
  [...after.accounts.entries()].sort(),
  "batched resolution must resolve the identical set of accounts (same ids, same field values) as per-id resolution — no visibility change from batching",
);

console.log(
  `test-calls-list-account-batch.mjs: ok ` +
    `(after: ${accountListRequests.length} accounts request + ${scopedDealsRequests.length} scoped deals requests for 15 unique accounts; ` +
    `before: ${beforeReadModelRequests.length} dead requests, 0 resolved; ` +
    `scoping equivalence: ${singleGetRequests.length} per-id requests produced an identical result)`,
);
