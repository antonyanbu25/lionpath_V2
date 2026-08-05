/**
 * Persist Pass 5 technical commit to technicalCommits (one snapshot per deal) and tcDeltas.
 *
 * The snapshot merges — a call that never mentioned the incumbent must not erase what an
 * earlier call established. Deltas are replaced per call so a re-run does not double up.
 */

import { getStore } from "./store.js";
import { newId, now } from "./types.js";

const TC_SLOT_KEYS = [
  "incumbent",
  "competitor",
  "identifiedRisk",
  "timelineForClosure",
  "reasonForEvaluation",
  "whatsWorking",
];

/**
 * Fields the call surfaced win; silent fields fall through to the prior snapshot.
 * @param {object|null} previous
 * @param {object} draft
 */
export function mergeTechnicalCommit(previous, draft) {
  const merged = { ...(previous || {}) };
  for (const key of TC_SLOT_KEYS) {
    if (draft?.[key]) merged[key] = draft[key];
    else if (!(key in merged)) merged[key] = null;
  }
  if (draft?.aiAttach) merged.aiAttach = draft.aiAttach;
  else if (!("aiAttach" in merged)) merged.aiAttach = null;

  if (draft?.status) merged.status = draft.status;
  if (draft?.justification) merged.justification = draft.justification;
  else if (!("justification" in merged)) merged.justification = null;

  return merged;
}

/**
 * @param {object[]} deltaDrafts
 * @param {{ callId: string, dealId: string, ownerId: string, teamId: string, orgId: string, accountId: string }} ctx
 * @returns {object[]}
 */
export function buildTcDeltasDetail(deltaDrafts, ctx) {
  if (!ctx?.callId || !ctx?.ownerId) return [];
  const ts = now();
  const rows = [];
  for (const draft of deltaDrafts || []) {
    if (!draft?.field || draft.current == null) continue;
    rows.push({
      id: newId("tcDelta"),
      callId: ctx.callId,
      dealId: ctx.dealId || null,
      field: draft.field,
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

export async function persistTcDeltas(deltaDrafts, ctx) {
  const rows = buildTcDeltasDetail(deltaDrafts, ctx);
  if (!rows.length) return [];

  const store = getStore();
  const existing = store.listTcDeltasByCall ? await store.listTcDeltasByCall(ctx.callId) : [];
  for (const prev of existing || []) {
    if (store.deleteTcDelta) await store.deleteTcDelta(prev.id);
  }
  for (const row of rows) {
    await store.upsertTcDelta(row);
  }
  return rows;
}

/**
 * Full Pass 5 write path: deal-scoped snapshot merge + per-call deltas (embed or collection).
 * @param {string} dealId
 * @param {string} accountId
 * @param {object} technicalCommit
 * @param {object[]} tcDeltas
 * @param {{ callId: string, ownerId: string, teamId: string, orgId: string }} ctx
 * @param {{ embedOnly?: boolean }} [opts]
 */
export async function applyTechnicalCommitToDeal(dealId, accountId, technicalCommit, tcDeltas, ctx, opts = {}) {
  if (!technicalCommit || !ctx?.callId) return { technicalCommit: null, deltas: [] };

  if (!dealId) {
    console.warn("[tc] skipped commit write: missing dealId for account", accountId);
    return { technicalCommit: null, deltas: [] };
  }

  const store = getStore();
  const previous = store.getTechnicalCommitByDeal ? await store.getTechnicalCommitByDeal(dealId) : null;
  const merged = mergeTechnicalCommit(previous, technicalCommit);
  const ts = now();

  const row = await store.upsertTechnicalCommit({
    ...merged,
    id: previous?.id || newId("technicalCommit"),
    dealId,
    accountId: accountId || previous?.accountId || "",
    ownerId: previous?.ownerId || ctx.ownerId,
    teamId: previous?.teamId || ctx.teamId || "",
    orgId: previous?.orgId || ctx.orgId || "",
    createdAt: previous?.createdAt || ts,
    updatedAt: ts,
  });

  const deltas = opts.embedOnly
    ? buildTcDeltasDetail(tcDeltas, { ...ctx, dealId, accountId: accountId || "" })
    : await persistTcDeltas(tcDeltas, { ...ctx, dealId, accountId: accountId || "" });

  return { technicalCommit: row, deltas };
}
