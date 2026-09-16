/**
 * Persist Pass 4 qualification to Deal.metadata.meddpicc and meddpiccDeltas.
 */

import { getStore } from "./store.js";
import {
  buildMeddpiccDeltaDrafts,
  meddpiccSignalsFromQualification,
  mergeMeddpiccIntoMeta,
} from "./contact-service.js";
import { newId, now } from "./types.js";

export { meddpiccSignalsFromQualification, buildMeddpiccDeltaDrafts } from "./contact-service.js";

/**
 * @param {object[]} deltaDrafts
 * @param {{ callId: string, dealId: string, ownerId: string, teamId: string, orgId: string, accountId: string }} ctx
 * @returns {object[]}
 */
export function buildMeddpiccDeltasDetail(deltaDrafts, ctx) {
  if (!ctx?.callId || !ctx?.dealId || !ctx?.ownerId) return [];
  const ts = now();
  const rows = [];
  for (const draft of deltaDrafts || []) {
    if (!draft?.slot || !draft?.current) continue;
    rows.push({
      id: newId("meddpiccDelta"),
      callId: ctx.callId,
      dealId: ctx.dealId,
      slot: draft.slot,
      previous: draft.previous ?? null,
      current: draft.current,
      changeType: draft.changeType || "confirmed",
      evidence: draft.evidence || "not surfaced",
      ownerId: ctx.ownerId,
      teamId: ctx.teamId || "",
      orgId: ctx.orgId || "",
      accountId: ctx.accountId || "",
      createdAt: ts,
      updatedAt: ts,
    });
  }
  return rows;
}

export async function persistMeddpiccDeltas(deltaDrafts, ctx) {
  const rows = buildMeddpiccDeltasDetail(deltaDrafts, ctx);
  if (!rows.length) return [];

  const store = getStore();
  const existing = store.listMeddpiccDeltasByCall
    ? await store.listMeddpiccDeltasByCall(ctx.callId)
    : [];
  for (const prev of existing || []) {
    if (store.deleteMeddpiccDelta) await store.deleteMeddpiccDelta(prev.id);
  }
  for (const row of rows) {
    await store.upsertMeddpiccDelta(row);
  }
  return rows;
}

/**
 * Full Pass 4 write path: deal merge + delta collection (or embed-only when opts.embedOnly).
 * @param {string} dealId
 * @param {string} accountId
 * @param {object} qualification
 * @param {{ callId: string, ownerId: string, teamId: string, orgId: string, accountId: string }} ctx
 * @param {{ embedOnly?: boolean }} [opts]
 */
export async function applyQualificationToDeal(dealId, accountId, qualification, ctx, opts = {}) {
  if (!qualification || !ctx?.callId) return { deal: null, deltas: [] };

  const signals = meddpiccSignalsFromQualification(qualification);
  if (!Object.keys(signals).length) return { deal: null, deltas: [] };

  if (!dealId) {
    console.warn("[meddpicc] skipped qualify write: missing dealId for account", accountId);
    return { deal: null, deltas: [] };
  }

  const store = getStore();
  let deal = await store.getDeal(dealId);
  if (!deal || deal.accountId !== accountId) return { deal: null, deltas: [] };

  const previousMeddpicc = deal.metadata?.meddpicc || {};
  const deltaDrafts = buildMeddpiccDeltaDrafts(dealId, ctx.callId, previousMeddpicc, qualification);
  const metadata = mergeMeddpiccIntoMeta(deal.metadata, signals, "postcall");
  deal = await store.updateDeal(dealId, { metadata });

  const deltas = opts.embedOnly
    ? buildMeddpiccDeltasDetail(deltaDrafts, { ...ctx, dealId, accountId })
    : await persistMeddpiccDeltas(deltaDrafts, { ...ctx, dealId, accountId });

  return { deal, deltas };
}
