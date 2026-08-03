/**
 * Firestore postCall → analysis record hydration (shared by dashboard and se-access).
 */
import { getStore } from "./store.js";
import { coerceScorecardLines } from "../shared/qip-scorecard-normalize.js";
import { canonicalCallType } from "../call-type-labels.js";

/** @param {object|null|undefined} rec */
export function hasCoachingAnalysis(rec) {
  return !!(
    rec?.analysis?.qualityCoach ||
    rec?.scorecard?.lines?.length ||
    rec?.result?.scorecard?.lines?.length
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
      typeof r.scorecard?.overall === "number";
    const scorecard = hasScorecardLines
      ? { ...r.scorecard, callType: analysisMeta.callType, lines: coercedLines.map(mapScorecardLine) }
      : hasScorecardSummary
        ? { ...r.scorecard, callType: analysisMeta.callType, lines: coercedLines }
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
      },
    };
  });
}

/** @param {object[]} analyses @param {object} store */
export async function hydratePostCallAnalyses(analyses, store) {
  if (!analyses?.length || !store?.listScorecardsByCall) return analyses || [];

  const hydrated = [];
  for (const rec of analyses) {
    if (recordHasScorecardLines(rec)) {
      hydrated.push(rec);
      continue;
    }

    const cards = await store.listScorecardsByCall(rec.id);
    const card = cards?.[0];
    if (!card) {
      hydrated.push(rec);
      continue;
    }

    let lines = [];
    if (store.listScorecardLinesByCall) {
      const storedLines = await store.listScorecardLinesByCall(rec.id);
      lines = (storedLines || []).map(mapScorecardLine);
    }

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

    hydrated.push({
      ...rec,
      scorecard,
      analysisMeta,
      result: { ...rec.result, scorecard, analysisMeta },
    });
  }
  return hydrated;
}

/** @param {object|null} session */
export async function loadTeamPostCallsFromStore(session) {
  try {
    const store = getStore();
    let records = [];
    if (session?.isOrgDirector && session?.orgId && store.listPostCallsByOrg) {
      records = await store.listPostCallsByOrg(session.orgId);
    } else if (session?.teamId && store.listPostCallsByTeam) {
      records = await store.listPostCallsByTeam(session.teamId);
    }
    if (records?.length) {
      const analyses = postCallRecordsToAnalyses(records);
      return hydratePostCallAnalyses(analyses, store);
    }
  } catch (err) {
    console.warn("Could not load team postCalls from domain store:", err);
  }
  return [];
}
