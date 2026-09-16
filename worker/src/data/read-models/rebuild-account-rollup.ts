import { getAll, queryBy, type FirestoreDoc, type FirestoreEnv } from "../firestore-admin";
import { getAccount } from "../repositories/accounts";
import { listDealsByAccount, getTechnicalCommitByDeal } from "../repositories/deals";
import { listCallSummariesByAccount } from "../repositories/call-summaries";
import { listDealSignalsForDeals, listArrLinesForDeals } from "../repositories/signals";
import { buildAccountArrRollupPayload, formatProductLabel } from "./arr-rollup";
import { writeReadModel } from "./write";

const DEAL_TYPE_LABELS: Record<string, string> = {
  new_business: "New business",
  expansion: "Expansion",
};

function userDisplayFields(user: FirestoreDoc | null | undefined) {
  if (!user) return { id: "", displayName: "Unknown", jobTitle: null, avatarDataUrl: null };
  return {
    id: user.id,
    displayName: String(user.displayName || user.email || "Unknown"),
    jobTitle: (user.jobTitle as string | null) || null,
    avatarDataUrl: (user.avatarDataUrl as string | null) || null,
  };
}

function tractionSortRank(traction: string | null | undefined): number {
  const rank: Record<string, number> = { hot: 0, warm: 1, cold: 2 };
  return rank[String(traction || "")] ?? 2;
}

