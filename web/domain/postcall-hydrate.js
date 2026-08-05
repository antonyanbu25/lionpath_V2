/**
 * Firestore postCall / callSummaries → analysis records (shared by dashboard and se-access).
 */
import { detailFromPostCall } from "./post-call-detail.js";
import { getStore } from "./store.js";
import { coerceScorecardLines } from "../shared/qip-scorecard-normalize.js";
import { canonicalCallType } from "../call-type-labels.js";
import { callSummariesToAnalyses } from "./call-summary.js";

/** @param {object|null|undefined} rec */
export function hasCoachingAnalysis(rec) {
  return !!(
    rec?.analysis?.qualityCoach ||
    rec?.scorecard?.lines?.length ||
    rec?.result?.scorecard?.lines?.length ||
    rec?.scorecard?.overall != null ||
    rec?.scorecard?.categoryScores ||
    rec?.qipOverall != null
  );
}

function mapScorecardLine(line) {
  return {
    themeKey: line.themeKey,
    grade: line.grade ?? (line.maxScore === 100 ? (line.score ?? 0) / 10 : line.score ?? 0),
    credit: line.credit ?? line.weight ?? 0,
    category: line.category,
    applicable: line.applicable !== false,
    subParameters: line.subParameters || [],
    evidenceUnavailable: !!line.evidenceUnavailable,
    confidence: line.confidence ?? null,
    coachingNote: line.coachingNote || null,
  };
}

function recordHasScorecardLines(rec) {
  return !!(rec?.scorecard?.lines?.length || rec?.result?.scorecard?.lines?.length);
}

export function postCallRecordsToAnalyses(records) {
  return (records || []).map((r) => {
    const embedded = detailFromPostCall(r);
    const analysisMeta = {
      callType: canonicalCallType(r.callType || r.analysisMeta?.callType || "demo"),
      rubricVersion: r.rubricVersion || r.analysisMeta?.rubricVersion || "2.1",
      analysisConfidence: r.analysisConfidence ?? r.analysisMeta?.analysisConfidence ?? null,
      provisional: r.provisional ?? r.analysisMeta?.provisional ?? false,
    };
    const coercedLines = coerceScorecardLines(r.scorecard?.lines);
    const hasScorecardLines = coercedLines.length > 0;
    const hasScorecardSummary =
      !!r.scorecard?.categoryScores ||
      typeof r.scorecard?.overall === "number" ||
      typeof r.qipOverall === "number" ||
      !!r.qipCategoryScores;
    const scorecard = hasScorecardLines
      ? { ...r.scorecard, callType: analysisMeta.callType, lines: coercedLines.map(mapScorecardLine) }
      : hasScorecardSummary
        ? {
            ...(r.scorecard || {}),
            callType: analysisMeta.callType,
            overall: r.scorecard?.overall ?? r.qipOverall ?? r.qualityScore ?? null,
            categoryScores: r.scorecard?.categoryScores || r.qipCategoryScores || {},
            lines: coercedLines,
          }
        : null;
    return {
      id: r.id,
      timestamp: r.createdAt ?? r.timestamp,
      title: r.title,
      zoomLink: r.zoomLink,
      ownerId: r.ownerId,
      analysis: r.analysis,
      scorecard,
      analysisMeta,
      result: {
        analysis: r.analysis,
        transcriptMeta: r.transcriptMeta,
        scorecard,
        analysisMeta,
        technicalCommit: embedded.technicalCommit || null,
        tcDeltas: embedded.tcDeltas?.length ? embedded.tcDeltas : [],
        summarise: r.summarise || null,
        pass6: r.pass6 || null,
        timeline: r.timeline || null,
        videoFacts: embedded.videoFacts?.[0] || r.videoFacts || null,
        objections: embedded.objections?.length ? embedded.objections : [],
        followUps: embedded.followUps?.length ? embedded.followUps : [],
        momDraft: embedded.momDrafts?.[0] || null,
      },
    };
  });
}

/**
 * Pure assembly — zero I/O.
 * @param {object[]} analyses
 * @param {Map<string, object[]>|undefined|null} scorecardsByCall
 * @param {Map<string, object[]>|undefined|null} linesByCall
 */
export function hydratePostCallAnalyses(analyses, scorecardsByCall, linesByCall) {
  if (!analyses?.length) return analyses || [];

  const cardsMap = scorecardsByCall instanceof Map ? scorecardsByCall : new Map();
  const linesMap = linesByCall instanceof Map ? linesByCall : new Map();

  return analyses.map((rec) => {
    if (recordHasScorecardLines(rec)) return rec;
    if (rec.scorecard?.overall != null || rec.scorecard?.categoryScores) return rec;

    const card = cardsMap.get(rec.id)?.[0];
    if (!card) return rec;

    const storedLines = linesMap.get(rec.id) || [];
    const lines = storedLines.map(mapScorecardLine);

    const scorecard = {
      callType: card.callType || rec.analysisMeta?.callType || "demo",
      rubricVersion: card.rubricVersion || rec.analysisMeta?.rubricVersion || "2.1",
      overall: card.overall ?? null,
      categoryScores: card.categoryScores || {},
      lines,
      confidence: card.confidence ?? rec.analysisMeta?.analysisConfidence ?? null,
      provisional: !!(card.provisional ?? rec.analysisMeta?.provisional),
    };
    const analysisMeta = {
      ...rec.analysisMeta,
      callType: scorecard.callType,
      rubricVersion: scorecard.rubricVersion,
      analysisConfidence: scorecard.confidence,
      provisional: scorecard.provisional,
    };

    return {
      ...rec,
      scorecard,
      analysisMeta,
      result: { ...rec.result, scorecard, analysisMeta },
    };
  });
}

/**
 * Batch-fetch scorecards/lines then hydrate.
 * @param {object[]} analyses
 * @param {object} store
 */
export async function fetchAndHydratePostCallAnalyses(analyses, store) {
  if (!analyses?.length) return analyses || [];

  const needIds = analyses.filter((rec) => !recordHasScorecardLines(rec) && !rec.scorecard?.overall).map((rec) => rec.id);
  if (!needIds.length) return analyses;

  if (!store?.listScorecardsForCalls || !store?.listScorecardLinesForCalls) {
    return analyses;
  }

  const [scorecardsByCall, linesByCall] = await Promise.all([
    store.listScorecardsForCalls(needIds),
    store.listScorecardLinesForCalls(needIds),
  ]);

  return hydratePostCallAnalyses(analyses, scorecardsByCall, linesByCall);
}

/** @param {object|null} session */
export async function loadTeamCallSummariesFromStore(session) {
  try {
    const store = getStore();
    let summaries = [];
    if (session?.isOrgDirector && session?.orgId && store.listCallSummariesByOrg) {
      summaries = await store.listCallSummariesByOrg(session.orgId);
    } else if (session?.teamId && store.listCallSummariesByTeam) {
      summaries = await store.listCallSummariesByTeam(session.teamId);
    }
    if (summaries?.length) {
      return callSummariesToAnalyses(summaries);
    }
  } catch (err) {
    console.warn("Could not load team callSummaries from domain store:", err);
  }
  return [];
}

/** @deprecated Use loadTeamCallSummariesFromStore — list paths must not fetch full postCalls. */
export async function loadTeamPostCallsFromStore(session) {
  return loadTeamCallSummariesFromStore(session);
}
