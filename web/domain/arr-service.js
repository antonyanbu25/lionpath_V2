/**
 * Persist post-call ARR compute (task 2.5b) — arr_lines, Deal estimate columns, call snapshot,
 * account session allowance (ADDON_ARR §3–§4, spec §7.7).
 */

import { getStore } from "./store.js";
import { newId, now } from "./types.js";

const SESSIONS_ADDON = "freddy_ai_agent_sessions";

/** @param {object[]} allLines */
export function selectLatestArrLines(allLines) {
  if (!allLines?.length) return [];
  /** @type {Map<string, object[]>} */
  const byCall = new Map();
  for (const line of allLines) {
    const key = line.callId || "";
    const bucket = byCall.get(key) || [];
    bucket.push(line);
    byCall.set(key, bucket);
  }
  let best = [];
  let bestAt = -1;
  for (const bucket of byCall.values()) {
    const at = Math.max(...bucket.map((l) => l.computedAt || 0));
    if (at > bestAt) {
      bestAt = at;
      best = bucket;
    }
  }
  return best.slice().sort((a, b) => {
    if (a.kind === "base" && b.kind !== "base") return -1;
    if (b.kind === "base" && a.kind !== "base") return 1;
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    return String(a.addonKey || "").localeCompare(String(b.addonKey || ""));
  });
}

/** @param {object} computeResult runPostCallArrCompute output */
function dealUsesSessions(computeResult) {
  return (computeResult?.lines || []).some(
    (l) =>
      l.addonKey === SESSIONS_ADDON &&
      (l.inScope || l.annualValue > 0 || l.exclusionReason === "not_quantified"),
  );
}

/** @param {object} line */
function existingLineUsesSessions(line) {
  return (
    line?.addonKey === SESSIONS_ADDON &&
    (line.inScope || (line.annualValue ?? 0) > 0 || line.exclusionReason === "not_quantified")
  );
}

/**
 * Whether the account's 500-session allowance was already consumed by another deal.
 * @param {ReturnType<import("./store.js").getStore>} store
 * @param {string} accountId
 * @param {string} dealId
 */
export async function accountAllowanceConsumedForDeal(store, accountId, dealId) {
  if (!accountId || !dealId) return false;
  const consumer = await resolveAllowanceConsumerDealId(store, accountId, dealId, null);
  return !!consumer && consumer !== dealId;
}

/**
 * Earliest-created deal on the account that uses AI Agent sessions.
 * @param {ReturnType<import("./store.js").getStore>} store
 * @param {string} accountId
 * @param {string} currentDealId
 * @param {object|null} computeResult
 */
export async function resolveAllowanceConsumerDealId(store, accountId, currentDealId, computeResult) {
  if (!accountId || !store.listDealsByAccount) return null;

  const account = store.getAccount ? await store.getAccount(accountId) : null;
  const pinned = account?.metadata?.arrSessionAllowanceDealId;
  if (pinned) return pinned;

  const deals = (await store.listDealsByAccount(accountId))
    .slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  for (const deal of deals) {
    if (deal.id === currentDealId) {
      if (computeResult && dealUsesSessions(computeResult)) return deal.id;
      continue;
    }
    if (!store.listArrLinesByDeal) continue;
    const lines = await store.listArrLinesByDeal(deal.id);
    if ((lines || []).some(existingLineUsesSessions)) return deal.id;
  }
  return null;
}

/**
 * Map evidence onto a compute line from extracted inputs.
 * @param {object} line
 * @param {object} inputs normalized arr inputs draft
 */
function evidenceForLine(line, inputs) {
  if (line.kind === "base") {
    return inputs?.agentsEvidence || inputs?.evidence || null;
  }
  if (line.addonKey === SESSIONS_ADDON) {
    return inputs?.conversationVolume?.evidence || null;
  }
  const addon = (inputs?.addons || []).find((a) => a.addonKey === line.addonKey);
  return addon?.evidence || null;
}

