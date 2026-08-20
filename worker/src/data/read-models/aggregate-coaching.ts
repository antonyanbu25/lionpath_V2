import type { FirestoreDoc } from "../firestore-admin";
import {
  formatProfileAverage,
  isEligibleForAggregate,
  profileAverage,
  themeAverage,
  type AggregateOpts,
  type ScorecardForAggregate,
  type ScorecardLineForScore,
} from "../../quality-score";

const COACHING_AGG_OPTS: AggregateOpts = { requireHighConfidence: true };
const COACHING_QUEUE_SCORE_MAX = 70;
const COACHING_QUEUE_MAX = 12;

const CALL_TYPE_LABELS: Record<string, string> = {
  discovery: "Discovery",
  demo: "Demo",
  technical_validation: "Technical validation",
  business_review: "Business review",
  renewal: "Renewal",
  internal: "Internal",
  partner: "Partner",
  qa_session: "Q&A session",
};

export interface CoachingMetrics {
  totalCalls: number;
  provisionalExcluded: number;
  spine: { score: number | null; themeCount: number; callCount: number; coverage: number };
  byType: Array<Record<string, unknown>>;
  trendByType: { points: unknown[]; callTypes: string[]; series: Record<string, unknown> };
  avgOverall: number | null;
  dimensions: Array<{ name: string; avgScore: number; maxScore: number; count: number }>;
  bestDimension: { name: string; avgScore: number } | null;
  worstDimension: { name: string; avgScore: number } | null;
  usesLegacyCoach: boolean;
  teamThemeAverages?: Array<{ themeKey: string; score: number | null }>;
}

function rankDimensions(dimensions: CoachingMetrics["dimensions"]) {
  if (!dimensions.length) return { bestDimension: null, worstDimension: null };
  const sorted = [...dimensions].sort((a, b) => a.avgScore - b.avgScore);
  return {
    bestDimension: sorted[sorted.length - 1],
    worstDimension: sorted[0],
  };
}

export function buildScorecardsFromSummaries(
  summaries: FirestoreDoc[],
  linesByCall: Map<string, FirestoreDoc[]>,
  cardsByCall: Map<string, FirestoreDoc[]>,
): ScorecardForAggregate[] {
  const out: ScorecardForAggregate[] = [];
  for (const summary of summaries) {
    const callId = String(summary.id || "");
    const card = cardsByCall.get(callId)?.[0];
    const lines = (linesByCall.get(callId) || []).map(
      (line): ScorecardLineForScore => ({
        themeKey: String(line.themeKey || ""),
        grade: Number(line.grade ?? line.score ?? 0),
        credit: Number(line.credit ?? line.weight ?? 1),
        category: (line.category as ScorecardLineForScore["category"]) || "discovery_qualification",
        evidenceUnavailable: !!(line.evidenceUnavailable ?? line.applicable === false),
      }),
    );
    const callType = String(card?.callType || summary.callType || "demo");
    const scorecard: ScorecardForAggregate = {
      callType,
      rubricVersion: String(card?.rubricVersion || summary.rubricVersion || "2.1"),
      overall:
        typeof card?.overall === "number"
          ? card.overall
          : typeof summary.qipOverall === "number"
            ? summary.qipOverall
            : typeof summary.qualityScore === "number"
              ? summary.qualityScore
              : undefined,
      lines,
      provisional: !!(card?.provisional ?? summary.provisional),
      confidence:
        typeof card?.confidence === "number"
          ? card.confidence
          : typeof summary.analysisConfidence === "number"
            ? summary.analysisConfidence
            : null,
    };
    if (lines.length || scorecard.overall != null) out.push(scorecard);
  }
  return out;
}

