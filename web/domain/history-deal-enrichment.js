/**
 * Roll up deal record fields from local post-call history when Firestore is empty or unavailable.
 */

import {
  mergeMeddpiccIntoMeta,
  meddpiccSignalsFromQualification,
  MEDDPICC_FIELD_KEYS,
  MEDDPICC_FIELD_LABELS,
  resolveDealMeddpicc,
} from "./contact-service.js";
import { computeDealTraction, daysSince, STAGE_MEDIAN_DAYS_DEFAULT } from "./deal-traction.js";

function historyResultBlob(rec) {
  return rec?.result || {};
}

function sortedRecords(records, newestFirst = false) {
  const sorted = [...(records || [])].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return newestFirst ? sorted.reverse() : sorted;
}

/** @param {object[]} records */
export function rollupMeddpiccFromHistoryRecords(records) {
  let metadata = {};
  for (const rec of sortedRecords(records)) {
    const qualification = historyResultBlob(rec).qualification;
    if (!qualification) continue;
    const signals = meddpiccSignalsFromQualification(qualification);
    metadata = mergeMeddpiccIntoMeta(metadata, signals, "postcall");
  }
  return metadata.meddpicc || null;
}

/** @param {import("./types.js").Deal|null|undefined} deal @param {object[]} records */
export function enrichDealFromHistoryRecords(deal, records) {
  if (!deal) return deal;
  const meddpicc = rollupMeddpiccFromHistoryRecords(records);
  if (!meddpicc) return deal;
  return {
    ...deal,
    metadata: { ...(deal.metadata || {}), meddpicc },
  };
}

/** @param {object[]} records */
export function dealSummaryFromHistoryRecords(records) {
  for (const rec of sortedRecords(records, true)) {
    const blob = historyResultBlob(rec);
    const draft = blob.dealSummary || blob.summarise?.dealSummary;
    if (draft?.summary?.trim()) {
      return {
        summary: draft.summary.trim(),
        generatedAt: draft.generatedAt || rec.timestamp || Date.now(),
        sourceCallIds: Array.isArray(draft.sourceCallIds) ? draft.sourceCallIds : [rec.id],
      };
    }
  }

  const latest = sortedRecords(records, true)[0];
  if (!latest) return null;
  const blob = historyResultBlob(latest);
  const notes = blob.summarise?.callNotes || latest.analysis?.callNotes;
  if (typeof notes === "string" && notes.trim()) {
    return {
      summary: notes.trim(),
      generatedAt: latest.timestamp || Date.now(),
      sourceCallIds: sortedRecords(records).map((r) => r.id),
    };
  }

  const headline =
    latest.analysis?.callSummary?.headline ||
    latest.analysis?.callSummary?.summary ||
    latest.analysis?.callHeader?.title;
  if (typeof headline === "string" && headline.trim()) {
    return {
      summary: headline.trim(),
      generatedAt: latest.timestamp || Date.now(),
      sourceCallIds: [latest.id],
    };
  }
  return null;
}

/** @param {object[]} records */
export function technicalCommitFromHistoryRecords(records) {
  for (const rec of sortedRecords(records, true)) {
    const tc = historyResultBlob(rec).technicalCommit;
    if (tc && typeof tc === "object") {
      return { ...tc, updatedAt: tc.updatedAt || rec.timestamp || Date.now() };
    }
  }
  return null;
}

function formatQualificationMovement(qualification) {
  if (!qualification) return [];
  const phrases = [];
  for (const key of MEDDPICC_FIELD_KEYS) {
    const el = qualification[key];
    if (!el?.surfaced || !String(el.value || "").trim()) continue;
    const label = (MEDDPICC_FIELD_LABELS[key] || key).toLowerCase();
    phrases.push(`Surfaced ${label}: ${String(el.value).trim()}`);
  }
  return phrases;
}

function formatTcDeltaMovement(delta) {
  if (!delta?.field) return "";
  const current =
    typeof delta.current === "string"
      ? delta.current.trim()
      : delta.current?.value?.trim() || delta.current?.summary?.trim() || "";
  if (delta.field === "identifiedRisk") {
    return current ? `Raised ${current}` : "Logged identified risk";
  }
  if (delta.field === "status") {
    return current ? `TC status → ${current}` : "TC status updated";
  }
  return current ? `Updated ${String(delta.field).replace(/([A-Z])/g, " $1").trim().toLowerCase()}: ${current}` : "";
}

