/**
 * Smoke tests for All calls list — spec §11.3.
 */
import {
  filterCallRecords,
  aggregateCallListMetrics,
  buildCallListRow,
  countProductGaps,
  hasNextStep,
  resolveMomSent,
  resolveQipDisplay,
  resolveDurationMinutes,
} from "../calls-list-view.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const now = Date.now();
const day = 24 * 60 * 60 * 1000;

const liveCall = {
  id: "pc_live",
  timestamp: now - 2 * day,
  dealId: "deal_1",
  callType: "demo",
  scorecard: {
    callType: "demo",
    rubricVersion: "1.0",
    provisional: false,
    confidence: 0.9,
    lines: [{ themeKey: "call_flow", score: 80, maxScore: 100, applicable: true, weight: 10 }],
  },
  analysisMeta: { callType: "demo", provisional: false, analysisConfidence: 0.9 },
  transcriptMeta: { durationMinutes: 45 },
  analysis: {
    nextSteps: [{ action: "Send POC plan", owner: "SE", due: "Friday" }],
    callHeader: { title: "Acme · Demo" },
  },
  result: {
    summarise: {
      momDraft: { draftBody: "Thanks for your time.", sentAt: now - day },
      objections: [{ theme: "product_gap", objectionText: "Missing API" }],
    },
  },
};

const shadowCall = {
  id: "pc_shadow",
  timestamp: now - day,
  callType: "trial_setup",
  scorecard: {
    callType: "trial_setup",
    rubricVersion: "1.0",
    provisional: true,
    confidence: 0.95,
    lines: [{ themeKey: "call_flow", score: 70, maxScore: 100, applicable: true, weight: 5 }],
  },
  analysisMeta: { callType: "trial_setup", provisional: true },
  transcriptMeta: { durationMinutes: 30 },
  analysis: { momentum: { topAction: "Schedule kickoff" }, callHeader: { title: "Beta Co" } },
  result: { summarise: { momDraft: { draftBody: "Draft only" } } },
};

const staleCall = {
  id: "pc_old",
  timestamp: now - 120 * day,
  callType: "discovery",
  scorecard: {
    callType: "discovery",
    provisional: false,
    confidence: 0.85,
    lines: [{ themeKey: "questions", score: 60, maxScore: 100, applicable: true, weight: 20 }],
  },
  analysis: {},
};

const all = [liveCall, shadowCall, staleCall];
const filtered = filterCallRecords(all, { callType: "", window: "30d" });

assert(filtered.length === 2, "30d window excludes stale call");
assert(filterCallRecords(all, { callType: "demo", window: "all" }).length === 1, "type filter");

const metrics = aggregateCallListMetrics(filtered);
assert(metrics.callCount === 1, "provisional excluded from call count");
assert(metrics.hours === 0.8, `hours wrong: ${metrics.hours}`);
assert(metrics.momSent === 1, "mom sent count");
assert(metrics.noNextStep === 0, "live call has next step");
assert(metrics.gapsSurfaced === 1, "product_gap counted");
assert(metrics.provisionalExcluded === 1, "provisional excluded note");

const qip = resolveQipDisplay(shadowCall);
assert(qip.provisional, "shadow call provisional");
assert(qip.label.includes("trial_setup"), "profile in qip label");

assert(hasNextStep(liveCall), "nextSteps detected");
assert(!hasNextStep({ analysis: {} }), "empty next step");
assert(resolveMomSent(liveCall).sent, "mom sent");
assert(!resolveMomSent(shadowCall).sent, "mom draft not sent");
assert(countProductGaps(liveCall) === 1, "gap count");
assert(resolveDurationMinutes(liveCall) === 45, "duration");

const row = buildCallListRow(liveCall, new Map(), new Map());
assert(row.accountName.includes("Acme"), "account from title");
assert(row.qipProvisional === false, "row not provisional");

console.log("test-calls-list-view: ok");
