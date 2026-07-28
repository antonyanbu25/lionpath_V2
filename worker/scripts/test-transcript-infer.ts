/**
 * Unit tests for Gemini transcript Pass 2 parser (no network).
 * Run: tsx scripts/test-transcript-infer.ts
 */

import assert from "node:assert/strict";
import { parseInferResponse } from "../src/video/transcript-infer.ts";

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
  },
  2400,
  true,
);

assert.equal(parsed.shareOnPct, 72);
assert.equal(parsed.cameraOnPct, 88);
assert.equal(parsed.cdeCustomized, true);
assert.equal(parsed.segments.length, 2);
assert.equal(parsed.segments[0].segmentType, "slides");

const noConsent = parseInferResponse({ cameraOnPct: 90, shareOnPct: 50 }, 600, false);
assert.equal(noConsent.cameraOnPct, null);
assert.equal(noConsent.shareOnPct, 50);

console.log("test-transcript-infer: ok");
