import type { FirestoreEnv } from "../firestore-admin";
import { listCallSummariesByOwner } from "../repositories/call-summaries";
import { listScorecardLinesForCalls, listScorecardsForCalls } from "../repositories/scorecards";
import {
  aggregateCoachingMetrics,
  buildScorecardsFromSummaries,
} from "./aggregate-coaching";
import { writeReadModel } from "./write";

const WEEK_MS = 7 * 86400000;

export async function rebuildSeLaunchpad(
  userId: string,
  sourceUpdatedAt: number,
  env?: FirestoreEnv,
): Promise<void> {
  if (!userId) return;

  const summaries = await listCallSummariesByOwner(userId, 200, env);
  const callIds = summaries.map((s) => String(s.id)).filter(Boolean);
  const [linesByCall, cardsByCall] = await Promise.all([
    listScorecardLinesForCalls(callIds, env),
    listScorecardsForCalls(callIds, env),
  ]);
  const scorecards = buildScorecardsFromSummaries(summaries, linesByCall, cardsByCall);
  const qualityMetrics = aggregateCoachingMetrics(scorecards);

  const now = Date.now();
  const weekCutoff = now - WEEK_MS;
  const callsThisWeek = summaries.filter((s) => Number(s.createdAt || 0) >= weekCutoff).length;

  const recentCalls = summaries.slice(0, 10).map((s) => ({
    id: s.id,
    title: s.title,
    company: s.accountName || s.title,
    timestamp: s.createdAt,
    overallScore: s.qipOverall ?? s.qualityScore ?? null,
    callType: s.callType || "demo",
  }));

  await writeReadModel(
    "seLaunchpad",
    userId,
    {
      userId,
      callMetrics: {
        totalCalls: summaries.length,
        callsThisWeek,
      },
      qualityMetrics,
      recentCalls,
    },
    sourceUpdatedAt,
    env,
  );
}
