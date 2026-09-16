/** Logout/login and browser-restart persistence — history in localStorage, session dual-stored. */

import {
  STORAGE_PREFIX,
  savePostCallAnalysis,
  listPostCallAnalyses,
  storageKey,
} from "../history.js";
import { buildDashboardMetrics } from "../dashboard.js";
import { computeOverallScore, overallLabelFromScore } from "../quality-score.js";
import { getSession, loginDummy, logout } from "../auth.js";

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

// Dummy auth validates against a fixed roster (web/dummy-users.js) now — it no
// longer accepts any @freshworks.com address, so the old fabricated se1@/se2@
// logins silently returned {ok:false} and never established a session.
const SE1 = "saketh.poruri@freshworks.com";
const SE2 = "balaji.ramkumar@freshworks.com";

function sampleResult(headline) {
  const dimensions = [
    { name: "Discovery", score: 4, maxScore: 5, feedback: "", evidence: "" },
  ];
  const overallScore = computeOverallScore(dimensions);
  return {
    analysis: {
      // callHeader mirrors what the worker's normalizePostCallOutput actually
      // emits (word-limits.js maps callSummary.headline -> callHeader.title),
      // so this fixture matches a real stored record. Without it the fixture is
      // an un-normalized legacy blob that no production path produces, and
      // title resolution correctly falls all the way through to "Activity".
      callHeader: { title: headline, company: "Acme" },
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

function clearAll() {
  store.clear();
  sessionStore.clear();
}

clearAll();

// SE1 saves an analysis while logged in
await loginDummy(SE1, "se123");
savePostCallAnalysis(SE1, { recordingUrl: "https://zoom.us/rec/1" }, sampleResult("Call A"));

if (listPostCallAnalyses(SE1).length !== 1) {
  console.error("FAILED: analysis not saved for SE1");
  process.exit(1);
}

// Logout clears session only — history must remain
logout();
if (getSession() !== null) {
  console.error("FAILED: session not cleared on logout");
  process.exit(1);
}
if (listPostCallAnalyses(SE1).length !== 1) {
  console.error("FAILED: history lost after logout");
  process.exit(1);
}

// Same SE logs back in — history and dashboard should restore
await loginDummy(SE1, "se123");
const afterRelogin = listPostCallAnalyses(SE1);
// Titles are derived/structured now (resolveCallTitleFromRecord builds
// "{Account} · {Call type} - {headline}"), not copied verbatim from the
// headline — so match on containment, not equality. The point of this
// assertion is record identity surviving re-login, not title formatting.
if (afterRelogin.length !== 1 || !afterRelogin[0].title.includes("Call A")) {
  console.error("FAILED: history not restored after re-login");
  process.exit(1);
}

const metrics = buildDashboardMetrics(SE1);
if (metrics.totalCalls !== 1) {
  console.error("FAILED: dashboard metrics empty after re-login");
  process.exit(1);
}

// Browser close: sessionStorage cleared, localStorage keeps auth + history
sessionStore.clear();
if (getSession()?.email !== SE1) {
  console.error("FAILED: session not restored from localStorage after browser restart");
  process.exit(1);
}
if (listPostCallAnalyses(SE1).length !== 1) {
  console.error("FAILED: history lost after simulated browser restart");
  process.exit(1);
}

// SE2 has separate history
logout();
await loginDummy(SE2, "se123");
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
console.log("OK — history persists across logout/login and browser restart");
