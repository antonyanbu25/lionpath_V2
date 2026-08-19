/**
 * Persist Pass 3 QIP drafts to scorecards / scorecardLines collections (v2.1).
 */

import { getStore } from "./store.js";
import { newId, now } from "./types.js";

/**
 * @param {object} draft — ScorecardDraft from worker
 * @param {{ callId: string, ownerId: string, teamId: string, orgId: string, accountId: string, dealId?: string|null }} ctx
 */
export async function persistScorecardDraft(draft, ctx) {
  if (!draft?.lines?.length || !ctx?.callId || !ctx?.ownerId) return null;

  const store = getStore();
  const existing = store.listScorecardsByCall
    ? await store.listScorecardsByCall(ctx.callId)
    : [];
  for (const prev of existing || []) {
    if (store.deleteScorecardLinesByScorecardId) {
      await store.deleteScorecardLinesByScorecardId(prev.id);
    }
    if (store.deleteScorecard) {
      await store.deleteScorecard(prev.id);
    }
  }

  const ts = now();
  const scorecardId = newId("scorecard");
  const scorecard = {
    id: scorecardId,
    callId: ctx.callId,
    dealId: ctx.dealId || null,
    rubricId: draft.rubricId,
    overall: draft.overall,
    totalCredits: draft.totalCredits,
    includedCredits: draft.includedCredits,
    categoryScores: draft.categoryScores || {},
    confidence: draft.confidence ?? null,
    provisional: !!draft.provisional,
    dealRiskFlags: draft.dealRiskFlags || [],
    // v2.2 leadership cap — additive fields, see worker/src/postcall/scorecard.ts
    // ScorecardDraft.leadershipShareable / verifierJustifications. Omitted (false/[]) on
    // scorecards that never crossed the cap; historical records without these keys are
    // unaffected (see web/quality-score.js applyLeadershipCap).
    leadershipShareable: !!draft.leadershipShareable,
    verifierJustifications: draft.verifierJustifications || [],
    ownerId: ctx.ownerId,
    teamId: ctx.teamId || "",
    orgId: ctx.orgId || "",
    accountId: ctx.accountId || "",
    callType: draft.callType,
    rubricVersion: draft.rubricVersion || "2.1",
    createdAt: ts,
    updatedAt: ts,
  };

  await store.upsertScorecard(scorecard);

  const lines = [];
  for (const line of draft.lines) {
    const row = {
      id: newId("scorecardLine"),
      scorecardId,
      callId: ctx.callId,
      themeKey: line.themeKey,
      subParameters: line.subParameters || [],
      grade: line.grade,
      credit: line.credit,
      category: line.category,
      evidenceUnavailable: !!line.evidenceUnavailable,
      confidence: line.confidence ?? null,
      coachingNote: line.coachingNote || null,
      ownerId: ctx.ownerId,
      teamId: ctx.teamId || "",
      orgId: ctx.orgId || "",
    };
    await store.upsertScorecardLine(row);
    lines.push(row);
  }

  return { scorecard, lines };
}

/**
 * Team heatmap query helper — excludes provisional and evidence-unavailable lines.
 * @param {string} teamId
 * @param {string} themeKey
 */
export async function averageThemeScoreForTeam(teamId, themeKey) {
  const store = getStore();
  if (!store.listScorecardLinesByTeamTheme) return null;
  const rows = await store.listScorecardLinesByTeamTheme(teamId, themeKey);
  const eligible = (rows || []).filter((r) => {
    if (r.evidenceUnavailable) return false;
    if (r.provisional) return false;
    return true;
  });
  if (!eligible.length) return null;
  const sum = eligible.reduce((acc, r) => acc + (r.grade ?? r.score ?? 0), 0);
  return Math.round((sum / eligible.length) * 100) / 100;
}
