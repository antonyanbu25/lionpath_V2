#!/usr/bin/env tsx
/**
 * Unit tests for the v2.2 speaker-attribution pass — worker/src/postcall/speaker-attribution.ts.
 * Mocks the Gemini fetch call (same pattern as test-gemini-batch.ts / test-scorecard-verify.ts)
 * to exercise runPostCallSpeakerAttribution()'s real schema-parsing/normalization path
 * (normalizeRoster/normalizeRoomSegments are not exported, so this is the only way to reach
 * them) without a live API key or network call, plus the pure, always-safe
 * buildEffectiveTranscriptForScoring() rewrite used by generate.ts for scorecard scoring.
 */
import assert from "node:assert/strict";
import {
  runPostCallSpeakerAttribution,
  emptySpeakerAttribution,
  buildEffectiveTranscriptForScoring,
  SPEAKER_ATTRIBUTION_ROLE_OPTIONS,
  type ConfirmedRoomAttribution,
} from "../src/postcall/speaker-attribution.ts";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VTT_FIXTURE = readFileSync(
  join(HERE, "..", "testdata", "transcript-fixtures", "zoom-vtt-real-names.vtt"),
  "utf8",
);

const originalFetch = globalThis.fetch;
function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}
function geminiTextResponse(json: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 40 },
    }),
    { status: 200 },
  );
}

const env = { GEMINI_API_KEY: "test-key" };

async function testEmptyTranscriptSkipsLlm() {
  let called = false;
  mockFetch(async () => {
    called = true;
    throw new Error("must not call the LLM for a blank transcript");
  });
  const result = await runPostCallSpeakerAttribution(env, { transcript: "   " });
  restoreFetch();
  assert.equal(called, false, "no fetch for a blank/whitespace-only transcript");
  assert.deepEqual(result, emptySpeakerAttribution());
}

async function testNormalizesRosterAndClampsConfidence() {
  mockFetch(async (url, init) => {
    assert.match(url, /generateContent/);
    const body = JSON.parse(String(init?.body));
    assert.ok(body.contents?.[0]?.parts?.[0]?.text, "request carries the user prompt");
    return geminiTextResponse({
      roster: [
        {
          label: "Meeting Room",
          canonicalName: "Sunil Prasad",
          suggestedRole: "Meeting room",
          confidence: 1.4, // out of range — must clamp to 1
          evidence: "Self-introduces mid-call.",
        },
        {
          label: "Speaker 2",
          canonicalName: "",
          suggestedRole: "Made-up role that is not in the enum",
          confidence: -0.5, // out of range — must clamp to 0
          evidence: "",
        },
        {
          // Missing label entirely — must be dropped.
          canonicalName: "Nobody",
          suggestedRole: "Customer",
          confidence: 0.5,
          evidence: "n/a",
        },
      ],
      roomSegments: [],
    });
  });

  const result = await runPostCallSpeakerAttribution(env, {
    transcript: VTT_FIXTURE,
    participants: ["Priyal Shah", "Ravi Kumar"],
  });
  restoreFetch();

  assert.equal(result.roster.length, 2, "the entry with no label is dropped");

  const meetingRoom = result.roster.find((r) => r.label === "Meeting Room")!;
  assert.ok(meetingRoom, "Meeting Room entry survives normalization");
  assert.equal(meetingRoom.confidence, 1, "confidence > 1 clamps to 1");
  assert.equal(meetingRoom.suggestedRole, "Meeting room", "valid role passes through unchanged");
  assert.ok(
    (SPEAKER_ATTRIBUTION_ROLE_OPTIONS as readonly string[]).includes(meetingRoom.suggestedRole),
    "normalized role is always one of the allowed options",
  );

  const speaker2 = result.roster.find((r) => r.label === "Speaker 2")!;
  assert.ok(speaker2, "Speaker 2 entry survives (canonicalName falls back to label)");
  assert.equal(speaker2.canonicalName, "Speaker 2", "blank canonicalName falls back to the raw label");
  assert.equal(speaker2.confidence, 0, "confidence < 0 clamps to 0");
  assert.equal(
    speaker2.suggestedRole,
    "Customer",
    "a role not in the enum falls back to the safe default (Customer)",
  );
}

async function testNormalizesAndSortsRoomSegments() {
  mockFetch(async () =>
    geminiTextResponse({
      roster: [],
      roomSegments: [
        {
          label: "Meeting Room",
          startS: 200,
          endS: 60, // endS before startS — must clamp so endS >= startS
          attributedTo: "Sunil Prasad",
          confidence: 0.9,
          quote: "Later segment.",
          reason: "Introduces self later in the call.",
        },
        {
          label: "Meeting Room",
          startS: 10,
          endS: 20,
          attributedTo: "Sunil Prasad",
          confidence: 0.6,
          quote: "Earlier segment.",
          reason: "First voice heard under the shared mic.",
        },
        {
          // Missing attributedTo — must be dropped.
          label: "Meeting Room",
          startS: 30,
          endS: 40,
          confidence: 0.5,
          quote: "Unattributable.",
          reason: "n/a",
        },
      ],
    }),
  );

  const result = await runPostCallSpeakerAttribution(env, { transcript: VTT_FIXTURE });
  restoreFetch();

  assert.equal(result.roomSegments.length, 2, "the segment missing attributedTo is dropped");
  assert.equal(result.roomSegments[0].startS, 10, "segments are sorted ascending by startS");
  assert.equal(result.roomSegments[1].startS, 200);
  const clamped = result.roomSegments[1];
  assert.equal(clamped.endS, 200, "endS before startS clamps up to startS, never negative duration");
}

// --- buildEffectiveTranscriptForScoring — pure, deterministic, used for scorecard scoring only ---

function testEffectiveTranscriptRewrite() {
  const attributions: ConfirmedRoomAttribution[] = [
    {
      roomLabel: "Meeting Room",
      spans: [{ startS: 10, endS: 25, person: "Sunil Prasad", role: "Customer" }],
    },
  ];
  const raw = [
    "00:00:05.000 --> 00:00:09.000",
    "Meeting Room: Outside the confirmed span.",
    "",
    "00:00:12.000 --> 00:00:18.000",
    "Meeting Room: Inside the confirmed span.",
  ].join("\n");

  const rewritten = buildEffectiveTranscriptForScoring(raw, attributions);
  assert.ok(rewritten.includes("Sunil Prasad (via meeting room):"), "in-span cue is rewritten to the confirmed person");
  assert.ok(rewritten.includes("Meeting Room: Outside"), "out-of-span cue keeps the original room label");

  assert.equal(
    buildEffectiveTranscriptForScoring(raw, null),
    raw,
    "no room attributions => transcript returned completely unchanged (identity, not just equal text)",
  );
  assert.equal(
    buildEffectiveTranscriptForScoring("", attributions),
    "",
    "empty transcript never throws and is returned as-is",
  );
  assert.equal(
    buildEffectiveTranscriptForScoring("plain text with no timestamps at all", attributions),
    "plain text with no timestamps at all",
    "no parseable cues => returned unchanged rather than reformatted",
  );
}

async function main() {
  await testEmptyTranscriptSkipsLlm();
  await testNormalizesRosterAndClampsConfidence();
  await testNormalizesAndSortsRoomSegments();
  testEffectiveTranscriptRewrite();
  console.log("test-speaker-attribution-schema: ok");
}

main().catch((err) => {
  restoreFetch();
  console.error(err);
  process.exit(1);
});
