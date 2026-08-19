#!/usr/bin/env tsx
/**
 * Unit tests for worker/src/postcall/linkedin-identity.ts (v2.3, Agent 3).
 * Deterministic parsing + name-similarity matching only — no network. The LLM fallback path
 * is exercised separately with a mocked fetch.
 */
import assert from "node:assert/strict";
import {
  extractLinkedInIdentity,
  matchLinkedInIdentityToCandidates,
} from "../src/postcall/linkedin-identity.ts";

const originalFetch = globalThis.fetch;
function assertNoNetworkCall() {
  globalThis.fetch = (async () => {
    throw new Error("must not call the network for a deterministically-parseable export");
  }) as typeof fetch;
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

const env = { GEMINI_API_KEY: "test-key" };

async function testDeterministicAtPattern() {
  assertNoNetworkCall();
  const text = [
    "Contact",
    "Priyal Shah",
    "VP of Customer Success at Acme Corp",
    "San Francisco Bay Area",
    "500+ connections",
  ].join("\n");
  const identity = await extractLinkedInIdentity(env, text);
  restoreFetch();
  assert.ok(identity);
  assert.equal(identity!.name, "Priyal Shah");
  assert.equal(identity!.title, "VP of Customer Success");
  assert.equal(identity!.company, "Acme Corp");
  assert.equal(identity!.seniorityHint, "management", "VP maps to management seniority");
  console.log("testDeterministicAtPattern: ok");
}

async function testDeterministicPipePattern() {
  assertNoNetworkCall();
  const text = ["Ravi Kumar", "Chief Technology Officer | Acme Corp"].join("\n");
  const identity = await extractLinkedInIdentity(env, text);
  restoreFetch();
  assert.ok(identity);
  assert.equal(identity!.name, "Ravi Kumar");
  assert.equal(identity!.title, "Chief Technology Officer");
  assert.equal(identity!.company, "Acme Corp");
  assert.equal(identity!.seniorityHint, "executive", "CTO/Chief maps to executive seniority");
  console.log("testDeterministicPipePattern: ok");
}

async function testGeneralManagerSeniority() {
  assertNoNetworkCall();
  const text = ["Sunil Prasad", "General Manager at Acme Corp"].join("\n");
  const identity = await extractLinkedInIdentity(env, text);
  restoreFetch();
  assert.equal(identity!.seniorityHint, "general_manager");
  console.log("testGeneralManagerSeniority: ok");
}

async function testNameOnlyNoHeadline() {
  assertNoNetworkCall();
  const identity = await extractLinkedInIdentity(env, "Just A Name");
  restoreFetch();
  assert.ok(identity);
  assert.equal(identity!.name, "Just A Name");
  assert.equal(identity!.title, undefined);
  console.log("testNameOnlyNoHeadline: ok");
}

async function testEmptyTextReturnsNull() {
  assertNoNetworkCall();
  const identity = await extractLinkedInIdentity(env, "   ");
  restoreFetch();
  assert.equal(identity, null);
  console.log("testEmptyTextReturnsNull: ok");
}

async function testAmbiguousLayoutFallsBackToLlm() {
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ name: "Harshveer Singh", title: "Head of IT", company: "Euphotic" }) }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 10 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  // Headline present but doesn't split into "X at Y" / "X | Y" — ambiguous.
  const text = ["Harshveer Singh", "Building great products, one release at a time"].join("\n");
  const identity = await extractLinkedInIdentity(env, text);
  restoreFetch();

  assert.ok(fetchCalled, "ambiguous layout falls back to the LLM pass");
  assert.equal(identity!.name, "Harshveer Singh");
  assert.equal(identity!.title, "Head of IT");
  assert.equal(identity!.seniorityHint, "management", "Head of X maps to management seniority");
  console.log("testAmbiguousLayoutFallsBackToLlm: ok");
}

function testMatchExact() {
  const match = matchLinkedInIdentityToCandidates(
    { name: "Priyal Shah" },
    ["Ravi Kumar", "Priyal Shah", "Sunil Prasad"],
  );
  assert.equal(match?.matchedLabel, "Priyal Shah");
  assert.equal(match?.confidence, 1);
  console.log("testMatchExact: ok");
}

function testMatchAgainstTitledSpeakerLabel() {
  const match = matchLinkedInIdentityToCandidates(
    { name: "Priyal Shah" },
    ["Priyal Shah | SE @Freshworks", "Ravi Kumar"],
  );
  assert.equal(match?.matchedLabel, "Priyal Shah | SE @Freshworks");
  console.log("testMatchAgainstTitledSpeakerLabel: ok");
}

function testNoMatchBelowConfidenceFloor() {
  const match = matchLinkedInIdentityToCandidates({ name: "Priyal Shah" }, ["Sunil Prasad", "Ravi Kumar"]);
  assert.equal(match, null);
  console.log("testNoMatchBelowConfidenceFloor: ok");
}

async function main() {
  await testDeterministicAtPattern();
  await testDeterministicPipePattern();
  await testGeneralManagerSeniority();
  await testNameOnlyNoHeadline();
  await testEmptyTextReturnsNull();
  await testAmbiguousLayoutFallsBackToLlm();
  testMatchExact();
  testMatchAgainstTitledSpeakerLabel();
  testNoMatchBelowConfidenceFloor();
  console.log("test-linkedin-identity: ok");
}

main().catch((err) => {
  restoreFetch();
  console.error(err);
  process.exit(1);
});
