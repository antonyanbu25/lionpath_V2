/**
 * Unit tests for Gemini transcript Pass 2 parser (no network).
 * Run: tsx scripts/test-transcript-infer.ts
 */

import assert from "node:assert/strict";
import { parseInferResponse, selectTranscriptForVideoInfer } from "../src/video/transcript-infer.ts";

const parsed = parseInferResponse(
  {
    shareOnPct: 72,
    cameraOnPct: 88,
    cdeCustomized: true,
    cdeEvidence: "Tenant branded Acme Corp",
    segments: [
      { startS: 0, endS: 300, segmentType: "slides", label: "Intro deck" },
      { startS: 300, endS: 1800, segmentType: "product", label: "Freshdesk demo" },
    ],
    participants: [
      { name: "Pavithra Velkannan", talkPct: 71, cameraOn: true, role: "se" },
      { name: "Sunil Prasad", talkPct: 24, cameraOn: true, role: "customer" },
    ],
  },
  2400,
  true,
);

assert.equal(parsed.shareOnPct, 72);
assert.equal(parsed.cameraOnPct, 88);
assert.equal(parsed.cdeCustomized, true);
assert.equal(parsed.segments.length, 2);
assert.equal(parsed.segments[0].segmentType, "slides");
assert.equal(parsed.participants.length, 2);
assert.equal(parsed.participants[1].cameraOn, true);

const noConsent = parseInferResponse(
  {
    cameraOnPct: 90,
    shareOnPct: 50,
    participants: [{ name: "Alex", talkPct: 40, cameraOn: true, role: "customer" }],
  },
  600,
  false,
);
assert.equal(noConsent.cameraOnPct, null);
assert.equal(noConsent.shareOnPct, 50);
assert.equal(noConsent.participants[0].cameraOn, true);

function testSelectTranscriptWindow() {
  const short = "Hello world transcript.";
  assert.equal(selectTranscriptForVideoInfer(short, 600), short);

  const vtt = [
    "WEBVTT",
    "",
    "00:00:00.000 --> 00:00:05.000",
    "SE: Opening slides here.",
    "",
    "00:15:00.000 --> 00:15:05.000",
    "SE: Mid demo product UI.",
    "",
    "00:44:00.000 --> 00:44:05.000",
    "SE: Closing recap.",
  ].join("\n");
  const windowed = selectTranscriptForVideoInfer(vtt, 2700, 5000);
  assert.ok(windowed.includes("Opening slides"), "opening window kept");
  assert.ok(windowed.includes("Mid demo"), "mid window kept");
  assert.ok(windowed.includes("Closing recap"), "closing window kept");
  assert.ok(windowed.length <= 5000, "char cap honored");

  const longPlain = "word ".repeat(20_000);
  const plainWindowed = selectTranscriptForVideoInfer(longPlain, null, 1000);
  assert.ok(plainWindowed.length <= 1000);
  assert.ok(plainWindowed.includes("Transcript sampled"));
}

testSelectTranscriptWindow();

console.log("test-transcript-infer: ok");
