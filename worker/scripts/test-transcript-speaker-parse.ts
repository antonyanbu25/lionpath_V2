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
    "",
    "Priyal Shah 00:00:30",
    "Great, let's move to pricing next.",
  ].join("\n");
  const parsed = parseTranscript(raw);
  assert.equal(parsed.format, "kaia");
  assert.ok(parsed.speakers.includes("Priyal Shah"));
  assert.ok(parsed.speakers.includes("Ravi Kumar"));
  assert.ok(parsed.speakers.includes("Sunil Prasad"));
  console.log("testKaiaHeaderNameFirstVariant: ok");
}

// B2 regression — a plain paste where two unrelated sentences happen to end in a
// clock-like token used to be misdetected as Kaia's name-first header form, deleting the
// times and gluing unrelated lines together as speech. Must parse as plain, verbatim.
function testKaiaFalsePositiveOnProseWithClockLikeEndings() {
  const raw = [
    "Let's regroup and follow up at 3:15",
    "We covered pricing on the call.",
    "",
    "I will send the recap by 4:30",
    "Thanks for joining everyone.",
  ].join("\n");
  const parsed = parseTranscript(raw);
  assert.equal(parsed.format, "plain");
  assert.equal(parsed.speakers.length, 0);
  assert.ok(parsed.text.includes("Let's regroup and follow up at 3:15"));
  assert.ok(parsed.text.includes("I will send the recap by 4:30"));
  console.log("testKaiaFalsePositiveOnProseWithClockLikeEndings: ok");
}

// Documented accepted loss: when every candidate speaker label appears only once, the
// recurrence bar added for the B2 fix means the file is not detected as Kaia format, even
// though it is a legitimate (if unusually short) single-turn-per-speaker export.
function testKaiaSingleOccurrenceLabelsAreAcceptedLoss() {
  const raw = [
    "00:00:00 Priyal Shah",
    "Quick round of intros before we start.",
    "",
    "00:00:10 Ravi Kumar",
    "Happy to be here.",
  ].join("\n");
  const parsed = parseTranscript(raw);
  assert.notEqual(parsed.format, "kaia", "single-occurrence labels deliberately do not trigger Kaia detection");
  console.log("testKaiaSingleOccurrenceLabelsAreAcceptedLoss: ok");
}

testIsValidSpeakerLabel();
testZoomVttRealNames();
testKaiaFormatSample();
testPlainPasteSample();
testNumericSpeakerBugRegression();
testKaiaHeaderNameFirstVariant();
testKaiaFalsePositiveOnProseWithClockLikeEndings();
testKaiaSingleOccurrenceLabelsAreAcceptedLoss();

console.log("test-transcript-speaker-parse: ok");
