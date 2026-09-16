import { queryBy, type FirestoreEnv } from "../firestore-admin";
import { listCallSummariesByOrg } from "../repositories/call-summaries";
import { listScorecardLinesForCalls, listScorecardsForCalls } from "../repositories/scorecards";
import { listGapClustersByOrg } from "../repositories/signals";
import {
  aggregateCoachingByOwner,
  aggregateCoachingMetrics,
  buildManagerViewPayload,
  buildScorecardsFromSummaries,
} from "./aggregate-coaching";
import { rebuildTeamMetrics } from "./rebuild-team-metrics";
import { writeReadModel } from "./write";

export async function rebuildOrgMetrics(
  orgId: string,
  sourceUpdatedAt: number,
  env?: FirestoreEnv,
): Promise<void> {
  if (!orgId) return;

  const summaries = await listCallSummariesByOrg(orgId, 300, env);
  const callIds = summaries.map((s) => String(s.id)).filter(Boolean);
  const [linesByCall, cardsByCall, gapClusters] = await Promise.all([
    listScorecardLinesForCalls(callIds, env),
    listScorecardsForCalls(callIds, env),
    listGapClustersByOrg(orgId, 200, env),
  ]);
  const scorecards = buildScorecardsFromSummaries(summaries, linesByCall, cardsByCall);
  const teamMetrics = aggregateCoachingMetrics(scorecards);
  const byOwner = aggregateCoachingByOwner(summaries, scorecards);

  const users = await queryBy("users", [{ field: "orgId", op: "==", value: orgId }], undefined, undefined, env);
  const managerView = buildManagerViewPayload(summaries, scorecards, users);
  const teamNameByEmail = new Map<string, string>();
  const teams = await queryBy("teams", [{ field: "orgId", op: "==", value: orgId }], undefined, undefined, env);
  for (const team of teams) {
    for (const user of users.filter((u) => u.teamId === team.id)) {
      teamNameByEmail.set(String(user.email || "").toLowerCase(), String(team.name || ""));
    }
  }

  const seRows = users.map((user) => {
    const metrics = byOwner.get(String(user.id)) || teamMetrics;
    const email = String(user.email || "");
    return {
      email,
      name: String(user.displayName || email || user.id),
      teamName: teamNameByEmail.get(email.toLowerCase()) || null,
      calls: metrics.totalCalls,
      avgScore: metrics.avgOverall,
      focusArea: metrics.worstDimension?.name || "-",
      overdue: 0,
      ownerId: user.id,
    };
  });

  const gapClusterRollups = (gapClusters || []).slice(0, 50).map((cluster) => ({
    id: cluster.id,
    label: cluster.label || cluster.draftLabel || cluster.id,
    gapCount: cluster.gapCount ?? cluster.memberCount ?? 0,
    status: cluster.status || "draft",
    updatedAt: cluster.updatedAt || cluster.createdAt,
  }));

  await writeReadModel(
    "orgMetrics",
    orgId,
    {
      orgId,
      teamMetrics,
      seRows,
      isOrgView: true,
      gapClusterRollups,
      themeHeatmap: managerView.themeHeatmap,
      managerView,
      trendBuckets: teamMetrics.trendByType,
      callCount: summaries.length,
    },
    sourceUpdatedAt,
    env,
  );

  const teamIds = [...new Set(users.map((u) => String(u.teamId || "")).filter(Boolean))];
  await Promise.all(teamIds.map((teamId) => rebuildTeamMetrics(teamId, sourceUpdatedAt, env)));
}