/** @param {object} rec */
export function historyCallMovement(rec) {
  const blob = historyResultBlob(rec);
  const phrases = [
    ...formatQualificationMovement(blob.qualification),
    ...(blob.meddpiccDeltas || []).map((d) => {
      const label = (MEDDPICC_FIELD_LABELS[d.slot] || d.slot || "").toLowerCase();
      const value = d.current?.value?.trim();
      return value ? `Updated ${label}: ${value}` : `Updated ${label}`;
    }),
    ...(blob.tcDeltas || []).map(formatTcDeltaMovement).filter(Boolean),
  ];
  return phrases.length ? phrases.join(" · ") : "—";
}

/** @param {import("./types.js").Deal|null|undefined} deal @param {object[]} records */
export function tractionFromHistoryRecords(deal, records) {
  const sorted = sortedRecords(records, true);
  if (!sorted.length || !deal) return null;
  const latest = sorted[0];
  const blob = historyResultBlob(latest);
  const enrichedDeal = enrichDealFromHistoryRecords(deal, records);
  const priorCalls = sorted.slice(1).map((rec) => ({
    callId: rec.id,
    momentum: rec.analysis?.momentum || historyResultBlob(rec).analysis?.momentum,
    createdAt: rec.timestamp || 0,
  }));
  const rollup = computeDealTraction({
    deal: enrichedDeal,
    analysis: latest.analysis || {},
    followUps: blob.summarise?.followUps || [],
    objections: blob.summarise?.objections || [],
    technicalCommit: blob.technicalCommit || technicalCommitFromHistoryRecords(records),
    callId: latest.id,
    callCreatedAt: latest.timestamp || Date.now(),
    priorCalls,
    daysInStage: daysSince(deal.updatedAt || deal.lastActivityAt || latest.timestamp),
    stageMedianDays: STAGE_MEDIAN_DAYS_DEFAULT[deal.stage] ?? 34,
  });
  return {
    traction: rollup.traction,
    reasonsJson: rollup.reasonsJson,
    recommendedAction: rollup.recommendedAction,
    daysSilent: rollup.daysSilent,
    daysInStage: rollup.daysInStage,
    stageMedianDays: rollup.stageMedianDays,
  };
}

/**
 * Deal record extras derived purely from history blobs.
 * @param {import("./types.js").Deal|null|undefined} deal
 * @param {import("./types.js").Account|null|undefined} account
 * @param {object[]} records
 */
export function buildDealExtrasFromHistory(deal, account, records) {
  const enrichedDeal = enrichDealFromHistoryRecords(deal, records);
  const signal = tractionFromHistoryRecords(enrichedDeal, records);
  const med = resolveDealMeddpicc(enrichedDeal, account);
  const callRows = sortedRecords(records, true).map((rec) => ({
    postCall: {
      id: rec.id,
      title: rec.title || rec.analysis?.callHeader?.title || "Call",
      createdAt: rec.timestamp || Date.now(),
      analysis: rec.analysis || historyResultBlob(rec).analysis || {},
    },
    meddpiccDeltas: historyResultBlob(rec).meddpiccDeltas || [],
    tcDeltas: historyResultBlob(rec).tcDeltas || [],
    movement: historyCallMovement(rec),
  }));

  return {
    selectedDeal: enrichedDeal,
    dealSummary: dealSummaryFromHistoryRecords(records),
    technicalCommit: technicalCommitFromHistoryRecords(records),
    latestSignal: signal,
    daysInStage: signal?.daysInStage ?? daysSince(enrichedDeal?.updatedAt || enrichedDeal?.lastActivityAt),
    stageMedianDays: signal?.stageMedianDays ?? STAGE_MEDIAN_DAYS_DEFAULT[enrichedDeal?.stage] ?? 34,
    callRows,
    meddpiccScore: med?.completionScore ?? null,
    arrLines: [],
  };
}

/**
 * Merge store-backed account rows with history rows (history fills gaps when Firestore list is empty or partial).
 * @param {object[]} storeRows
 * @param {object[]} historyRows
 */
export function mergeAccountListRows(storeRows, historyRows) {
  const byId = new Map();
  for (const row of historyRows || []) {
    const id = row?.account?.id;
    if (id) byId.set(id, row);
  }
  for (const row of storeRows || []) {
    const id = row?.account?.id;
    if (id) byId.set(id, row);
  }
  return [...byId.values()].sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
}
