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

testUnevidencedFiveDowngradedToFour();
testEvidencedFiveKeptAtFive();
testDualCapClampsWithoutVerification();
testVerifiedShowsTrueValue();

console.log("test-quality-coach-cap: ok");
