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

function sampleResult(callFlowScore, objectionsScore) {
  return {
    scorecard: {
      callType: "demo",
      rubricVersion: "1.0",
      provisional: false,
      confidence: 0.9,
      lines: [
        { themeKey: "call_flow", score: callFlowScore, maxScore: 100, applicable: true, weight: 10 },
        { themeKey: "customer_engagement", score: 80, maxScore: 100, applicable: true, weight: 10 },
        { themeKey: "objections", score: objectionsScore, maxScore: 100, applicable: true, weight: 5 },
        { themeKey: "camera_on", score: 70, maxScore: 100, applicable: true, weight: 5 },
      ],
    },
    analysis: {
      callSummary: { headline: `Call ${callFlowScore}` },
      momentum: { status: "Advancing" },
    },
    transcriptMeta: { wordCount: 100 },
  };
}

store.delete(STORAGE_KEY);

savePostCallAnalysis(TEST_EMAIL, { recordingUrl: "https://zoom.us/rec/1" }, sampleResult(80, 70));
savePostCallAnalysis(TEST_EMAIL, { recordingUrl: "https://zoom.us/rec/2" }, sampleResult(60, 50));
savePostCallAnalysis(TEST_EMAIL, { recordingUrl: "https://zoom.us/rec/3" }, sampleResult(40, 30));

const list = listPostCallAnalyses(TEST_EMAIL);
const metrics = aggregateQualityMetrics(list);

const checks = [
  ["3 analyses saved", list.length === 3],
  ["uses QIP scorecards", metrics.usesLegacyCoach === false],
  ["spine composite present", metrics.spine?.score != null],
  ["per-type demo composite", metrics.byType?.some((t) => t.callType === "demo" && t.score != null)],
  ["theme averages", metrics.dimensions.length >= 4],
  ["best theme exists", !!metrics.bestDimension],
  ["recent calls", metrics.recentCalls.length === 3],
  ["no blended avgOverall across legacy dims", metrics.avgOverall === metrics.spine?.score],
  ["score bands populated", metrics.scoreBands.excellent + metrics.scoreBands.strong + metrics.scoreBands.good + metrics.scoreBands.developing + metrics.scoreBands.needsFocus === 3],
];

const failed = checks.filter(([, ok]) => !ok);

store.delete(STORAGE_KEY);

if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}

console.log("OK — dashboard aggregation smoke test passed");
