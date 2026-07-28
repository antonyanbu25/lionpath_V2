/**
 * Persist Pass 8 traction rollup to deal_signals (spec §10).
 */

import { getStore } from "./store.js";
import { newId, now } from "./types.js";
import {
  computeDealTraction,
  daysSince,
  median,
  STAGE_MEDIAN_DAYS_DEFAULT,
} from "./deal-traction.js";

/**
 * Days since the deal entered its current stage (from lifecycle events).
 * @param {import("./store.js").ReturnType<typeof import("./store.js").getStore>} store
 * @param {import("./types.js").Deal} deal
 */
export async function computeDaysInStage(store, deal) {
  const lc = store.findLifecycleByDealAndOwner
    ? await store.findLifecycleByDealAndOwner(deal.id, deal.ownerId)
    : null;
  if (!lc || !store.listLifecycleEvents) {
    return daysSince(deal.updatedAt || deal.createdAt);
  }
  const events = await store.listLifecycleEvents(lc.id);
  const entered = (events || [])
    .filter((e) => e.type === "stage_changed" && e.payload?.toStage === deal.stage)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  return daysSince(entered?.timestamp || deal.updatedAt || deal.createdAt);
}

/**
 * Median days spent in `stage` across closed deals on the same account (empirical or default).
 * @param {import("./store.js").ReturnType<typeof import("./store.js").getStore>} store
 * @param {string} accountId
 * @param {import("./types.js").LifecycleStage} stage
 */
export async function computeStageMedianDays(store, accountId, stage) {
  const deals = store.listDealsByAccount ? await store.listDealsByAccount(accountId) : [];
  /** @type {number[]} */
  const durations = [];

  for (const d of deals) {
    if (d.stage !== "closed_won" && d.stage !== "closed_lost") continue;
    const lc = store.findLifecycleByDealAndOwner
      ? await store.findLifecycleByDealAndOwner(d.id, d.ownerId)
      : null;
    if (!lc || !store.listLifecycleEvents) continue;

    const events = (await store.listLifecycleEvents(lc.id)).slice().sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type !== "stage_changed" || e.payload?.toStage !== stage) continue;
      const endTs =
        events.slice(i + 1).find((x) => x.type === "stage_changed")?.timestamp ||
        d.updatedAt ||
        d.lastActivityAt;
      durations.push(daysSince(e.timestamp, endTs));
      break;
    }
  }

  const m = median(durations);
  if (m != null && durations.length >= 2) return Math.round(m);
  return STAGE_MEDIAN_DAYS_DEFAULT[stage] ?? 21;
}

/**
 * @param {string} dealId
 * @param {object} ctx
 */
export async function computeAndPersistDealSignal(dealId, ctx) {
  if (!dealId || !ctx?.callId) return null;

  const store = getStore();
  const deal = await store.getDeal(dealId);
  if (!deal) return null;

  const followUps = store.listFollowUpsByCall ? await store.listFollowUpsByCall(ctx.callId) : [];
  const objections = store.listObjectionsByCall ? await store.listObjectionsByCall(ctx.callId) : [];
  const videoFacts = store.listVideoFactsByCall ? (await store.listVideoFactsByCall(ctx.callId))[0] : null;

  const priorCalls = store.listPostCallsByDeal ? await store.listPostCallsByDeal(dealId, 12) : [];
  const priorMomentum = (priorCalls || [])
    .filter((p) => p.id !== ctx.callId)
    .map((p) => ({
      callId: p.id,
      createdAt: p.createdAt || p.updatedAt,
      momentum: p.analysis?.momentum,
    }));

  const daysInStage = await computeDaysInStage(store, deal);
  const stageMedianDays = await computeStageMedianDays(store, deal.accountId, deal.stage);

  let technicalCommit = ctx.technicalCommit || null;
  if (!technicalCommit && store.getTechnicalCommitByDeal) {
    technicalCommit = await store.getTechnicalCommitByDeal(dealId);
  }

  const rollup = computeDealTraction({
    deal,
    analysis: ctx.analysis || {},
    followUps,
    objections,
    videoFacts,
    technicalCommit,
    priorCalls: priorMomentum,
    callId: ctx.callId,
    callCreatedAt: ctx.callCreatedAt ?? now(),
    daysInStage,
    stageMedianDays,
  });

  const ts = now();
  const existing = store.listDealSignalsByCall ? await store.listDealSignalsByCall(ctx.callId) : [];
  for (const prev of existing || []) {
    if (store.deleteDealSignal) await store.deleteDealSignal(prev.id);
  }

  const row = {
    id: newId("dealSignal"),
    callId: ctx.callId,
    dealId,
    traction: rollup.traction,
    reasonsJson: rollup.reasonsJson,
    recommendedAction: rollup.recommendedAction,
    daysSilent: rollup.daysSilent,
    nextStepOwner: rollup.nextStepOwner,
    daysInStage: rollup.daysInStage,
    stageMedianDays: rollup.stageMedianDays,
    ownerId: ctx.ownerId || deal.ownerId,
    teamId: ctx.teamId || deal.teamId,
    orgId: ctx.orgId || deal.orgId || "",
    accountId: ctx.accountId || deal.accountId,
    createdAt: ts,
    updatedAt: ts,
  };

  if (!store.upsertDealSignal) return rollup;
  await store.upsertDealSignal(row);
  return { ...rollup, row };
}
