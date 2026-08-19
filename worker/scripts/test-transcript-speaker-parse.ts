/**
 * Unit tests for transcript speaker detection (no LLM, no network).
 *
 * Covers the fix for the "00" / "01" bogus-speaker bug: three separate inline
 * speaker-detection regexes in ../src/transcript.ts each used to happily capture a
 * leading timestamp/index fragment as a speaker name. All three now route through the
 * shared isValidSpeakerLabel() guard, and a new Kaia-export format branch is added
 * alongside the existing VTT/plain dispatch.
 *
 * Run: tsx scripts/test-transcript-speaker-parse.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  formatTimestampedTranscript,
  isValidSpeakerLabel,
  parseTranscript,
  parseTranscriptCues,
} from "../src/transcript.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(here, "../testdata/transcript-fixtures", name), "utf8");

function testIsValidSpeakerLabel() {
  assert.equal(isValidSpeakerLabel("Priyal Shah"), true);
  assert.equal(isValidSpeakerLabel("Ravi"), true);
  assert.equal(isValidSpeakerLabel("00"), false, "purely numeric label rejected");
  assert.equal(isValidSpeakerLabel("01"), false, "purely numeric label rejected");
  assert.equal(isValidSpeakerLabel("00:12:04"), false, "full clock fragment rejected");
  assert.equal(isValidSpeakerLabel("0:12"), false, "short clock fragment rejected");
  assert.equal(isValidSpeakerLabel("12:"), false, "digit immediately followed by colon rejected");
  assert.equal(isValidSpeakerLabel(""), false, "empty label rejected");
  assert.equal(isValidSpeakerLabel("   "), false, "whitespace-only label rejected");
  console.log("testIsValidSpeakerLabel: ok");
}

function testZoomVttRealNames() {
  const raw = fixture("zoom-vtt-real-names.vtt");
  const parsed = parseTranscript(raw);
  assert.equal(parsed.format, "vtt");
  assert.deepEqual(
    [...parsed.speakers].sort(),
    ["Priyal Shah", "Ravi Kumar", "Sunil Prasad"].sort(),
  );
  assert.ok(parsed.text.includes("Priyal Shah: Thanks everyone"));

  const cues = parseTranscriptCues(raw);
  assert.equal(cues.length, 4);
  assert.equal(cues[0].speaker, "Priyal Shah");
  assert.equal(cues[2].speaker, "Sunil Prasad");
  console.log("testZoomVttRealNames: ok");
}

function testKaiaFormatSample() {
  const raw = fixture("kaia-export-sample.txt");
  const parsed = parseTranscript(raw);
  assert.equal(parsed.format, "kaia");
  assert.deepEqual(
    [...parsed.speakers].sort(),
    ["Priyal Shah", "Ravi Kumar", "Sunil Prasad"].sort(),
  );
  assert.ok(parsed.text.includes("Ravi Kumar: Happy to be here"));

  const cues = parseTranscriptCues(raw);
  assert.equal(cues.length, 4);
  assert.equal(cues[0].speaker, "Priyal Shah");
  assert.equal(cues[0].startS, 0);
  assert.equal(cues[1].speaker, "Ravi Kumar");
  assert.equal(cues[1].startS, 8);
  assert.equal(cues[3].speaker, "Priyal Shah");

  const formatted = formatTimestampedTranscript(raw);
  assert.ok(formatted.includes("[00:08] Ravi Kumar: Happy to be here"));
  console.log("testKaiaFormatSample: ok");
}

function testPlainPasteSample() {
  const raw = fixture("plain-paste-sample.txt");
  const parsed = parseTranscript(raw);
  assert.equal(parsed.format, "plain");
  assert.deepEqual([...parsed.speakers].sort(), ["Customer", "Priyal", "Ravi"].sort());
  // Plain paste carries no clock, so cue-level parsing (used for timelines) must stay empty.
  assert.deepEqual(parseTranscriptCues(raw), []);
  console.log("testPlainPasteSample: ok");
}

function testNumericSpeakerBugRegression() {
  const raw = fixture("numeric-speaker-bug-regression.txt");
  const parsed = parseTranscript(raw);
  // The old bug: "00" / "01" got captured as bogus speaker names. Assert that no longer happens.
  assert.ok(!parsed.speakers.includes("00"), "must not emit bogus speaker '00'");
  assert.ok(!parsed.speakers.includes("01"), "must not emit bogus speaker '01'");
  assert.equal(parsed.speakers.length, 0, "no valid speaker names present in this fixture");
  // The utterance text must survive untouched (continuation text, not a dropped line).
  assert.ok(parsed.text.includes("Thanks everyone for joining"));
  assert.ok(parsed.text.includes("cover pricing and next steps"));
  console.log("testNumericSpeakerBugRegression: ok");
}

function testKaiaHeaderNameFirstVariant() {
  const raw = [
    "Priyal Shah 00:00:00",
    "Kicking off the call with a quick agenda review.",
    "",
    "Ravi Kumar 00:00:10",
    "I'll take us through the product walkthrough.",
    "",
    "Sunil Prasad 00:00:20",
    "Sounds good, looking forward to it.",
  ].join("\n");
  const parsed = parseTranscript(raw);
  assert.equal(parsed.format, "kaia");
  assert.ok(parsed.speakers.includes("Priyal Shah"));
  assert.ok(parsed.speakers.includes("Ravi Kumar"));
  console.log("testKaiaHeaderNameFirstVariant: ok");
}

testIsValidSpeakerLabel();
testZoomVttRealNames();
testKaiaFormatSample();
testPlainPasteSample();
testNumericSpeakerBugRegression();
testKaiaHeaderNameFirstVariant();

console.log("test-transcript-speaker-parse: ok");
