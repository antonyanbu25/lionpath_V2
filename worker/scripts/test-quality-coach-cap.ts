#!/usr/bin/env tsx
/**
 * v2.3 — the hero-gauge qualityCoach score must be disciplined the same way the QIP scorecard
 * already is: an unevidenced top dimension score is deterministically downgraded, and the
 * aggregate is subject to the same leadership cap. Mirrors web/scripts/test-quality-coach-cap.mjs
 * so worker/src/quality-score.ts and web/quality-score.js stay behaviourally identical (B1).
 */
import assert from "node:assert/strict";
import {
  normalizeQualityCoach,
  applyLeadershipCap,
  LEADERSHIP_CAP_THRESHOLD,
} from "../src/quality-score.ts";
import { normalizeQualityCoach as normalizeQualityCoachWeb } from "../../web/quality-score.js";

function dim(name: string, score: number, evidence: string) {
  return { name, score, maxScore: 5, feedback: "ok", evidence };
}

function testUnevidencedFiveDowngradedToFour() {
  const qc = normalizeQualityCoach({
    dimensions: [dim("Discovery", 5, ""), dim("Demo alignment", 3, "Solid walkthrough of CDE.")],
    strengths: [],
    improvements: [],
    missedOpportunities: [],
  });
  assert.equal(qc.dimensions[0].score, 4, "unevidenced 5 downgraded to 4");
  assert.equal(qc.dimensions[1].score, 3, "evidenced non-5 dimension untouched");
  console.log("testUnevidencedFiveDowngradedToFour: ok");
}

function testEvidencedFiveKeptAtFive() {
  const qc = normalizeQualityCoach({
    dimensions: [dim("Discovery", 5, "Asked about their current ticket volume at 00:04:12.")],
    strengths: [],
    improvements: [],
    missedOpportunities: [],
  });
  assert.equal(qc.dimensions[0].score, 5, "evidenced 5 is not downgraded");
  console.log("testEvidencedFiveKeptAtFive: ok");
}

/** Six dimensions averaging 4.666/5 -> overallScore ~9.33, well above the 8.0 cap. */
function buildHighScoringDimensions(evidence: string) {
  const names = ["Discovery", "Demo alignment", "Objections", "Value articulation", "Next-step clarity", "Talk balance"];
  const scores = [5, 5, 5, 5, 4, 4];
  return names.map((n, i) => dim(n, scores[i], evidence));
}

function testDualCapClampsWithoutVerification() {
  const qcWorker = normalizeQualityCoach({
    dimensions: buildHighScoringDimensions("Specific, timestamped evidence cited for this dimension."),
    strengths: [],
    improvements: [],
    missedOpportunities: [],
  });
  const qcWeb = normalizeQualityCoachWeb({
    dimensions: buildHighScoringDimensions("Specific, timestamped evidence cited for this dimension."),
    strengths: [],
    improvements: [],
    missedOpportunities: [],
  });
  assert.ok(qcWorker.overallScore > LEADERSHIP_CAP_THRESHOLD, "unverified overall is above the cap");
  assert.equal(qcWorker.overallScore, qcWeb.overallScore, "worker/web overallScore parity");

  const workerCap = applyLeadershipCap(qcWorker.overallScore, false);
  const webCap = applyLeadershipCap(qcWeb.overallScore, false);
  assert.deepEqual(workerCap, { overall: LEADERSHIP_CAP_THRESHOLD, capped: true }, "clamps to 8.0 unverified");
  assert.deepEqual(workerCap, webCap, "worker/web capped result parity");
  console.log("testDualCapClampsWithoutVerification: ok");
}

function testVerifiedShowsTrueValue() {
  const qc = normalizeQualityCoach({
    dimensions: buildHighScoringDimensions("Specific, timestamped evidence cited for this dimension."),
    strengths: [],
    improvements: [],
    missedOpportunities: [],
  });
  const cap = applyLeadershipCap(qc.overallScore, true);
  assert.deepEqual(cap, { overall: qc.overallScore, capped: false }, "verified overall renders true value uncapped");
  console.log("testVerifiedShowsTrueValue: ok");
}

/**
 * An OUT-OF-RANGE score must not bypass the unevidenced-five downgrade.
 *
 * downgradeUnevidencedFives tests `d.score === 5`, an exact match. So before
 * clampDimensionScore was added, an unevidenced score of 99 sailed straight
 * past the very check meant to stop an unevidenced top mark: it is not equal
 * to 5, so no downgrade, and nothing else clamped it either — the 1-5 bound
 * was declared only in POSTCALL_SCHEMA, and two post-call paths drop the
 * schema (`gaps`' jsonMimeOnly fallback, `commit`'s continuation).
 *
 * The fix clamps BEFORE downgrading, so 99 -> 5 -> 4. Clamping afterwards
 * would leave the bypass intact, which is why the order is asserted here and
 * not just the final number.
 */
function testOutOfRangeScoreCannotBypassTheDowngrade() {
  const qc = normalizeQualityCoach({
    overallScore: 0,
    overallLabel: "",
    dimensions: [dim("Discovery", 99, ""), dim("Qualification", 99, "has evidence")],
    strengths: [],
    improvements: [],
    missedOpportunities: [],
  });
  assert.equal(
    qc.dimensions[0].score,
    4,
    "unevidenced out-of-range score must clamp to 5 and THEN downgrade to 4",
  );
  assert.equal(
    qc.dimensions[1].score,
    5,
    "evidenced out-of-range score clamps to 5 and is not downgraded",
  );
  assert.ok(
    qc.dimensions.every((d) => d.score <= d.maxScore),
    "no dimension may report a score above its own maxScore",
  );
  console.log("testOutOfRangeScoreCannotBypassTheDowngrade: ok");
}

/** A non-numeric or non-finite score falls back to the neutral 3, not NaN. */
function testNonNumericScoreFallsBackToNeutral() {
  const qc = normalizeQualityCoach({
    overallScore: 0,
    overallLabel: "",
    dimensions: [
      { name: "A", score: Number.NaN, maxScore: 5, feedback: "ok", evidence: "e" },
      { name: "B", score: "5" as unknown as number, maxScore: 5, feedback: "ok", evidence: "e" },
    ],
    strengths: [],
    improvements: [],
    missedOpportunities: [],
  });
  assert.equal(qc.dimensions[0].score, 3, "NaN falls back to the neutral 3");
  assert.equal(qc.dimensions[1].score, 3, "a string score falls back to the neutral 3");
  assert.ok(
    Number.isFinite(qc.overallScore),
    `overallScore must stay finite, got ${qc.overallScore}`,
  );
  console.log("testNonNumericScoreFallsBackToNeutral: ok");
}

testUnevidencedFiveDowngradedToFour();
testOutOfRangeScoreCannotBypassTheDowngrade();
testNonNumericScoreFallsBackToNeutral();
testEvidencedFiveKeptAtFive();
testDualCapClampsWithoutVerification();
testVerifiedShowsTrueValue();

console.log("test-quality-coach-cap: ok");
