import { queryBy, type FirestoreEnv } from "../firestore-admin";
import { listCallSummariesByTeam } from "../repositories/call-summaries";
import { listScorecardLinesForCalls, listScorecardsForCalls } from "../repositories/scorecards";
import {
  aggregateCoachingByOwner,
  aggregateCoachingMetrics,
  buildManagerViewPayload,
  buildScorecardsFromSummaries,
} from "./aggregate-coaching";
import { writeReadModel } from "./write";

export async function rebuildTeamMetrics(
  teamId: string,
  sourceUpdatedAt: number,
  env?: FirestoreEnv,
): Promise<void> {
  if (!teamId) return;

  const summaries = await listCallSummariesByTeam(teamId, 200, env);
  const callIds = summaries.map((s) => String(s.id)).filter(Boolean);
  const [linesByCall, cardsByCall] = await Promise.all([
    listScorecardLinesForCalls(callIds, env),
    listScorecardsForCalls(callIds, env),
  ]);
  const scorecards = buildScorecardsFromSummaries(summaries, linesByCall, cardsByCall);
  const teamMetrics = aggregateCoachingMetrics(scorecards);
  const byOwner = aggregateCoachingByOwner(summaries, scorecards);

  const users = await queryBy("users", [{ field: "teamId", op: "==", value: teamId }], undefined, undefined, env);
  const managerView = buildManagerViewPayload(summaries, scorecards, users);
  const seRows = users.map((user) => {
    const metrics = byOwner.get(String(user.id)) || teamMetrics;
    return {
      email: String(user.email || ""),
      name: String(user.displayName || user.email || user.id),
      teamName: null,
      calls: metrics.totalCalls,
      avgScore: metrics.avgOverall,
      focusArea: metrics.worstDimension?.name || "-",
      overdue: 0,
      ownerId: user.id,
    };
  });

  await writeReadModel(
    "teamMetrics",
    teamId,
    {
      teamId,
      teamMetrics,
      seRows,
      themeHeatmap: managerView.themeHeatmap,
      managerView,
      trendBuckets: teamMetrics.trendByType,
      callCount: summaries.length,
    },
    sourceUpdatedAt,
    env,
  );
}
