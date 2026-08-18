#!/usr/bin/env tsx
/**
 * Unit tests for deckPresentForScorecard (v2.2) — worker/src/postcall/scorecard.ts.
 * A bare deck LINK is never scoring evidence; only a parsed deckContent (client-extracted
 * PDF text) or Pass 2 video evidence of slides being shared/shared-screen-heavy unlocks
 * slide_deck scoring. See the function's own docstring for the rule.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deckPresentForScorecard } from "../src/postcall/scorecard.ts";
import type { VideoFactsDraft } from "../src/domain-model/video-facts.ts";
import type { PostCallDeckContent } from "../src/postcall/types.ts";

const here = dirname(fileURLToPath(import.meta.url));

function videoFacts(overrides: Partial<VideoFactsDraft> = {}): VideoFactsDraft {
  return {
    status: "ready",
    cameraOnPct: null,
    keyframeRefs: [],
    sampleIntervalS: 10,
    retentionExpiresAt: Date.now() + 1000,
    segments: [],
    ...overrides,
  };
}

function deckContent(slidesText: string[]): PostCallDeckContent {
  return {
    fileName: "deck.pdf",
    pageCount: slidesText.length,
    slides: slidesText.map((text, i) => ({ page: i + 1, text })),
  };
}

// A deckLink alone (no deckContent, no video facts) is never evidence — deckPresentForScorecard
// doesn't even take deckLink as a parameter, so passing null/undefined deckContent + no video
// facts must be false regardless of any link the caller may be tracking elsewhere.
assert.equal(
  deckPresentForScorecard(null, null),
  false,
  "no deckContent and no video facts => not present (a bare link never counts)",
);
assert.equal(
  deckPresentForScorecard(undefined, undefined),
  false,
  "undefined inputs => not present",
);

// deckContent with real slide text is present regardless of video facts state.
assert.equal(
  deckPresentForScorecard(deckContent(["Agenda", "Pricing"]), null),
  true,
  "deckContent with non-blank slide text => present even with no video facts",
);

// deckContent whose slides are all blank/whitespace does not count as real content.
assert.equal(
  deckPresentForScorecard(deckContent(["   ", "\n\t"]), null),
  false,
  "deckContent with only whitespace slide text => not present",
);
assert.equal(
  deckPresentForScorecard({ fileName: "empty.pdf", pageCount: 0, slides: [] }, null),
  false,
  "deckContent with zero slides => not present",
);

// No deckContent, but Pass 2 video facts are ready and detected a slides segment.
assert.equal(
  deckPresentForScorecard(
    null,
    videoFacts({ segments: [{ startS: 0, endS: 30, segmentType: "slides", label: "deck" }] }),
  ),
  true,
  "video facts ready + a slides segment => present even without deckContent",
);

// No deckContent, video facts ready, no slides segment, but high screen-share pct.
assert.equal(
  deckPresentForScorecard(null, videoFacts({ shareOnPct: 40 })),
  true,
  "video facts ready + shareOnPct >= 25 => present",
);
assert.equal(
  deckPresentForScorecard(null, videoFacts({ shareOnPct: 25 })),
  true,
  "shareOnPct exactly at the 25 boundary => present",
);
assert.equal(
  deckPresentForScorecard(null, videoFacts({ shareOnPct: 24.9 })),
  false,
  "shareOnPct just under the 25 boundary => not present",
);
assert.equal(
  deckPresentForScorecard(null, videoFacts({ shareOnPct: null })),
  false,
  "video facts ready but no slides segment and no shareOnPct => not present",
);

// Video facts not ready (still processing / failed) never counts, even with a high shareOnPct.
assert.equal(
  deckPresentForScorecard(null, videoFacts({ status: "pending", shareOnPct: 90 })),
  false,
  "video facts not status=ready => never present, regardless of shareOnPct",
);

// The real sample deckContent fixture (fileName/pageCount/slides shape) unlocks scoring too —
// not just hand-built minimal objects above.
type SampleDeckJson = { fileName: string; pageCount: number; slides: { page: number; text: string }[] };
const sampleDeckRaw = JSON.parse(
  readFileSync(join(here, "../testdata/deck-content-sample.json"), "utf8"),
) as SampleDeckJson;
const sampleDeck: PostCallDeckContent = {
  fileName: sampleDeckRaw.fileName,
  pageCount: sampleDeckRaw.pageCount,
  slides: sampleDeckRaw.slides,
};
assert.equal(sampleDeck.slides.length, sampleDeck.pageCount, "sample fixture's slide count matches its declared pageCount");
assert.equal(
  deckPresentForScorecard(sampleDeck, null),
  true,
  "the sample deckContent fixture unlocks slide_deck scoring on its own",
);

console.log("test-deck-present-for-scorecard: ok");