export function aggregateCoachingMetrics(scorecards: ScorecardForAggregate[]): CoachingMetrics {
  const eligible = scorecards.filter((sc) => isEligibleForAggregate(sc, COACHING_AGG_OPTS));
  const provisionalExcluded = scorecards.filter(
    (sc) => !isEligibleForAggregate(sc, COACHING_AGG_OPTS),
  ).length;

  if (!eligible.length) {
    return {
      totalCalls: 0,
      provisionalExcluded,
      spine: { score: null, themeCount: 0, callCount: 0, coverage: 0 },
      byType: [],
      trendByType: { points: [], callTypes: [], series: {} },
      avgOverall: null,
      dimensions: [],
      bestDimension: null,
      worstDimension: null,
      usesLegacyCoach: false,
    };
  }

  const callTypes = [...new Set(eligible.map((sc) => sc.callType).filter(Boolean))];
  const byType = callTypes.map((callType) => {
    const avg = profileAverage(eligible, callType, COACHING_AGG_OPTS);
    return {
      ...avg,
      callType,
      callCount: eligible.filter((sc) => sc.callType === callType).length,
    };
  });

  const themeKeys = [...new Set(eligible.flatMap((sc) => (sc.lines || []).map((l) => l.themeKey)))];
  const dimensions = themeKeys
    .map((themeKey) => {
      const avg = themeAverage(eligible, themeKey, null, COACHING_AGG_OPTS);
      if (avg.score == null) return null;
      return {
        name: themeKey,
        avgScore: avg.score,
        maxScore: 10,
        count: avg.count,
      };
    })
    .filter(Boolean) as CoachingMetrics["dimensions"];

  const { bestDimension, worstDimension } = rankDimensions(dimensions);
  const spineScores = themeKeys
    .slice(0, 4)
    .map((key) => themeAverage(eligible, key, null, COACHING_AGG_OPTS).score)
    .filter((s): s is number => s != null);
  const spineScore =
    spineScores.length > 0
      ? Math.round((spineScores.reduce((a, b) => a + b, 0) / spineScores.length) * 100) / 100
      : null;

  const teamAvgs = themeKeys.map((key) => ({
    themeKey: key,
    score: themeAverage(eligible, key, null, COACHING_AGG_OPTS).score,
  }));

  return {
    totalCalls: eligible.length,
    provisionalExcluded,
    spine: {
      score: spineScore,
      themeCount: themeKeys.length,
      callCount: eligible.length,
      coverage: themeKeys.length ? Math.round((dimensions.length / themeKeys.length) * 100) : 0,
    },
    byType,
    trendByType: { points: [], callTypes, series: {} },
    avgOverall: byType.length === 1 ? byType[0].score ?? spineScore : spineScore,
    dimensions,
    bestDimension,
    worstDimension,
    usesLegacyCoach: false,
    teamThemeAverages: teamAvgs,
  };
}

export function aggregateCoachingByOwner(
  summaries: FirestoreDoc[],
  scorecards: ScorecardForAggregate[],
): Map<string, CoachingMetrics> {
  const byCallId = new Map<string, ScorecardForAggregate>();
  summaries.forEach((summary, index) => {
    const sc = scorecards[index];
    if (sc) byCallId.set(String(summary.id), sc);
  });

  const byOwner = new Map<string, CoachingMetrics>();
  const ownerIds = [...new Set(summaries.map((s) => String(s.ownerId || "")).filter(Boolean))];
  for (const ownerId of ownerIds) {
    const ownerScorecards = summaries
      .filter((s) => s.ownerId === ownerId)
      .map((s) => byCallId.get(String(s.id)))
      .filter(Boolean) as ScorecardForAggregate[];
    byOwner.set(ownerId, aggregateCoachingMetrics(ownerScorecards));
  }
  return byOwner;
}

export interface ManagerViewPayload {
  seScorecardsByEmail: Record<string, ScorecardForAggregate[]>;
  allEligibleScorecards: ScorecardForAggregate[];
  callMetaByCallId: Record<
    string,
    { timestamp: number; company: string; seName: string; seEmail: string | null }
  >;
  coachingQueue: Array<Record<string, unknown>>;
  themeHeatmap: {
    themeKeys: string[];
    teamAverages: Array<{ themeKey: string; score: number | null }>;
    seRows: Array<{
      email: string;
      name: string;
      themeAverages: Array<{ themeKey: string; score: number | null }>;
    }>;
  };
}

function companyFromSummary(summary: FirestoreDoc): string {
  const title = summary.title || "Call";
  const parts = String(title).split(/[·|–—-]/);
  return (parts[0] || String(title)).trim();
}

function scorecardsByOwnerId(
  summaries: FirestoreDoc[],
  scorecards: ScorecardForAggregate[],
): Map<string, ScorecardForAggregate[]> {
  const byOwner = new Map<string, ScorecardForAggregate[]>();
  summaries.forEach((summary, index) => {
    const sc = scorecards[index];
    if (!sc) return;
    const ownerId = String(summary.ownerId || "");
    if (!ownerId) return;
    const callId = String(summary.id || "");
    const enriched = { ...sc, callId };
    const list = byOwner.get(ownerId) || [];
    list.push(enriched);
    byOwner.set(ownerId, list);
  });
  return byOwner;
}

