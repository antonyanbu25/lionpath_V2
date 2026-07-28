/** Smoke test coaching metrics + render (no browser). */

import { savePostCallAnalysis, listPostCallAnalyses, storageKey } from "../history.js";
import { aggregateQualityMetrics, renderCoachingCharts } from "../dashboard.js";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};

const TEST_EMAIL = "coaching-se@freshworks.com";
const STORAGE_KEY = storageKey(TEST_EMAIL);

function sampleResult(callType, callFlowScore, ctaScore, quote, provisional = false) {
  return {
    scorecard: {
      callType,
      rubricVersion: "1.0",
      provisional,
      confidence: 0.9,
      lines: [
        { themeKey: "call_flow", score: callFlowScore, maxScore: 100, applicable: true, weight: 10, evidence: [{ quote: "Walked through agenda first.", atS: 120 }] },
        { themeKey: "customer_engagement", score: 80, maxScore: 100, applicable: true, weight: 10 },
        { themeKey: "objections", score: 70, maxScore: 100, applicable: true, weight: 5 },
        { themeKey: "camera_on", score: 70, maxScore: 100, applicable: true, weight: 5 },
        { themeKey: "cta", score: ctaScore, maxScore: 100, applicable: true, weight: 5, evidence: [{ quote, atS: 2808 }] },
      ],
    },
    analysis: {
      callSummary: { headline: `Acme · ${callType}` },
      momentum: { status: "Stalled" },
    },
    transcriptMeta: { wordCount: 100 },
  };
}

store.delete(STORAGE_KEY);

savePostCallAnalysis(TEST_EMAIL, { recordingUrl: "https://zoom.us/rec/demo-1" }, sampleResult("demo", 82, 46, "Let us know if you have questions."));
savePostCallAnalysis(TEST_EMAIL, { recordingUrl: "https://zoom.us/rec/demo-2" }, sampleResult("demo", 78, 52, "We will follow up soon."));
savePostCallAnalysis(TEST_EMAIL, { recordingUrl: "https://zoom.us/rec/disc-1" }, sampleResult("discovery", 71, 58, "No owner committed by a date."));
savePostCallAnalysis(
  TEST_EMAIL,
  { recordingUrl: "https://zoom.us/rec/trial-1" },
  sampleResult("trial_setup", 60, 40, "Shadow profile call.", true),
);

const list = listPostCallAnalyses(TEST_EMAIL);
const metrics = aggregateQualityMetrics(list);
const html = renderCoachingCharts(metrics);

const checks = [
  ["per-type demo average", metrics.byType?.some((t) => t.callType === "demo" && t.score != null && t.callCount === 2)],
  ["per-type discovery average", metrics.byType?.some((t) => t.callType === "discovery" && t.score != null)],
  ["provisional excluded from averages", metrics.totalCalls === 3],
  ["provisional still in scored calls table", metrics.scoredCalls?.length === 4],
  ["provisional excluded count", metrics.provisionalExcluded === 1],
  ["spine composite present", metrics.spine?.score != null],
  ["trend by type points", metrics.trendByType?.points?.length === 3],
  ["weakest receipts collected", metrics.weakestReceipts?.length >= 1],
  ["receipt has quote", !!metrics.weakestReceipts?.[0]?.quote],
  ["html per-type demo score", html.includes("Demo average") && html.includes(">73<")],
  ["html shared themes in note", html.includes("Shared themes (core four)")],
  ["html not your overall grade", html.includes("not your overall grade")],
  ["html no radar", !html.includes("qc-radar")],
  ["html theme bars", html.includes("coaching-theme-rows")],
  ["html receipts section", html.includes("coaching-receipt-list")],
  ["html dispute buttons", html.includes("score-dispute-trigger")],
  ["html provisional badge", html.includes("qip-provisional-badge")],
  ["html scored calls eyebrow", html.includes("every type is scored")],
  ["html account column", html.includes(">Account<")],
  ["html wireframe cards", html.includes("card-wire")],
  ["html evidence blocks", html.includes("coaching-ev")],
];

const failed = checks.filter(([, ok]) => !ok);
store.delete(STORAGE_KEY);

if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}

console.log("OK — coaching render smoke test passed");
