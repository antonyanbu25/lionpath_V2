#!/usr/bin/env tsx
/**
 * v2.2 leadership cap — boundary tests at LEADERSHIP_CAP_THRESHOLD (8.0), plus a parity check
 * that worker/src/quality-score.ts and web/quality-score.js apply the cap identically (they
 * are two independent implementations of the same rule, not a shared module — see the
 * corrected-facts note in the build spec — so drift between them is a real risk).
 */
import assert from "node:assert/strict";
import {
  applyLeadershipCap as applyLeadershipCapWorker,
  LEADERSHIP_CAP_THRESHOLD as THRESHOLD_WORKER,
} from "../src/quality-score.ts";
import {
  applyLeadershipCap as applyLeadershipCapWeb,
  LEADERSHIP_CAP_THRESHOLD as THRESHOLD_WEB,
} from "../../web/quality-score.js";

assert.equal(THRESHOLD_WORKER, 8.0, "worker threshold is 8.0");
assert.equal(THRESHOLD_WEB, 8.0, "web threshold mirrors worker's 8.0");

const CASES: Array<[number, boolean, string]> = [
  [8.0, false, "exactly at the cap, unverified"],
  [8.0, true, "exactly at the cap, verified"],
  [7.99, false, "just under the cap, unverified"],
  [8.01, false, "just over the cap, unverified"],
  [8.01, true, "just over the cap, verified"],
  [10, false, "max score, unverified"],
  [10, true, "max score, verified"],
  [0, false, "zero, unverified"],
];

for (const [overall, verified, label] of CASES) {
  const worker = applyLeadershipCapWorker(overall, verified);
  const web = applyLeadershipCapWeb(overall, verified);
  assert.deepEqual(
    worker,
    web,
    `worker/web parity mismatch for overall=${overall} verified=${verified} (${label}): ` +
      `worker=${JSON.stringify(worker)} web=${JSON.stringify(web)}`,
  );
}

// Boundary semantics: strictly greater than the cap is what triggers clamping — exactly 8.0
// must never be treated as "above" the bar.
assert.deepEqual(applyLeadershipCapWorker(8.0, false), { overall: 8.0, capped: false });
assert.deepEqual(applyLeadershipCapWorker(8.0000001, false), { overall: 8.0, capped: true });
assert.deepEqual(applyLeadershipCapWorker(8.0000001, true), { overall: 8.0000001, capped: false });

// A verified overall is never clamped, no matter how high.
assert.deepEqual(applyLeadershipCapWorker(10, true), { overall: 10, capped: false });

// Non-finite/garbage input is defensive — never throws, never returns a capped=true with a
// bogus overall.
for (const bad of [NaN, Infinity, -Infinity, undefined as unknown as number, null as unknown as number, "10" as unknown as number]) {
  const worker = applyLeadershipCapWorker(bad, false);
  const web = applyLeadershipCapWeb(bad, false);
  assert.deepEqual(worker, { overall: 0, capped: false }, `worker defensive result for ${String(bad)}`);
  assert.deepEqual(web, { overall: 0, capped: false }, `web defensive result for ${String(bad)}`);
}

console.log("test-leadership-cap-parity: ok");