/**
 * @param {object} line compute line
 * @param {object} inputs
 * @param {string} priceBookVersion
 * @param {string} assumptionsBookVersion
 * @param {number} computedAt
 * @param {object} ctx
 */
function toArrLineDoc(line, inputs, priceBookVersion, assumptionsBookVersion, computedAt, ctx) {
  const exclusionReason =
    line.tierConflict && line.excluded ? "tier_conflict" : line.exclusionReason || null;

  return {
    id: newId("arrLine"),
    dealId: ctx.dealId,
    accountId: ctx.accountId,
    callId: ctx.callId,
    kind: line.kind,
    addonKey: line.addonKey ?? null,
    quantity: line.quantity ?? null,
    unit: line.unit ?? null,
    unitPrice: line.unitPrice ?? null,
    priceBookVersion,
    assumptionsBookVersion,
    annualValue: line.annualValue ?? 0,
    recurring: !!line.recurring,
    stated: !!line.stated,
    inScope: !!line.inScope,
    excluded: !!line.excluded,
    exclusionReason,
    tierConflict: !!line.tierConflict,
    confidence: line.confidence ?? null,
    evidence: evidenceForLine(line, inputs),
    derivationJson: line.derivationJson || [],
    computedAt,
    ownerId: ctx.ownerId,
    teamId: ctx.teamId || "",
    orgId: ctx.orgId || "",
    createdAt: computedAt,
    updatedAt: computedAt,
  };
}

/**
 * @param {object} computeResult PostCallArrComputeResult from worker
 * @param {{ callId: string, dealId: string, accountId: string, ownerId: string, teamId: string, orgId: string }} ctx
 */
export async function persistArrLines(computeResult, ctx) {
  if (!ctx?.callId || !ctx?.dealId || !computeResult?.lines) return [];

  const store = getStore();
  const existing = store.listArrLinesByCall ? await store.listArrLinesByCall(ctx.callId) : [];
  for (const prev of existing || []) {
    if (store.deleteArrLine) await store.deleteArrLine(prev.id);
  }

  const computedAt = now();
  const priceBookVersion = computeResult.priceBookVersion || "";
  const assumptionsBookVersion =
    computeResult.assumptionsBookVersion || computeResult.priceBookVersion || "";
  const inputs = computeResult.inputs || {};

  const rows = [];
  for (const line of computeResult.lines) {
    const row = toArrLineDoc(line, inputs, priceBookVersion, assumptionsBookVersion, computedAt, ctx);
    if (store.upsertArrLine) await store.upsertArrLine(row);
    rows.push(row);
  }
  return rows;
}

/**
 * @param {string} accountId
 * @param {string} dealId
 * @param {object|null} computeResult
 */
export async function syncAccountSessionAllowance(accountId, dealId, computeResult) {
  if (!accountId || !dealId || !computeResult || !dealUsesSessions(computeResult)) return null;

  const store = getStore();
  if (!store.getAccount || !store.updateAccount) return null;

  const account = await store.getAccount(accountId);
  if (!account) return null;
  if (account.metadata?.arrSessionAllowanceDealId) return account.metadata.arrSessionAllowanceDealId;

  const consumer = await resolveAllowanceConsumerDealId(store, accountId, dealId, computeResult);
  if (!consumer) return null;

  await store.updateAccount(accountId, {
    metadata: {
      ...(account.metadata || {}),
      arrSessionAllowanceDealId: consumer,
    },
  });
  return consumer;
}

/**
 * @param {string} callId
 * @param {object} computeResult
 */
