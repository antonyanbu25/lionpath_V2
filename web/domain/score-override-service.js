/**
 * Score overrides — Firestore with localStorage fallback (SE local-dev path preserved).
 */
import { getStore } from "./store.js";
import { newId, now } from "./types.js";
import {
  loadScoreOverrides,
  saveScoreOverrides,
  appendScoreOverride,
} from "../coach/index.js";

/** @param {object|null} session */
export async function loadScoreOverridesForSession(session) {
  const local = loadScoreOverrides();
  const store = getStore();
  if (!session?.teamId || !store.listScoreOverridesByTeam) {
    return local;
  }
  try {
    const remote = await store.listScoreOverridesByTeam(session.teamId, 500);
    if (!remote?.length) return local;
    const byId = new Map(local.map((o) => [o.id, o]));
    for (const row of remote) byId.set(row.id, row);
    const merged = [...byId.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    saveScoreOverrides(merged);
    return merged;
  } catch (err) {
    console.warn("[score-override] remote load failed:", err?.message || err);
    return local;
  }
}

/**
 * @param {object} entry
 * @param {object|null} session
 */
export async function persistScoreOverride(entry, session) {
  const row = {
    ...entry,
    id: entry.id || newId("scoreOverride"),
    createdAt: entry.createdAt || now(),
    teamId: entry.teamId || session?.teamId || "",
    orgId: entry.orgId || session?.orgId || "",
  };
  appendScoreOverride(row);
  const store = getStore();
  if (store.upsertScoreOverride) {
    try {
      await store.upsertScoreOverride(row);
    } catch (err) {
      console.warn("[score-override] remote persist failed:", err?.message || err);
    }
  }
  return row;
}

/** @param {string} callId @param {object[]} overrides */
export function overridesForCallId(overrides, callId) {
  return (overrides || []).filter((o) => o.callId === callId);
}
