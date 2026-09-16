#!/usr/bin/env node
/**
 * UAT-007 before/after timing harness — Activities list account-resolution
 * N+1 (web/calls-list-view.js enrichDealsAndAccounts, via
 * web/domain/api-store.js).
 *
 * Not a pass/fail test (not in test-manifest.mjs) — a measurement, in the
 * spirit of docs/janus-forensic-reaudit-20260911/12-findings-ledger.md
 * finding J-040: don't conclude "faster" from one sample, and separate the
 * network-floor cost (one round trip) from what the fix actually saves.
 *
 * No live network: fetch is mocked with a fixed artificial per-request
 * latency and a connection-concurrency cap modeling a same-origin HTTP/1.1
 * browser limit (6 concurrent connections is the common default; Chrome,
 * Firefox, Safari all use it). That cap is a MODELING CHOICE stated here
 * explicitly, not a measured fact about any specific browser/network setup
 * — the point being proven is "N+1 round trips collapse to O(1)", which
 * holds regardless of the exact cap chosen; the cap only makes the
 * wall-clock gap visible instead of hidden behind infinite mock concurrency.
 *
 * Usage (from web/):
 *   node scripts/measure-calls-list-account-batch.mjs             # N=11 trials, 70ms/req, cap=6
 *   node scripts/measure-calls-list-account-batch.mjs --n=21 --latency=60 --cap=6
 */
import { firebaseConfig } from "../firebase-config.js";
import { initDomainStore } from "../domain/store.js";
import { enrichDealsAndAccounts } from "../calls-list-view.js";

function argNum(flag, fallback) {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg ? Number(arg.slice(flag.length + 3)) : fallback;
}

const N = argNum("n", 11);
const LATENCY_MS = argNum("latency", 70);
const CONCURRENCY_CAP = argNum("cap", 6);
// Default matches the task's own example size (20 activities / 15 unique
// accounts); override with --accounts=N to see how the gap scales with K —
// it should widen roughly linearly for BEFORE (more ceil(K/cap) batches)
// while AFTER stays flat (always ~1-2 requests regardless of K).
const UNIQUE_ACCOUNTS = argNum("accounts", 14);

firebaseConfig.projectId = "test-project"; // force api-mode store; see web/domain/store.js resolveReadMode

// ---- Fixture: activityCount activities across UNIQUE_ACCOUNTS+1 unique accounts ----
const ACCOUNT_IDS = Array.from({ length: UNIQUE_ACCOUNTS }, (_, i) => `account_${i + 1}`);
const ACTIVITY_COUNT = Math.max(UNIQUE_ACCOUNTS + 6, 20);
const records = [];
for (let i = 0; i < ACTIVITY_COUNT; i++) {
  const referencesUnknownAccount = i === ACTIVITY_COUNT - 1;
  records.push({
    id: `call_${i}`,
    timestamp: Date.now() - i * 1000,
    accountId: referencesUnknownAccount ? "account_missing" : ACCOUNT_IDS[i % ACCOUNT_IDS.length],
  });
}
const ACCOUNT_DIRECTORY = ACCOUNT_IDS.map((id, idx) => ({
  id,
  name: `Account ${idx + 1}`,
  domain: `acct${idx + 1}.example.com`,
  updatedAt: Date.now(),
}));
const session = { email: "se@example.com" };

