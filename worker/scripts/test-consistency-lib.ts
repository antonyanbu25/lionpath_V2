/**
 * Unit tests for self-consistency stats (no LLM).
 */
import {
  aggregateThemeMetrics,
  analyzeCallRuns,
  analyzeCallThemeRuns,
  applicabilityFlipRate,
  evidenceStabilityForRuns,
  primaryEvidenceSignature,
  stddev,
  themeScoreVerdict,
  compositeVerdict,
  type RunSnapshot,
} from "../src/consistency-lib.ts";

const runs: RunSnapshot[] = [
  {
    callId: "c1",
    callType: "demo",
    runIndex: 0,
    compositeScore: 80,
    applicableWeight: 80,
    lines: [
      { themeKey: "value", score: 70, applicable: true, weight: 10, evidence: [{ atS: 120, quote: "ROI in six months" }] },
      { themeKey: "questions", score: 80, applicable: true, weight: 5, evidence: [{ atS: 60, quote: "What does success look like" }] },
    ],
  },
  {
    callId: "c1",
    callType: "demo",
    runIndex: 1,
    compositeScore: 85,
    applicableWeight: 80,
    lines: [
      { themeKey: "value", score: 78, applicable: true, weight: 10, evidence: [{ atS: 125, quote: "ROI in six months" }] },
      { themeKey: "questions", score: 82, applicable: true, weight: 5, evidence: [{ atS: 65, quote: "What does success look like for you" }] },
    ],
  },
  {
    callId: "c1",
    callType: "demo",
    runIndex: 2,
    compositeScore: 72,
    applicableWeight: 75,
    lines: [
      { themeKey: "value", score: 90, applicable: true, weight: 10, evidence: [{ atS: 500, quote: "Different moment entirely" }] },
      { themeKey: "questions", score: 50, applicable: false, weight: 5, evidence: [] },
    ],
  },
];

const checks: [string, boolean][] = [
  ["stddev basic", Math.abs(stddev([70, 78, 90]) - 10.06) < 0.1],
  ["flip rate half disagree", applicabilityFlipRate([true, true, false]) === 1 / 3],
  ["evidence signature buckets atS", primaryEvidenceSignature({
    themeKey: "x", score: 1, applicable: true, weight: 1,
    evidence: [{ atS: 125, quote: "Hello world" }],
  }).startsWith("4:")],
  ["value SD computed", analyzeCallThemeRuns(runs, "c1", "value")!.scoreSd > 0],
  ["questions flip detected", analyzeCallThemeRuns(runs, "c1", "questions")!.applicabilityFlipRate > 0],
  ["call composite SD", analyzeCallRuns(runs, "c1")!.compositeSd > 0],
  ["aggregate ranks themes", aggregateThemeMetrics(runs, ["c1"]).length === 2],
  ["instability sort descending", aggregateThemeMetrics(runs, ["c1"])[0].instabilityScore >= aggregateThemeMetrics(runs, ["c1"])[1].instabilityScore],
  ["verdict insufficient with 3 runs", themeScoreVerdict(5, 2) === "insufficient_data"],
  ["verdict acceptable with enough runs", themeScoreVerdict(5, 3) === "acceptable"],
  ["composite insufficient with 2 runs", compositeVerdict(2, 2) === "insufficient_data"],
];

const stableLines = [
  { themeKey: "a", score: 80, applicable: true, weight: 5, evidence: [{ atS: 100, quote: "same quote" }] },
  { themeKey: "a", score: 82, applicable: true, weight: 5, evidence: [{ atS: 105, quote: "same quote here" }] },
];
checks.push(["evidence stability high", (evidenceStabilityForRuns(stableLines) ?? 0) >= 0.5]);

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}
console.log("OK — consistency-lib tests passed");
