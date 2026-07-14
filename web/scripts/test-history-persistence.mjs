/** Logout/login persistence — history in localStorage, session in sessionStorage. */

import {
  STORAGE_PREFIX,
  savePostCallAnalysis,
  listPostCallAnalyses,
  storageKey,
} from "../history.js";
import { buildDashboardMetrics } from "../dashboard.js";
import { computeOverallScore, overallLabelFromScore } from "../quality-score.js";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};

const sessionStore = new Map();
globalThis.sessionStorage = {
  getItem: (k) => sessionStore.get(k) ?? null,
  setItem: (k, v) => sessionStore.set(k, v),
  removeItem: (k) => sessionStore.delete(k),
};

const SE1 = "se1@freshworks.com";
const SE2 = "se2@freshworks.com";
const SESSION_KEY = "se-sp-session";

function sampleResult(headline) {
  const dimensions = [
    { name: "Discovery", score: 4, maxScore: 5, feedback: "", evidence: "" },
  ];
  const overallScore = computeOverallScore(dimensions);
  return {
    analysis: {
      callSummary: { headline },
      qualityCoach: {
        overallScore,
        overallLabel: overallLabelFromScore(overallScore),
        dimensions,
        strengths: [],
        improvements: [],
        missedOpportunities: [],
      },
    },
    transcriptMeta: { wordCount: 50 },
  };
}

function login(email) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: "se", email, name: "Test" }));
}

function logout() {
  sessionStorage.removeItem(SESSION_KEY);
}

function clearAll() {
  store.clear();
  sessionStore.clear();
}

clearAll();

// SE1 saves an analysis while logged in
login(SE1);
savePostCallAnalysis(SE1, { recordingUrl: "https://zoom.us/rec/1" }, sampleResult("Call A"));

if (listPostCallAnalyses(SE1).length !== 1) {
  console.error("FAILED: analysis not saved for SE1");
  process.exit(1);
}

// Logout clears session only — history must remain
logout();
if (sessionStorage.getItem(SESSION_KEY) !== null) {
  console.error("FAILED: session not cleared on logout");
  process.exit(1);
}
if (listPostCallAnalyses(SE1).length !== 1) {
  console.error("FAILED: history lost after logout");
  process.exit(1);
}

// Same SE logs back in — history and dashboard should restore
login(SE1);
const afterRelogin = listPostCallAnalyses(SE1);
if (afterRelogin.length !== 1 || afterRelogin[0].title !== "Call A") {
  console.error("FAILED: history not restored after re-login");
  process.exit(1);
}

const metrics = buildDashboardMetrics(SE1);
if (metrics.totalCalls !== 1) {
  console.error("FAILED: dashboard metrics empty after re-login");
  process.exit(1);
}

// SE2 has separate history
login(SE2);
if (listPostCallAnalyses(SE2).length !== 0) {
  console.error("FAILED: SE2 should start with empty history");
  process.exit(1);
}

savePostCallAnalysis(SE2, { recordingUrl: "https://zoom.us/rec/2" }, sampleResult("Call B"));
if (listPostCallAnalyses(SE1).length !== 1 || listPostCallAnalyses(SE2).length !== 1) {
  console.error("FAILED: per-user history isolation broken");
  process.exit(1);
}

if (!storageKey(SE1).startsWith(STORAGE_PREFIX)) {
  console.error("FAILED: unexpected storage key prefix");
  process.exit(1);
}

clearAll();
console.log("OK — history persists across logout/login");
