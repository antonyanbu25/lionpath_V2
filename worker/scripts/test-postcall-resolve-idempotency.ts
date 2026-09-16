#!/usr/bin/env tsx
/**
 * 2026-09-11 staging UAT remediation, item 10 (P1) regression gate: server-side
 * dedup for POST /api/postcall/resolve.
 *
 * INVESTIGATION RECORDED HERE FOR THE NEXT READER: runPostCallResolve
 * (worker/src/postcall/resolve.ts) does no Firestore/Postgres write of its
 * own -- it is a pure function of its input plus whatever it fetches, so a
 * bare retry cannot corrupt persisted state or produce a WRONG answer. That
 * is why this is NOT a "make the write idempotent" fix like UAT-003's
 * test-deal-create-idempotency.ts. What it IS: the handler hardcodes
 * `attributeSpeakers: true` (worker/src/routes.ts handlePostCallResolve),
 * which for a timestamped transcript triggers one real Gemini call, and when
 * a recording link is present it fetches the Zoom recording (Server-to-Server
 * OAuth / share-link scrape -- real API quota) or Kaia's share content. A
 * network-level retry of an identical request (a slow connection's fetch
 * timing out and retrying, or a proxy retrying a request whose response was
 * lost after the server had already finished) would pay for that work a
 * second time for an answer already computed. The fix is
 * `runPostCallResolveDeduped`, exported from routes.ts for this test, which
 * dedupes by request CONTENT via `deterministicAppendId` -- the exact same
 * helper and "hash plus a coarse time bucket" reasoning UAT-003 reused, just
 * with a much shorter window (RESOLVE_DEDUP_WINDOW_MS, 30s) since this is an
 * in-memory guard against a network retry rather than a durable audit-trail
 * id.
 *
 * WHY THIS IS FULLY MOCKED ("unit"): same rationale as
 * test-deal-create-idempotency.ts -- driving handlePostCallResolve itself
 * would need a verified Firebase ID token and either a real or emulated
 * Zoom/Gemini call, neither of which is what this bug or fix is about.
 * `runPostCallResolveDeduped` takes the underlying resolve call (`run`) and
 * the clock (`now`) as injectable parameters for exactly this reason -- see
 * its docstring in routes.ts.
 *
 * Asserts:
 *   1. Two literally concurrent identical requests share ONE in-flight
 *      resolve call and both callers get the same result.
 *   2. A sequential duplicate arriving AFTER a success, still inside the
 *      dedup window, reuses the cached result -- no second resolve call.
 *   3. The same duplicate content, but in a LATER dedup-window bucket, runs
 *      fresh -- a genuinely later resend is not starved forever.
 *   4. A FAILED attempt is never replayed. This is the guard that protects
 *      web/postcall.js's resolveWithZoomPendingRetry, which legitimately
 *      resends the identical body several times while polling for a Zoom
 *      transcript that was still generating: caching that failure would make
 *      every subsequent poll replay the same stale "still generating" answer
 *      instead of actually checking Zoom again.
 *   5. Different request content is never deduped, even within the window.
 *   6. Contrast: calling the underlying resolve directly (the pre-fix shape,
 *      simulated with the same fake `run`) always re-runs on every retry --
 *      the exact defect this gate exists to catch. Confirmed separately by
 *      `git stash` on worker/src/routes.ts: this file fails to even import
 *      (runPostCallResolveDeduped/RESOLVE_DEDUP_WINDOW_MS do not exist yet)
 *      against the pre-fix code, the same failure mode
 *      test-deal-create-idempotency.ts's docstring records for UAT-003.
 */
import assert from "node:assert/strict";
import {
  __resetResolveDedupCacheForTests,
  runPostCallResolveDeduped,
  RESOLVE_DEDUP_WINDOW_MS,
} from "../src/routes.ts";

let failures = 0;
async function check(label: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * A fake stand-in for runPostCallResolve. Records how many times the
 * (expensive, real-money-costing) underlying work actually ran, and tags
 * each result with a sequence number so tests can tell two results apart.
 * `delayMs` lets a test create a genuine in-flight window for the
 * concurrency case.
 */
function makeCountingRun(opts: { delayMs?: number; reject?: boolean } = {}) {
  let calls = 0;
  const run = async (input: Record<string, unknown>) => {
    calls += 1;
    const seq = calls;
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.reject) {
      throw Object.assign(new Error("Zoom transcript still generating"), {
        status: 202,
        pending: true,
      });
    }
    return { seq, transcript: String(input.transcript || "") };
  };
  return { run, callCount: () => calls };
}

// A `now` comfortably inside a dedup bucket, mirroring
// test-deal-create-idempotency.ts's BUCKET_START/NOW convention.
const BUCKET_START = Math.floor(Date.now() / RESOLVE_DEDUP_WINDOW_MS) * RESOLVE_DEDUP_WINDOW_MS;
const NOW = BUCKET_START + 1_000;

const BASE_INPUT = {
  email: "se@freshworks.com",
  ownerId: "usr_se_1",
  transcript: "SE: Thanks for joining. Customer: Happy to be here.",
  participantEmails: ["prospect@acme.example.com"],
};

