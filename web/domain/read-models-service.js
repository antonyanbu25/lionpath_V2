/**
 * Read-model client helpers — single-doc reads + write-time rebuild trigger.
 */

import { WORKER_BASE_URL } from "../firebase-config.js";

const READ_MODEL_COLLECTIONS = {
  teamMetrics: "teamMetrics",
  orgMetrics: "orgMetrics",
  dealTraction: "dealTraction",
  accountRollup: "accountRollup",
  seLaunchpad: "seLaunchpad",
};

/** @param {ReturnType<import("./store.js").getStore>} store */
export async function getTeamMetricsReadModel(store, teamId) {
  if (!teamId || !store?.getReadModel) return null;
  return store.getReadModel(READ_MODEL_COLLECTIONS.teamMetrics, teamId);
}

/** @param {ReturnType<import("./store.js").getStore>} store */
export async function getOrgMetricsReadModel(store, orgId) {
  if (!orgId || !store?.getReadModel) return null;
  return store.getReadModel(READ_MODEL_COLLECTIONS.orgMetrics, orgId);
}

/** @param {ReturnType<import("./store.js").getStore>} store */
export async function getSeLaunchpadReadModel(store, userId) {
  if (!userId || !store?.getReadModel) return null;
  return store.getReadModel(READ_MODEL_COLLECTIONS.seLaunchpad, userId);
}

/** @param {ReturnType<import("./store.js").getStore>} store */
export async function getAccountRollupReadModel(store, accountId) {
  if (!accountId || !store?.getReadModel) return null;
  return store.getReadModel(READ_MODEL_COLLECTIONS.accountRollup, accountId);
}

/** @param {ReturnType<import("./store.js").getStore>} store */
export async function getAccountRollupReadModels(store, accountIds) {
  if (!accountIds?.length || !store?.getReadModels) return [];
  return store.getReadModels(READ_MODEL_COLLECTIONS.accountRollup, accountIds);
}

/** @param {ReturnType<import("./store.js").getStore>} store */
export async function getDealTractionReadModels(store, dealIds) {
  if (!dealIds?.length || !store?.getReadModels) return [];
  return store.getReadModels(READ_MODEL_COLLECTIONS.dealTraction, dealIds);
}

/** Hydrate accountRollup.detail.linesByDealId object back to Map for legacy consumers. */
export function hydrateAccountRollupDetail(detail) {
  if (!detail) return detail;
  const arrRollup = detail.arrRollup || {};
  const raw = arrRollup.linesByDealId;
  const linesByDealId =
    raw instanceof Map ? raw : new Map(Object.entries(raw || {}));
  return {
    ...detail,
    arrRollup: { ...arrRollup, linesByDealId },
  };
}

/**
 * Fire-and-forget debounced rebuild on worker (Node + Firestore admin).
 * @param {object} postCall saved postCall doc
 * @param {() => Promise<Record<string, string>>} authHeaders
 */
export async function scheduleReadModelRebuildFromPostCall(postCall, authHeaders) {
  if (!postCall?.id || !WORKER_BASE_URL) return;
  try {
    const headers = {
      "Content-Type": "application/json",
      ...(typeof authHeaders === "function" ? await authHeaders() : {}),
    };
    await fetch(`${WORKER_BASE_URL.replace(/\/$/, "")}/api/read-models/schedule`, {
      method: "POST",
      headers,
      body: JSON.stringify({ postCall }),
    });
  } catch (err) {
    console.warn("[read-models] schedule rebuild failed:", err?.message || err);
  }
}

export { READ_MODEL_COLLECTIONS };
