/**
 * Web mirror of worker/scripts/test-quality-coach-cap.ts — the hero-gauge qualityCoach
 * score gets the same unevidenced-five downgrade and leadership cap as the QIP scorecard.
 */
import assert from "node:assert/strict";
import { normalizeQualityCoach, applyLeadershipCap, LEADERSHIP_CAP_THRESHOLD } from "../quality-score.js";

function dim(name, score, evidence) {
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
function buildHighScoringDimensions(evidence) {
  const names = ["Discovery", "Demo alignment", "Objections", "Value articulation", "Next-step clarity", "Talk balance"];
  const scores = [5, 5, 5, 5, 4, 4];
  return names.map((n, i) => dim(n, scores[i], evidence));
}

function testDualCapClampsWithoutVerification() {
  const qc = normalizeQualityCoach({
    dimensions: buildHighScoringDimensions("Specific, timestamped evidence cited for this dimension."),
    strengths: [],
    improvements: [],
    missedOpportunities: [],
  });
  assert.ok(qc.overallScore > LEADERSHIP_CAP_THRESHOLD, "unverified overall is above the cap");
  const capped = applyLeadershipCap(qc.overallScore, false);
  assert.deepEqual(capped, { overall: LEADERSHIP_CAP_THRESHOLD, capped: true }, "clamps to 8.0 unverified");
  console.log("testDualCapClampsWithoutVerification: ok");
}

function testVerifiedShowsTrueValue() {
  const qc = normalizeQualityCoach({
    dimensions: buildHighScoringDimensions("Specific, timestamped evidence cited for this dimension."),
    strengths: [],
    improvements: [],
    missedOpportunities: [],
  });
  const capped = applyLeadershipCap(qc.overallScore, true);
  assert.deepEqual(capped, { overall: qc.overallScore, capped: false }, "verified overall renders true value uncapped");
  console.log("testVerifiedShowsTrueValue: ok");
}

testUnevidencedFiveDowngradedToFour();
testEvidencedFiveKeptAtFive();
testDualCapClampsWithoutVerification();
testVerifiedShowsTrueValue();

console.log("test-quality-coach-cap: ok");
