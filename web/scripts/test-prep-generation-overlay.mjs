#!/usr/bin/env node
/**
 * UAT-001b / UAT-004 — client-side staged-timer that narrates a long single-request wait
 * (pre-call synthesize, post-call generate) when the backend gives no incremental signal.
 * Run: node web/scripts/test-prep-generation-overlay.mjs
 */
import assert from "node:assert/strict";

globalThis.document = { getElementById: () => null };
globalThis.window = globalThis;

import { planIndexAtElapsed, startPipelineAutoAdvance } from "../prep-generation-overlay.js";

function assertOk(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testPlanIndexAtElapsedPure() {
  const plan = [
    { id: "a", ms: 1000 },
    { id: "b", ms: 2000 },
    { id: "c", ms: 3000 },
  ];
  assert.deepEqual(planIndexAtElapsed(plan, 0), { index: 0, overrun: false }, "starts at index 0");
  assert.deepEqual(planIndexAtElapsed(plan, 500), { index: 0, overrun: false }, "stays at 0 before its ms elapses");
  assert.deepEqual(planIndexAtElapsed(plan, 1000), { index: 1, overrun: false }, "advances exactly at cumulative ms");
  assert.deepEqual(planIndexAtElapsed(plan, 2500), { index: 1, overrun: false }, "stays at 1 mid-stage");
  assert.deepEqual(planIndexAtElapsed(plan, 3000), { index: 2, overrun: false }, "advances to the last stage");
  // Never advances past the last entry — there is nothing further to become "active".
  assert.deepEqual(planIndexAtElapsed(plan, 5999), { index: 2, overrun: false }, "holds at the last stage right up to total");
  assert.deepEqual(planIndexAtElapsed(plan, 6001), { index: 2, overrun: true }, "flags overrun once total elapsed is exceeded");
  assert.deepEqual(planIndexAtElapsed([], 1000), { index: 0, overrun: false }, "empty plan is a safe no-op");
}

async function testStartPipelineAutoAdvanceNarratesWithoutMarkingLastDone() {
  const calls = [];
  const progress = {
    steps: [{ id: "analyzing" }, { id: "verifying" }, { id: "calibrating" }],
    set(id, status) {
      calls.push({ fn: "set", id, status });
    },
    advance(id, nextId) {
      calls.push({ fn: "advance", id, nextId });
    },
    setDetail(text) {
      calls.push({ fn: "setDetail", text });
    },
    clearDetail() {
      calls.push({ fn: "clearDetail" });
    },
  };
  const plan = [
    { id: "analyzing", ms: 30, detail: "Analyzing…" },
    { id: "verifying", ms: 30 },
    { id: "calibrating", ms: 30 },
  ];
  let overrunFired = false;
  const stop = startPipelineAutoAdvance(progress, plan, {
    tickMs: 10,
    onOverrun: () => {
      overrunFired = true;
    },
  });

  // enter(0) runs synchronously before the first tick.
  assertOk(calls[0]?.fn === "setDetail" && calls[0].text === "Analyzing…", "narrates the first stage immediately");

  await new Promise((r) => setTimeout(r, 200));
  stop();
  const afterStopCallCount = calls.length;
  await new Promise((r) => setTimeout(r, 60));
  assertOk(calls.length === afterStopCallCount, "stop() halts further ticks — no zombie interval");

  const advances = calls.filter((c) => c.fn === "advance");
  assertOk(
    advances.some((c) => c.id === "analyzing" && c.nextId === "verifying"),
    "advances analyzing -> verifying",
  );
  assertOk(
    advances.some((c) => c.id === "verifying" && c.nextId === "calibrating"),
    "advances verifying -> calibrating",
  );
  assertOk(
    !advances.some((c) => c.id === "calibrating"),
    "never advances past the last plan entry — only the real response marks it done",
  );
  assertOk(overrunFired, "fires onOverrun once total planned time has passed while still waiting");
}

async function testStartPipelineAutoAdvanceSameIdNeverAdvancesJustNarrates() {
  // Pre-call's synthesize plan reuses the same step id for every entry (UAT-001b) — it
  // must re-narrate the detail text without ever calling progress.advance().
  const calls = [];
  const progress = {
    steps: [{ id: "synthesize" }],
    set() {},
    advance(...args) {
      calls.push({ fn: "advance", args });
    },
    setDetail(text) {
      calls.push({ fn: "setDetail", text });
    },
    clearDetail() {
      calls.push({ fn: "clearDetail" });
    },
  };
  const plan = [
    { id: "synthesize", ms: 20, detail: "Writing…" },
    { id: "synthesize", ms: 20, detail: "Still writing…" },
  ];
  const stop = startPipelineAutoAdvance(progress, plan, { tickMs: 10 });
  await new Promise((r) => setTimeout(r, 100));
  stop();
  assertOk(!calls.some((c) => c.fn === "advance"), "never calls advance() when the id repeats");
  assertOk(calls.some((c) => c.fn === "setDetail" && c.text === "Still writing…"), "still narrates the second entry");
}

function testStartPipelineAutoAdvanceIsANoOpWithoutProgressOrPlan() {
  const stop1 = startPipelineAutoAdvance(null, [{ id: "a", ms: 10 }]);
  const stop2 = startPipelineAutoAdvance({ setDetail() {}, clearDetail() {} }, []);
  assertOk(typeof stop1 === "function" && typeof stop2 === "function", "always returns a callable stop function");
  stop1();
  stop2();
}

async function main() {
  testPlanIndexAtElapsedPure();
  await testStartPipelineAutoAdvanceNarratesWithoutMarkingLastDone();
  await testStartPipelineAutoAdvanceSameIdNeverAdvancesJustNarrates();
  testStartPipelineAutoAdvanceIsANoOpWithoutProgressOrPlan();
  console.log("test-prep-generation-overlay.mjs: all assertions passed");
}

main();