// ---- Mocked network: fixed latency + a same-origin concurrency cap ----
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function installMockFetch() {
  let active = 0;
  const queue = [];
  const acquire = () =>
    new Promise((resolve) => {
      const tryNow = () => {
        if (active < CONCURRENCY_CAP) {
          active++;
          resolve();
        } else {
          queue.push(tryNow);
        }
      };
      tryNow();
    });
  const release = () => {
    active--;
    const next = queue.shift();
    if (next) next();
  };

  const log = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    log.push(u);
    await acquire();
    try {
      await sleep(LATENCY_MS);
      if (/\/api\/read-models\/accounts\//.test(u)) {
        return { ok: false, status: 404, async json() { return { error: "Unknown read-model collection." }; } };
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
    } finally {
      release();
    }
  };
  return log;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** One isolated round trip — the network floor this fix's savings sits on top of. */
async function measureFloor() {
  const log = installMockFetch();
  const t0 = performance.now();
  await fetch("http://mock/api/accounts/account_1");
  const ms = performance.now() - t0;
  return { ms, requests: log.length };
}

/** BEFORE: force the fallback branch (no listAccounts) — reproduces the
 * literal pre-fix code path (batchGetByIds -> store.getReadModels("accounts",
 * ids)), which 404s once per unique account. */
async function measureBefore() {
  const log = installMockFetch();
  const store = initDomainStore(null);
  store.listAccounts = undefined;
  const t0 = performance.now();
  const result = await enrichDealsAndAccounts(records, session, []);
  const ms = performance.now() - t0;
  return { ms, requests: log.length, resolved: result.accounts.size };
}

/** AFTER: the fix, as production actually runs it (store.listAccounts present). */
async function measureAfter() {
  const log = installMockFetch();
  initDomainStore(null); // fresh store per trial so caches don't leak across samples
  const t0 = performance.now();
  const result = await enrichDealsAndAccounts(records, session, []);
  const ms = performance.now() - t0;
  return { ms, requests: log.length, resolved: result.accounts.size };
}

console.log(
  `fixture   ${ACTIVITY_COUNT} activities, ${UNIQUE_ACCOUNTS + 1} unique accounts (${UNIQUE_ACCOUNTS} resolvable + 1 unknown)`,
);
console.log(`mock      ${LATENCY_MS}ms/request, ${CONCURRENCY_CAP} concurrent connections (same-origin cap, modeled)`);
console.log(`samples   ${N} trials each, median reported\n`);

const floorSamples = [];
for (let i = 0; i < N; i++) floorSamples.push((await measureFloor()).ms);

const beforeSamples = [];
let beforeRequests = null;
let beforeResolved = null;
for (let i = 0; i < N; i++) {
  const r = await measureBefore();
  beforeSamples.push(r.ms);
  beforeRequests = r.requests;
  beforeResolved = r.resolved;
}

const afterSamples = [];
let afterRequests = null;
let afterResolved = null;
for (let i = 0; i < N; i++) {
  const r = await measureAfter();
  afterSamples.push(r.ms);
  afterRequests = r.requests;
  afterResolved = r.resolved;
}

const floorMedian = median(floorSamples);
const beforeMedian = median(beforeSamples);
const afterMedian = median(afterSamples);

console.log("| scenario | requests fired | accounts resolved | median elapsed | vs floor |");
console.log("|---|---|---|---|---|");
console.log(`| network floor (1 request) | 1 | n/a | ${floorMedian.toFixed(1)}ms | 1.0x |`);
console.log(
  `| BEFORE (dead read-models fallback, ${UNIQUE_ACCOUNTS + 1} unique accounts) | ${beforeRequests} | ${beforeResolved} | ${beforeMedian.toFixed(1)}ms | ${(beforeMedian / floorMedian).toFixed(1)}x |`,
);
console.log(
  `| AFTER (this fix — one /api/accounts + one /api/deals) | ${afterRequests} | ${afterResolved} | ${afterMedian.toFixed(1)}ms | ${(afterMedian / floorMedian).toFixed(1)}x |`,
);

console.log(
  `\nrequest count: ${beforeRequests} -> ${afterRequests} (${(beforeRequests / afterRequests).toFixed(1)}x fewer network round trips)`,
);
console.log(
  `wall-clock:    ${beforeMedian.toFixed(1)}ms -> ${afterMedian.toFixed(1)}ms (${(beforeMedian / afterMedian).toFixed(1)}x faster) at ${LATENCY_MS}ms/request under a ${CONCURRENCY_CAP}-connection cap`,
);
console.log(
  `\nCAVEAT: absolute ms are dominated by the modeled ${LATENCY_MS}ms/request and ${CONCURRENCY_CAP}-connection cap, not by any measured browser or staging network. ` +
    `What transfers to production is the REQUEST COUNT reduction (K -> ~1, independent of latency/concurrency assumptions) and the fact that wall-clock scales with ` +
    `ceil(requests / concurrency cap) x per-request latency for the old path but stays ~flat for the new one — so the worse the real per-request latency or the ` +
    `tighter the real concurrency limit, the LARGER (not smaller) the actual production win over this estimate.`,
);
