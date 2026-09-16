import type { FirestoreEnv } from "../firestore-admin";
import { getDeal, listDealsByAccount } from "../repositories/deals";
import { listDealSignalsByDeal } from "../repositories/signals";
import { listCallSummariesByDeal } from "../repositories/call-summaries";
import { writeReadModel } from "./write";

export async function rebuildDealTraction(
  dealId: string,
  sourceUpdatedAt: number,
  env?: FirestoreEnv,
): Promise<void> {
  if (!dealId) return;

  const deal = await getDeal(dealId, env);
  if (!deal) return;

  const [signals, callSummaries] = await Promise.all([
    listDealSignalsByDeal(dealId, 5, env),
    listCallSummariesByDeal(dealId, 12, env),
  ]);

  const latest = signals[0] || null;
  const daysSilent = latest?.daysSilent ?? null;
  const traction = latest?.traction ?? null;

  await writeReadModel(
    "dealTraction",
    dealId,
    {
      dealId,
      accountId: deal.accountId || null,
      teamId: deal.teamId || null,
      orgId: deal.orgId || null,
      traction,
      daysSilent,
      daysInStage: latest?.daysInStage ?? null,
      stageMedianDays: latest?.stageMedianDays ?? null,
      recommendedAction: latest?.recommendedAction ?? null,
      reasonsJson: latest?.reasonsJson ?? null,
      nextStepOwner: latest?.nextStepOwner ?? null,
      latestSignalCallId: latest?.callId ?? null,
      latestSignalAt: latest?.createdAt ?? latest?.updatedAt ?? null,
      callCount: callSummaries.length,
      dealStage: deal.stage ?? null,
      dealStatus: deal.status ?? null,
    },
    sourceUpdatedAt,
    env,
  );
}

/** Rebuild traction for every deal on an account (after account-scoped writes). */
export async function rebuildDealTractionForAccount(
  accountId: string,
  sourceUpdatedAt: number,
  env?: FirestoreEnv,
): Promise<void> {
  const deals = await listDealsByAccount(accountId, undefined, env);
  await Promise.all(deals.map((deal) => rebuildDealTraction(String(deal.id), sourceUpdatedAt, env)));
}