export async function persistCallArrSnapshot(callId, computeResult) {
  if (!callId || !computeResult) return null;

  const store = getStore();
  const computedAt = now();
  const priceBookVersion = computeResult.priceBookVersion || "";
  const assumptionsBookVersion =
    computeResult.assumptionsBookVersion || computeResult.priceBookVersion || "";

  const arrSnapshot = {
    arrEstimatePoint: computeResult.arrPoint ?? null,
    arrEstimateLow: computeResult.arrLow ?? null,
    arrEstimateHigh: computeResult.arrHigh ?? null,
    priceBookVersion,
    assumptionsBookVersion,
    computedAt,
    lines: (computeResult.lines || []).map((line) => ({
      kind: line.kind,
      addonKey: line.addonKey ?? null,
      product: line.product ?? null,
      tier: line.tier ?? null,
      quantity: line.quantity ?? null,
      unit: line.unit ?? null,
      unitPrice: line.unitPrice ?? null,
      annualValue: line.annualValue ?? 0,
      recurring: !!line.recurring,
      stated: !!line.stated,
      inScope: !!line.inScope,
      excluded: !!line.excluded,
      exclusionReason: line.exclusionReason ?? null,
      tierConflict: !!line.tierConflict,
      confidence: line.confidence ?? null,
    })),
  };

  const postCall = store.getPostCall ? await store.getPostCall(callId) : null;
  if (!postCall || !store.upsertPostCall) return arrSnapshot;

  await store.upsertPostCall({
    ...postCall,
    arrSnapshot,
    updatedAt: computedAt,
  });
  return arrSnapshot;
}

/**
 * @param {string} dealId
 * @param {object} computeResult
 * @param {import("./types.js").Deal|null} existingDeal
 */
export async function persistDealArrEstimate(dealId, computeResult, existingDeal) {
  if (!dealId || !computeResult) return null;

  const store = getStore();
  const deal = existingDeal || (await store.getDeal(dealId));
  if (!deal) return null;

  const computedAt = now();
  const priceBookVersion = computeResult.priceBookVersion || null;
  const assumptionsBookVersion =
    computeResult.assumptionsBookVersion || computeResult.priceBookVersion || null;

  /** @type {Partial<import("./types.js").Deal>} */
  const patch = {
    arrEstimateLow: computeResult.arrLow ?? null,
    arrEstimateHigh: computeResult.arrHigh ?? null,
    arrEstimatePoint: computeResult.arrPoint ?? null,
    arrSource:
      deal.arrSource === "se_override" || deal.arrSource === "opp_amount"
        ? deal.arrSource
        : computeResult.arrPoint != null
          ? "derived_from_agents"
          : deal.arrSource ?? null,
    arrPriceBookVersion: priceBookVersion,
    assumptionsBookVersion,
    arrInputsJson: computeResult.inputs ?? null,
    arrComputedAt: computedAt,
    lastActivityAt: computedAt,
  };

  return store.updateDeal(dealId, patch);
}

/**
 * Full post-call ARR write path — invoked from dual-write after attachPostCall (same lifecycle as
 * bumpDealAfterPostCall / rollupDealTractionAfterPostCall).
 *
 * @param {string} dealId
 * @param {object} computeResult runPostCallArrCompute output
 * @param {{ callId: string, accountId: string, ownerId: string, teamId: string, orgId: string }} ctx
 */
export async function persistArrAfterPostCall(dealId, computeResult, ctx) {
  if (!dealId || !computeResult || !ctx?.callId) return null;

  const store = getStore();
  const deal = await store.getDeal(dealId);
  if (!deal || (ctx.accountId && deal.accountId !== ctx.accountId)) return null;

  const persistCtx = { ...ctx, dealId, accountId: ctx.accountId || deal.accountId };

  const lines = await persistArrLines(computeResult, persistCtx);
  const updatedDeal = await persistDealArrEstimate(dealId, computeResult, deal);
  const arrSnapshot = await persistCallArrSnapshot(ctx.callId, computeResult);
  const allowanceDealId = await syncAccountSessionAllowance(
    persistCtx.accountId,
    dealId,
    computeResult,
  );

  return { deal: updatedDeal, lines, arrSnapshot, allowanceDealId };
}