export async function rebuildAccountRollup(
  accountId: string,
  sourceUpdatedAt: number,
  env?: FirestoreEnv,
): Promise<void> {
  if (!accountId) return;

  const account = await getAccount(accountId, env);
  if (!account) return;

  const deals = await listDealsByAccount(accountId, undefined, env);
  const dealIds = deals.map((d) => String(d.id));
  const [signalsByDeal, arrByDeal, callSummaries] = await Promise.all([
    listDealSignalsForDeals(dealIds, 1, env),
    listArrLinesForDeals(dealIds, env),
    listCallSummariesByAccount(accountId, 100, env),
  ]);

  const seTeam = Array.isArray(account.seTeam) ? account.seTeam : [];
  const userIds = seTeam.map((m: { seUserId?: string }) => m.seUserId).filter(Boolean) as string[];
  const users = userIds.length ? await getAll("users", userIds, env) : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const seTeamDisplay = seTeam.map((member: { seUserId?: string; role?: string; addedAt?: number }) => ({
    ...member,
    user: userDisplayFields(userById.get(String(member.seUserId || ""))),
  }));

  const activeNb = deals.find((d) => d.type === "new_business" && d.status === "active");
  const activeExp = deals.find((d) => d.type === "expansion" && d.status === "active");
  const canonicalDeal = activeNb || activeExp || deals[0] || null;
  const dealType = String(canonicalDeal?.type || "new_business");
  const dealStage = canonicalDeal?.stage || null;

  const arrRollup = buildAccountArrRollupPayload(account, deals, arrByDeal);
  const linesByDealId = new Map(Object.entries(arrRollup.linesByDealId));

  const dealRows = deals.map((deal) => {
    const signal = (signalsByDeal.get(String(deal.id)) || [])[0] || null;
    const lines = linesByDealId.get(String(deal.id)) || [];
    const base = (lines as FirestoreDoc[]).find((l) => l.kind === "base" && !l.excluded);
    const primary = seTeamDisplay.find((m: { role?: string }) => m.role === "primary") || seTeamDisplay[0];
    return {
      deal,
      arrPoint: deal.arrEstimatePoint ?? null,
      arrLow: deal.arrEstimateLow ?? deal.arrEstimatePoint ?? null,
      arrHigh: deal.arrEstimateHigh ?? deal.arrEstimatePoint ?? null,
      productLabel: formatProductLabel(String(base?.product || deal.product || "")),
      traction: signal?.traction || null,
      primarySeName: primary?.user?.displayName || "-",
    };
  });

  const accountCalls = callSummaries.map((summary) => {
    const deal = deals.find((d) => d.id === summary.dealId);
    const ownerMember = seTeamDisplay.find((m: { seUserId?: string }) => m.seUserId === summary.ownerId);
    return {
      postCall: summary,
      deal: deal || null,
      dealLabel: summary.dealTitle || deal?.title || (deal ? DEAL_TYPE_LABELS[String(deal.type)] : "-"),
      meddpiccScore: null,
      scorecard:
        summary.qipOverall != null || summary.qipCategoryScores
          ? {
              overall: summary.qipOverall ?? summary.qualityScore ?? null,
              categoryScores: summary.qipCategoryScores || {},
            }
          : null,
      ownerName: summary.ownerName || ownerMember?.user?.displayName || seTeamDisplay[0]?.user?.displayName || "-",
    };
  });

  accountCalls.sort(
    (a, b) => Number(b.postCall.createdAt || 0) - Number(a.postCall.createdAt || 0),
  );

  const meta = (account.metadata as Record<string, unknown>) || {};
  const firmographics = {
    industry: account.industry || meta.industry || "-",
    region: meta.region || "-",
    subRegion: meta.sub_region || meta.subRegion || "-",
    hq: meta.hq || meta.headquarters || "-",
    supportAgents: meta.support_agent_count ?? meta.supportAgentCount ?? "-",
    incumbent: meta.incumbent || "-",
    competitor: meta.competitor || "Unknown",
  };

  let reasonForEvaluation = meta.reason_for_evaluation || meta.reasonForEvaluation || null;
  let whyAi = meta.why_ai || meta.whyAi || null;
  if (!reasonForEvaluation || !whyAi) {
    for (const deal of deals) {
      const tc = await getTechnicalCommitByDeal(String(deal.id), env);
      if (!reasonForEvaluation && tc?.reasonForEvaluation) {
        const rfe = tc.reasonForEvaluation as { value?: unknown } | string;
        reasonForEvaluation = typeof rfe === "object" && rfe && "value" in rfe ? (rfe.value as {} | null) : (rfe as {} | null);
      }
      if (!whyAi && tc?.whyAi) {
        const wa = tc.whyAi as { value?: unknown } | string;
        whyAi = typeof wa === "object" && wa && "value" in wa ? (wa.value as {} | null) : (wa as {} | null);
      }
      if (reasonForEvaluation && whyAi) break;
    }
  }

  const activeDeals = deals.filter((d) => d.status === "active");
  let worstTraction: string | null = null;
  let maxDaysSilent: number | null = null;
  for (const deal of activeDeals) {
    const signal = (signalsByDeal.get(String(deal.id)) || [])[0];
    if (signal?.traction) {
      if (!worstTraction || tractionSortRank(String(signal.traction)) > tractionSortRank(worstTraction)) {
        worstTraction = String(signal.traction);
      }
    }
    if (typeof signal?.daysSilent === "number") {
      maxDaysSilent = Math.max(maxDaysSilent ?? 0, signal.daysSilent);
    }
  }

  const listRow = {
    seTeamDisplay,
    secondaryCount: seTeam.filter((m: { role?: string }) => m.role === "secondary").length,
    dealType,
    dealTypeLabel: DEAL_TYPE_LABELS[dealType] || dealType,
    dealStage,
    deals: deals.filter((d) => d.status === "active"),
    canonicalDealId: canonicalDeal?.id || null,
    lastActivityAt: Math.max(
      ...deals.map((d) => Number(d.lastActivityAt || d.updatedAt || 0)),
      ...callSummaries.map((c) => Number(c.createdAt || 0)),
      0,
    ),
  };

  const detail = {
    arrRollup: {
      ...arrRollup,
      linesByDealId: arrRollup.linesByDealId,
    },
    dealRows,
    accountCalls,
    firmographics,
    reasonForEvaluation,
    whyAi,
    hasEconomicBuyer: false,
    health: worstTraction === "cold" ? "at_risk" : "healthy",
    callCount: accountCalls.length,
    dealCount: activeDeals.length || deals.length,
    worstTraction,
    maxDaysSilent,
  };

  await writeReadModel(
    "accountRollup",
    accountId,
    {
      accountId,
      listRow,
      detail,
    },
    sourceUpdatedAt,
    env,
  );
}