function buildCoachingQueueItems(
  summaries: FirestoreDoc[],
  scorecards: ScorecardForAggregate[],
  users: FirestoreDoc[],
): Array<Record<string, unknown>> {
  const nameByOwnerId = new Map(
    users.map((u) => [String(u.id), String(u.displayName || u.email || u.id)]),
  );
  const emailByOwnerId = new Map(users.map((u) => [String(u.id), String(u.email || "")]));

  const items: Array<Record<string, unknown>> = [];
  summaries.forEach((summary, index) => {
    const sc = scorecards[index];
    if (!sc || !isEligibleForAggregate(sc, COACHING_AGG_OPTS)) return;
    const composite = profileAverage([sc], sc.callType, COACHING_AGG_OPTS);
    const score = composite.score;
    if (score == null || score > COACHING_QUEUE_SCORE_MAX) return;

    let weakest: { themeKey: string; score: number } | null = null;
    for (const line of sc.lines || []) {
      if (line.evidenceUnavailable) continue;
      if (!weakest || line.grade < weakest.score) {
        weakest = { themeKey: line.themeKey, score: line.grade };
      }
    }

    const ownerId = String(summary.ownerId || "");
    items.push({
      callId: String(summary.id),
      company: companyFromSummary(summary),
      seName: nameByOwnerId.get(ownerId) || "-",
      seEmail: emailByOwnerId.get(ownerId) || null,
      timestamp: Number(summary.createdAt || 0),
      callType: sc.callType,
      callTypeLabel: CALL_TYPE_LABELS[String(sc.callType)] || sc.callType,
      score,
      scoreLabel: formatProfileAverage(composite),
      confidencePct: sc.confidence != null ? Math.round(sc.confidence * 100) : null,
      weakestTheme: weakest?.themeKey || null,
      weakestScore: weakest?.score ?? null,
    });
  });

  return items
    .sort((a, b) => Number(a.score ?? 100) - Number(b.score ?? 100))
    .slice(0, COACHING_QUEUE_MAX);
}

/** Pre-aggregate manager heatmap scorecards + coaching queue for teamMetrics/orgMetrics. */
export function buildManagerViewPayload(
  summaries: FirestoreDoc[],
  scorecards: ScorecardForAggregate[],
  users: FirestoreDoc[],
): ManagerViewPayload {
  const byOwner = scorecardsByOwnerId(summaries, scorecards);
  const seScorecardsByEmail: Record<string, ScorecardForAggregate[]> = {};
  const callMetaByCallId: ManagerViewPayload["callMetaByCallId"] = {};

  for (const user of users) {
    const email = String(user.email || "");
    if (!email) continue;
    const ownerScorecards = (byOwner.get(String(user.id)) || []).filter((sc) =>
      isEligibleForAggregate(sc, COACHING_AGG_OPTS),
    );
    seScorecardsByEmail[email] = ownerScorecards;
  }

  for (const summary of summaries) {
    const callId = String(summary.id || "");
    if (!callId) continue;
    const ownerId = String(summary.ownerId || "");
    const user = users.find((u) => String(u.id) === ownerId);
    callMetaByCallId[callId] = {
      timestamp: Number(summary.createdAt || 0),
      company: companyFromSummary(summary),
      seName: String(user?.displayName || user?.email || "-"),
      seEmail: user ? String(user.email || "") || null : null,
    };
  }

  const allEligibleScorecards = Object.values(seScorecardsByEmail).flat();
  const themeKeys = [
    ...new Set(allEligibleScorecards.flatMap((sc) => (sc.lines || []).map((l) => l.themeKey))),
  ];
  const teamAverages = themeKeys.map((themeKey) => ({
    themeKey,
    score: themeAverage(allEligibleScorecards, themeKey, null, COACHING_AGG_OPTS).score,
  }));
  const seHeatmapRows = users
    .filter((u) => u.email)
    .map((user) => {
      const email = String(user.email || "");
      const ownerScorecards = seScorecardsByEmail[email] || [];
      return {
        email,
        name: String(user.displayName || email || user.id),
        themeAverages: themeKeys.map((themeKey) => ({
          themeKey,
          score: themeAverage(ownerScorecards, themeKey, null, COACHING_AGG_OPTS).score,
        })),
      };
    });

  return {
    seScorecardsByEmail,
    allEligibleScorecards,
    callMetaByCallId,
    coachingQueue: buildCoachingQueueItems(summaries, scorecards, users),
    themeHeatmap: {
      themeKeys,
      teamAverages,
      seRows: seHeatmapRows,
    },
  };
}

export { COACHING_AGG_OPTS };