console.log("\n1. Two concurrent identical requests -> one underlying resolve run, shared result");
await check("both callers get the SAME resolve run's result, run called exactly once", async () => {
  __resetResolveDedupCacheForTests();
  const { run, callCount } = makeCountingRun({ delayMs: 20 });
  const p1 = runPostCallResolveDeduped({ ...BASE_INPUT }, {}, { now: NOW, run });
  const p2 = runPostCallResolveDeduped({ ...BASE_INPUT }, {}, { now: NOW + 5, run });
  const [r1, r2] = (await Promise.all([p1, p2])) as { seq: number }[];
  assert.equal(callCount(), 1, `expected the underlying resolve to run once, ran ${callCount()} times`);
  assert.equal(r2.seq, r1.seq, "the second (concurrent duplicate) caller must get the first call's result");
});

console.log("\n2. Sequential duplicate AFTER success, same window -> cached result reused");
await check("a retry whose response was lost gets the cached success, no second resolve run", async () => {
  __resetResolveDedupCacheForTests();
  const { run, callCount } = makeCountingRun({});
  const r1 = (await runPostCallResolveDeduped({ ...BASE_INPUT }, {}, { now: NOW, run })) as { seq: number };
  const r2 = (await runPostCallResolveDeduped(
    { ...BASE_INPUT },
    {},
    { now: NOW + 2_000, run },
  )) as { seq: number };
  assert.equal(callCount(), 1, `expected exactly 1 real resolve run, ran ${callCount()} times`);
  assert.equal(r2.seq, r1.seq, "the retry must reuse the first call's cached result");
});

console.log("\n3. Same content, but a LATER dedup-window bucket -> runs fresh, not starved forever");
await check("a genuinely later identical-content resolve still runs (outside the window)", async () => {
  __resetResolveDedupCacheForTests();
  const { run, callCount } = makeCountingRun({});
  const r1 = (await runPostCallResolveDeduped({ ...BASE_INPUT }, {}, { now: NOW, run })) as { seq: number };
  const laterBucketNow = NOW + RESOLVE_DEDUP_WINDOW_MS + 5_000; // safely into the next bucket
  const r2 = (await runPostCallResolveDeduped(
    { ...BASE_INPUT },
    {},
    { now: laterBucketNow, run },
  )) as { seq: number };
  assert.equal(callCount(), 2, `expected 2 real resolve runs, ran ${callCount()} times`);
  assert.notEqual(r2.seq, r1.seq, "a later resend outside the window must not reuse the earlier result");
});

console.log("\n4. A FAILED attempt is never replayed (protects resolveWithZoomPendingRetry's legitimate polling)");
await check(
  "two pending-retry-style resends of the identical body, same window, both run fresh",
  async () => {
    __resetResolveDedupCacheForTests();
    const { run, callCount } = makeCountingRun({ reject: true });
    await assert.rejects(() => runPostCallResolveDeduped({ ...BASE_INPUT }, {}, { now: NOW, run }));
    // Same content, still inside the 30s window -- must NOT reuse the rejected
    // attempt, or a real Zoom-pending poll would replay the stale failure
    // forever instead of checking Zoom again.
    await assert.rejects(
      () => runPostCallResolveDeduped({ ...BASE_INPUT }, {}, { now: NOW + 3_000, run }),
    );
    assert.equal(
      callCount(),
      2,
      `each pending-retry-style resend must run fresh, ran ${callCount()} time(s) for 2 resends`,
    );
  },
);

console.log("\n5. Different request content -> never deduped, even inside the window");
await check("two different bodies both run, regardless of timing", async () => {
  __resetResolveDedupCacheForTests();
  const { run, callCount } = makeCountingRun({});
  const r1 = (await runPostCallResolveDeduped(
    { ...BASE_INPUT, email: "se-a@freshworks.com" },
    {},
    { now: NOW, run },
  )) as { seq: number };
  const r2 = (await runPostCallResolveDeduped(
    { ...BASE_INPUT, email: "se-b@freshworks.com" },
    {},
    { now: NOW + 100, run },
  )) as { seq: number };
  assert.equal(callCount(), 2, `expected 2 real resolve runs for 2 different bodies, ran ${callCount()} times`);
  assert.notEqual(r2.seq, r1.seq);
});

console.log("\n6. Contrast: calling the underlying resolve directly (the pre-fix shape) always re-runs");
await check(
  "three byte-identical retries through the pre-fix shape cost three real resolve runs",
  async () => {
    // Reproduces the observable contract of the old handlePostCallResolve body
    // (`await runPostCallResolve(input, options)` with no dedup layer at all):
    // every retry, however soon after the last, pays for the work again. This
    // is the exact defect item 10 exists to prevent -- contrast with sections
    // 1-2 above, where runPostCallResolveDeduped collapses the same shape of
    // retries into one real run.
    const { run, callCount } = makeCountingRun({});
    await run({ ...BASE_INPUT });
    await run({ ...BASE_INPUT });
    await run({ ...BASE_INPUT });
    assert.equal(callCount(), 3, `expected the pre-fix shape to run 3 times, ran ${callCount()} times`);
  },
);

console.log("");
if (failures > 0) {
  console.error(`FAIL — ${failures} postcall-resolve idempotency check(s) failed.`);
  process.exit(1);
}
console.log("OK — POST /api/postcall/resolve dedup gate passed (2026-09-11 UAT remediation item 10).");
