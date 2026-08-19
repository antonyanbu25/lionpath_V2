#!/usr/bin/env tsx
/**
 * Meeting-room, multi-persona fixture — one shared "Meeting Room" mic label picking up two
 * distinct customer personas (Sunil Prasad, Farhan Sidek) at different time spans, plus two
 * normal named speakers (Priyal Shah, Ravi Kumar). Exercises buildEffectiveTranscriptForScoring
 * (worker/src/postcall/speaker-attribution.ts) against the confirmed-attribution shape a
 * real confirm-page submission would send, using the expected-shape fixture
 * meeting-room-multi-persona.expected.json as the source of truth for both inputs and outcome.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseTranscriptCues } from "../src/transcript.ts";
import {
  buildEffectiveTranscriptForScoring,
  type ConfirmedRoomAttribution,
} from "../src/postcall/speaker-attribution.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, "../testdata/transcript-fixtures");
const raw = readFileSync(join(FIXTURES_DIR, "meeting-room-multi-persona.vtt"), "utf8");
const expected = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "meeting-room-multi-persona.expected.json"), "utf8"),
);

// Sanity: the fixture's raw transcript really does carry one shared room label used by two
// distinct personas at non-overlapping spans (this is what makes it a "meeting room" case
// rather than an ordinary multi-speaker call).
const rawCues = parseTranscriptCues(raw);
const roomCues = rawCues.filter((c) => c.speaker === "Meeting Room");
assert.equal(roomCues.length, 3, "three spans of shared 'Meeting Room' speech in the raw transcript");
assert.equal(expected.expectedDistinctPersonaCount, 2, "fixture documents exactly two distinct personas under the shared label");

const roomAttributions = expected.confirmedRoomAttributions as ConfirmedRoomAttribution[];
assert.equal(roomAttributions.length, 1, "one confirmed attribution entry for the shared room label");
assert.equal(roomAttributions[0].spans.length, 3, "all three spans are confirmed");

const rewritten = buildEffectiveTranscriptForScoring(raw, roomAttributions);
assert.notEqual(rewritten, raw, "transcript is rewritten when confirmed room attributions are present");

for (const person of expected.expectedRosterPersons as string[]) {
  assert.ok(
    rewritten.includes(`${person} (via meeting room):`),
    `${person}'s attributed speech is rewritten with the "(via meeting room)" tag`,
  );
}

// Both of Sunil Prasad's spans (not just the first) are rewritten — grouping by person must
// not collapse or drop the second occurrence.
const sunilOccurrences = rewritten.split("Sunil Prasad (via meeting room):").length - 1;
assert.equal(sunilOccurrences, 2, "both of Sunil Prasad's spans are rewritten, not just one");

const farhanOccurrences = rewritten.split("Farhan Sidek (via meeting room):").length - 1;
assert.equal(farhanOccurrences, 1, "Farhan Sidek's single span is rewritten exactly once");

// Ordinary named speakers (never behind the shared room label) are left completely untouched.
assert.ok(rewritten.includes("Priyal Shah: Thanks everyone for joining"), "non-room speaker text is untouched");
assert.ok(rewritten.includes("Ravi Kumar: Happy to be here"), "non-room speaker text is untouched");
assert.ok(!rewritten.includes("Meeting Room:"), "no remaining unattributed 'Meeting Room:' speaker once every span is confirmed");

// Re-running with no confirmed attributions must return the transcript unchanged (never
// rewrites speculatively — only ever applies confirmed spans).
assert.equal(
  buildEffectiveTranscriptForScoring(raw, null),
  raw,
  "no confirmed attributions => transcript unchanged",
);

console.log("test-meeting-room-multi-persona: ok");
