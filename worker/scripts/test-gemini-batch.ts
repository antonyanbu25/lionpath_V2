#!/usr/bin/env tsx
/**
 * Unit tests for Gemini Batch provider — submit/poll/collect with mocked fetch.
 */

import assert from "node:assert/strict";
import {
  collectGenerateResults,
  parseBatchJobResponse,
  submitGenerateBatch,
  TERMINAL_BATCH_STATES,
} from "../src/providers/gemini-batch";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

async function testParseBatchJobResponse() {
  const ref = parseBatchJobResponse({
    name: "batches/abc123",
    state: "JOB_STATE_PENDING",
    displayName: "test-job",
  });
  assert.equal(ref.name, "batches/abc123");
  assert.equal(ref.state, "JOB_STATE_PENDING");
}

async function testSubmitGenerateBatch() {
  mockFetch(async (url, init) => {
    assert.match(url, /batchGenerateContent/);
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.batch.input_config.requests.requests.length, 2);
    return new Response(
      JSON.stringify({ name: "batches/job-1", state: "JOB_STATE_PENDING" }),
      { status: 200 },
    );
  });

  const ref = await submitGenerateBatch(
    { GEMINI_API_KEY: "test-key" },
    "gemini-3.1-flash-lite",
    [
      { key: "a", system: "sys", user: "u1", maxTokens: 100 },
      { key: "b", system: "sys", user: "u2", maxTokens: 100 },
    ],
    "unit-test",
  );
  assert.equal(ref.name, "batches/job-1");
  restoreFetch();
}

async function testCollectPartialFailures() {
  mockFetch(async () => {
    return new Response(
      JSON.stringify({
        name: "batches/job-1",
        state: "JOB_STATE_SUCCEEDED",
        dest: {
          inlinedResponses: [
            {
              metadata: { key: "ok-1" },
              response: {
                candidates: [{ content: { parts: [{ text: '{"label":"Good theme"}' }] } }],
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
              },
            },
            {
              metadata: { key: "err-1" },
              error: { message: "blocked" },
            },
          ],
        },
      }),
      { status: 200 },
    );
  });

  const results = await collectGenerateResults(
    { GEMINI_API_KEY: "test-key" },
    "batches/job-1",
    ["ok-1", "err-1", "missing-1"],
  );
  assert.equal(results.length, 3);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].text, '{"label":"Good theme"}');
  assert.equal(results[1].ok, false);
  assert.match(results[1].error || "", /blocked/);
  assert.equal(results[2].ok, false);
  restoreFetch();
}

async function testTerminalStates() {
  assert.ok(TERMINAL_BATCH_STATES.has("JOB_STATE_SUCCEEDED"));
  assert.ok(TERMINAL_BATCH_STATES.has("JOB_STATE_EXPIRED"));
}

async function main() {
  await testParseBatchJobResponse();
  await testSubmitGenerateBatch();
  await testCollectPartialFailures();
  await testTerminalStates();
  console.log("test-gemini-batch: ok");
}

main().catch((err) => {
  restoreFetch();
  console.error(err);
  process.exit(1);
});
