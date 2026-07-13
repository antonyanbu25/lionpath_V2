/** Smoke test for history storage + dashboard aggregation (no browser). */

import { savePostCallAnalysis, listPostCallAnalyses } from "../history.js";

import { aggregateQualityMetrics } from "../dashboard.js";
import { computeOverallScore, overallLabelFromScore } from "../quality-score.js";



// Minimal localStorage mock for Node

const store = new Map();

globalThis.localStorage = {

  getItem: (k) => store.get(k) ?? null,

  setItem: (k, v) => store.set(k, v),

  removeItem: (k) => store.delete(k),

};



const TEST_EMAIL = "test-se@freshworks.com";

const STORAGE_KEY = `se-sp-postcalls:${TEST_EMAIL}`;



function sampleResult(dimScores) {
  const dimensions = [
    { name: "Discovery", score: dimScores[0], maxScore: 5, feedback: "", evidence: "" },
    { name: "Demo alignment", score: dimScores[1], maxScore: 5, feedback: "", evidence: "" },
    { name: "Objections", score: dimScores[2], maxScore: 5, feedback: "", evidence: "" },
  ];
  const overallScore = computeOverallScore(dimensions);
  return {
    analysis: {
      callSummary: { headline: `Call ${overallScore}` },
      qualityCoach: {
        overallScore,
        overallLabel: overallLabelFromScore(overallScore),
        dimensions,
        strengths: [],
        improvements: [],
        missedOpportunities: [],
      },
    },
    transcriptMeta: { wordCount: 100 },
  };
}



store.delete(STORAGE_KEY);



savePostCallAnalysis(TEST_EMAIL, { recordingUrl: "https://zoom.us/rec/1" }, sampleResult([4, 5, 4]));
savePostCallAnalysis(TEST_EMAIL, { recordingUrl: "https://zoom.us/rec/2" }, sampleResult([3, 4, 3]));
savePostCallAnalysis(TEST_EMAIL, { recordingUrl: "https://zoom.us/rec/3" }, sampleResult([1, 2, 1]));



const list = listPostCallAnalyses(TEST_EMAIL);

const metrics = aggregateQualityMetrics(list);



const checks = [

  ["3 analyses saved", list.length === 3],

  ["avg overall ~6.0", Math.abs(metrics.avgOverall - 18.1 / 3) < 0.1],

  ["3 dimensions", metrics.dimensions.length === 3],

  ["best dimension exists", !!metrics.bestDimension],

  ["recent calls", metrics.recentCalls.length === 3],

  ["score trend chronological", metrics.scoreTrend[0]?.overallScore === 8.7],

  ["score bands excellent", metrics.scoreBands.excellent === 1],
  ["score bands good", metrics.scoreBands.good === 1],
  ["score bands developing", metrics.scoreBands.developing === 0],
  ["score bands needs focus", metrics.scoreBands.needsFocus === 1],

];



const failed = checks.filter(([, ok]) => !ok);

store.delete(STORAGE_KEY);



if (failed.length) {

  console.error("FAILED:", failed.map(([n]) => n).join(", "));

  process.exit(1);

}

console.log("OK — dashboard aggregation smoke test passed");


