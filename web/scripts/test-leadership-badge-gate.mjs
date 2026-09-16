/**
 * v2.3 — regression: the verifier now runs on every call (not just ones above the leadership
 * cap), so a low/average-scoring call with nothing to challenge comes back vacuously
 * "verified" (leadershipShareable: true with no candidates to downgrade). The
 * "Leadership-shareable" badge must never render for such a call — it's only meaningful once
 * the score has actually cleared the 8.0 bar. Covers both renderQipScorecard and
 * renderQualityCoach, which each compute this gate independently.
 */
globalThis.document = { getElementById: () => null };

const { renderQipScorecard, renderQualityCoach } = await import("../postcall.js");

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
function assertContains(html, needle, msg) {
  if (!html.includes(needle)) throw new Error(`FAIL: ${msg} — expected "${needle}" in output`);
}
function assertNotContains(html, needle, msg) {
  if (html.includes(needle)) throw new Error(`FAIL: ${msg} — unexpected "${needle}" in output`);
}

const baseScorecard = {
  rubricId: "demo@1.0",
  callType: "demo",
  rubricVersion: "1.0",
  provisional: false,
  totalCredits: 20,
  includedCredits: 20,
  categoryScores: { discovery: 3, execution: 3, relationship: 3 },
  confidence: 0.6,
  lines: [],
  dealRiskFlags: [],
};

// Vacuously verified (nothing scored 2, so the verifier had nothing to challenge) on a
// low-scoring call — must not show the badge.
const htmlLowScore = renderQipScorecard(
  { ...baseScorecard, overall: 3.0, leadershipShareable: true },
  {},
  { context: "call-record" },
);
assertNotContains(htmlLowScore, "Leadership-shareable", "low-scoring vacuously-verified call must not show the badge (QIP)");

// Genuinely above the cap and confirmed — badge must show.
const htmlHighScore = renderQipScorecard(
  { ...baseScorecard, overall: 8.5, leadershipShareable: true },
  {},
  { context: "call-record" },
);
assertContains(htmlHighScore, "Leadership-shareable", "above-cap verified call shows the badge (QIP)");

// Exactly at the threshold (not strictly above) — must not show, matches applyLeadershipCap's
// own "strictly greater than" semantics.
const htmlAtThreshold = renderQipScorecard(
  { ...baseScorecard, overall: 8.0, leadershipShareable: true },
  {},
  { context: "call-record" },
);
assertNotContains(htmlAtThreshold, "Leadership-shareable", "exactly-8.0 call must not show the badge (QIP)");

// Same gate, renderQualityCoach (hero gauge) path — independent computation.
const qcLow = renderQualityCoach({
  dimensions: [
    { name: "Discovery", score: 3, maxScore: 5, feedback: "ok", evidence: "Some evidence." },
  ],
  strengths: [],
  improvements: [],
  missedOpportunities: [],
  leadershipShareable: true,
});
assertNotContains(qcLow, "Leadership-shareable", "low-scoring vacuously-verified call must not show the badge (hero gauge)");

const qcHigh = renderQualityCoach({
  dimensions: [
    { name: "Discovery", score: 5, maxScore: 5, feedback: "ok", evidence: "Specific, timestamped evidence." },
    { name: "Demo alignment", score: 5, maxScore: 5, feedback: "ok", evidence: "Specific, timestamped evidence." },
  ],
  strengths: [],
  improvements: [],
  missedOpportunities: [],
  leadershipShareable: true,
});
assertContains(qcHigh, "Leadership-shareable", "above-cap verified call shows the badge (hero gauge)");

console.log("test-leadership-badge-gate: ok");
