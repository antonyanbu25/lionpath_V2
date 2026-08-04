/** Manager dashboard — Firestore postCall fallback hydrates v2.1 scorecards (no qualityCoach). */
import {
  postCallRecordsToAnalyses,
  hydratePostCallAnalyses,
  hasCoachingAnalysis,
} from "../domain/postcall-hydrate.js";
import { aggregateQualityMetrics } from "../dashboard.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const callId = "pcall_test_1";
const ownerId = "user_se_alpha";

const postCallDoc = {
  id: callId,
  ownerId,
  teamId: "team_test",
  createdAt: Date.now(),
  title: "Acme · Demo",
  callType: "demo",
  rubricVersion: "2.1",
  analysisConfidence: 0.88,
  provisional: false,
  analysis: {
    callHeader: { title: "Acme · Demo" },
    momentum: { status: "Advancing" },
  },
};

const scorecardDoc = {
  id: "scr_test_1",
  callId,
  callType: "demo",
  rubricVersion: "2.1",
  overall: 7.6,
  confidence: 0.88,
  provisional: false,
  categoryScores: {
    communication_control: 7.8,
    discovery_qualification: 7.2,
  },
};

const lineDocs = [
  {
    themeKey: "call_flow",
    grade: 8,
    credit: 3,
    category: "communication_control",
    subParameters: [{ score: 2 }, { score: 2 }, { score: 2 }, { score: 1 }, { score: 1 }],
  },
  {
    themeKey: "customer_engagement",
    grade: 7,
    credit: 3,
    category: "communication_control",
    subParameters: [{ score: 2 }, { score: 1 }, { score: 2 }, { score: 1 }, { score: 1 }],
  },
  {
    themeKey: "objections",
    grade: 6,
    credit: 2,
    category: "credibility_objections",
    subParameters: [{ score: 1 }, { score: 2 }, { score: 1 }, { score: 1 }, { score: 1 }],
  },
  {
    themeKey: "camera_on",
    grade: 9,
    credit: 2,
    category: "communication_control",
    subParameters: [{ score: 2 }, { score: 2 }, { score: 2 }, { score: 2 }, { score: 1 }],
  },
];

const mapped = postCallRecordsToAnalyses([postCallDoc]);
assert(mapped.length === 1, "postCallRecordsToAnalyses maps one record");
assert(mapped[0].ownerId === ownerId, "preserves ownerId for SE filtering");
assert(!hasCoachingAnalysis(mapped[0]), "no qualityCoach and no lines yet — not coaching-eligible");

const scorecardsByCall = new Map([[callId, [scorecardDoc]]]);
const linesByCall = new Map([[callId, lineDocs]]);
const hydrated = hydratePostCallAnalyses(mapped, scorecardsByCall, linesByCall);
assert(hydrated.length === 1, "hydrate returns one analysis");
assert(hasCoachingAnalysis(hydrated[0]), "hydrated scorecard lines make record coaching-eligible");
assert(hydrated[0].scorecard?.lines?.length === 4, "hydrates four theme lines");
assert(hydrated[0].scorecard.overall === 7.6, "hydrates overall /10 score");
assert(hydrated[0].scorecard.lines[0].grade === 8, "lines use /10 grade not /100 score");
assert(!hydrated[0].analysis?.qualityCoach, "does not require legacy qualityCoach");

const metrics = aggregateQualityMetrics(hydrated);
assert(metrics.usesLegacyCoach === false, "aggregates as QIP scorecard not legacy coach");
assert(metrics.totalCalls === 1, "one scored call in metrics");
assert(metrics.avgOverall != null && metrics.avgOverall > 6, "avg overall computed on /10 scale");

console.log("test-manager-firestore-fallback: ok");
