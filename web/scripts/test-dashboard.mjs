/** Smoke test for history storage + dashboard aggregation (no browser). */

import { savePostCallAnalysis, listPostCallAnalyses, storageKey } from "../history.js";
import { aggregateQualityMetrics } from "../dashboard.js";

const store = new Map();

globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};

const TEST_EMAIL = "test-se@freshworks.com";
const STORAGE_KEY = storageKey(TEST_EMAIL);

function sampleResult(overall, objectionsGrade) {
  return {
    scorecard: {
      callType: "demo",
      rubricVersion: "2.1",
      provisional: false,
      overall,
      confidence: 0.9,
      lines: [
        { themeKey: "call_flow", grade: overall, credit: 3, category: "communication_control", applicable: true },
        { themeKey: "customer_engagement", grade: 8, credit: 3, category: "communication_control", applicable: true },
        { themeKey: "objections", grade: objectionsGrade, credit: 2, category: "credibility_objections", applicable: true },
        { themeKey: "camera_on", grade: 7, credit: 2, category: "communication_control", applicable: true },
      ],
    },
    analysis: {
      callSummary: { headline: `Call ${overall}` },
      momentum: { status: "Advancing" },
    },
    transcriptMeta: { wordCount: 100 },
  };
}

store.delete(STORAGE_KEY);

savePostCallAnalysis(TEST_EMAIL, { recordingUrl: "https://zoom.us/rec/1" }, sampleResult(8, 7));
savePostCallAnalysis(TEST_EMAIL, { recordingUrl: "https://zoom.us/rec/2" }, sampleResult(6, 5));
savePostCallAnalysis(TEST_EMAIL, { recordingUrl: "https://zoom.us/rec/3" }, sampleResult(4, 3));

const list = listPostCallAnalyses(TEST_EMAIL);
const metrics = aggregateQualityMetrics(list);

const checks = [
  ["3 analyses saved", list.length === 3],
  ["uses QIP scorecards", metrics.usesLegacyCoach === false],
  ["avg overall present", metrics.avgOverall != null],
  ["per-type demo composite", metrics.byType?.some((t) => t.callType === "demo" && t.score != null)],
  ["theme averages", metrics.dimensions.length >= 4],
  ["best theme exists", !!metrics.bestDimension],
  ["recent calls", metrics.recentCalls.length === 3],
  ["demo avg matches stored overalls", metrics.byType?.find((t) => t.callType === "demo")?.score === 6],
  ["score bands populated", metrics.scoreBands.excellent + metrics.scoreBands.strong + metrics.scoreBands.good + metrics.scoreBands.developing + metrics.scoreBands.needsFocus === 3],
];

const failed = checks.filter(([, ok]) => !ok);

store.delete(STORAGE_KEY);

if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}

console.log("OK — dashboard aggregation smoke test passed");
