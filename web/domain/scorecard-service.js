/**
 * Persist Pass 3 QIP drafts to scorecards / scorecardLines collections.
 */

import { getStore } from "./store.js";
import { newId, now } from "./types.js";

/**
 * @param {object} draft — ScorecardDraft from worker
 * @param {{ callId: string, ownerId: string, teamId: string, orgId: string, accountId: string }} ctx
 */
export async function persistScorecardDraft(draft, ctx) {
  if (!draft?.lines?.length || !ctx?.callId || !ctx?.ownerId) return null;

  const store = getStore();
  const existing = store.listScorecardsByCall
    ? await store.listScorecardsByCall(ctx.callId)
    : [];
  // One scorecard per call — replace prior draft lines if re-analyzed
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
    rubricId: draft.rubricId,
    rawScore: draft.rawScore,
    denominator: draft.denominator,
    confidence: draft.confidence ?? null,
    provisional: !!draft.provisional,
    ownerId: ctx.ownerId,
    teamId: ctx.teamId || "",
    orgId: ctx.orgId || "",
    accountId: ctx.accountId || "",
    callType: draft.callType,
    rubricVersion: draft.rubricVersion || "1.0",
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
      score: line.score,
      maxScore: line.maxScore ?? 100,
      applicable: !!line.applicable,
      notApplicableReason: line.notApplicableReason || null,
      confidence: line.confidence ?? null,
      evidenceJson: line.evidence || line.evidenceJson || [],
      coachingNote: line.coachingNote || null,
      weight: line.weight,
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
 * Team heatmap query helper — excludes provisional and non-applicable lines (§6.6).
 * @param {string} teamId
 * @param {string} themeKey
 */
export async function averageThemeScoreForTeam(teamId, themeKey) {
  const store = getStore();
  if (!store.listScorecardLinesByTeamTheme) return null;
  const rows = await store.listScorecardLinesByTeamTheme(teamId, themeKey);
  const eligible = (rows || []).filter((r) => {
    if (!r.applicable) return false;
    // Join provisional via parent scorecard when available
    if (r.provisional) return false;
    return true;
  });
  if (!eligible.length) return null;
  const sum = eligible.reduce((acc, r) => acc + (r.score || 0), 0);
  return Math.round((sum / eligible.length) * 10) / 10;
}
