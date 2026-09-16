#!/usr/bin/env tsx
/**
 * Regression: the "00"/"01" bogus-speaker bug reproduced specifically in Kaia-export shape
 * (as opposed to test-transcript-speaker-parse.ts's plain-paste fixture for the same bug).
 * A real Kaia export can carry a numeric device/participant index on a header line
 * ("00:00:08 00") interleaved with real named headers. matchKaiaHeader's KAIA_NAME pattern
 * structurally requires a letter-led name, so this line is never captured as a header —
 * isValidSpeakerLabel (worker/src/transcript.ts) additionally guards the same call sites in
 * case that regex is ever loosened. Asserts the fix engages: no bogus "00"/"01" speaker is
 * emitted, the call still resolves to Kaia format, and no utterance text is silently dropped.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseTranscript, parseTranscriptCues } from "../src/transcript.ts";

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(
  join(here, "../testdata/transcript-fixtures/kaia-numeric-speaker-bug-regression.txt"),
  "utf8",
);

const parsed = parseTranscript(raw);
assert.equal(parsed.format, "kaia", "still classified as Kaia format despite the bogus numeric line");
assert.ok(!parsed.speakers.includes("00"), "must not emit bogus speaker '00'");
assert.ok(!parsed.speakers.includes("01"), "must not emit bogus speaker '01'");
assert.deepEqual(
  [...parsed.speakers].sort(),
  ["Priyal Shah", "Sunil Prasad"],
  "only the two real named speakers are ever emitted",
);

// No utterance text is silently dropped — the bogus numeric line's own text folds into the
// surrounding real speaker's utterance rather than vanishing.
assert.ok(
  parsed.text.includes("Happy to be here, I'll cover the technical demo today."),
  "the utterance following the bogus '00' line survives",
);
assert.ok(
  parsed.text.includes("We should wrap by the top of the hour given the next meeting."),
  "the utterance following the bogus '01' line survives",
);

const cues = parseTranscriptCues(raw);
assert.equal(cues.length, 3, "three real cues (Priyal, Sunil, Priyal) — the bogus lines never start a new cue");
assert.ok(
  cues.every((c) => c.speaker !== "00" && c.speaker !== "01"),
  "no cue is ever attributed to a bogus numeric speaker",
);

console.log("test-kaia-numeric-speaker-regression: ok");
