/**
 * Persist Pass 2 drafts to videoFacts / timelineSegments collections.
 */

import { getStore } from "./store.js";
import { newId, now } from "./types.js";

/**
 * @param {object} draft — VideoFactsDraft from worker
 * @param {{ callId: string, ownerId: string, teamId: string, orgId: string, accountId: string }} ctx
 * @returns {{ facts: object, segments: object[] }|null}
 */
export function buildVideoFactsDetail(draft, ctx) {
  if (!draft || !ctx?.callId || !ctx?.ownerId) return null;

  const ts = now();
  const factsId = newId("videoFacts");
  const facts = {
    id: factsId,
    callId: ctx.callId,
    status: draft.status || "unavailable",
    cameraOnPct: draft.cameraOnPct ?? null,
    keyframeRefs: Array.isArray(draft.keyframeRefs) ? draft.keyframeRefs : [],
    attendeeCurveJson: draft.attendeeCurveJson ?? null,
    cdeCustomized: draft.cdeCustomized ?? null,
    cdeEvidence: draft.cdeEvidence ?? null,
    shareOnPct: draft.shareOnPct ?? null,
    visualAnalysisConsent: !!draft.visualAnalysisConsent,
    sampleIntervalS: draft.sampleIntervalS ?? 10,
    durationSec: draft.durationSec ?? null,
    streamKind: draft.streamKind ?? null,
    errorMessage: draft.errorMessage ?? null,
    retentionExpiresAt: draft.retentionExpiresAt || ts,
    ownerId: ctx.ownerId,
    teamId: ctx.teamId || "",
    orgId: ctx.orgId || "",
    accountId: ctx.accountId || "",
    createdAt: ts,
    updatedAt: ts,
  };

  const segments = [];
  for (const seg of draft.segments || []) {
    segments.push({
      id: newId("timelineSegment"),
      callId: ctx.callId,
      videoFactsId: factsId,
      source: "video",
      startS: seg.startS,
      endS: seg.endS,
      segmentType: seg.segmentType || "none",
      label: seg.label || null,
      ownerId: ctx.ownerId,
      teamId: ctx.teamId || "",
      orgId: ctx.orgId || "",
    });
  }

  return { facts, segments };
}

/**
 * @param {object} draft — VideoFactsDraft from worker
 * @param {{ callId: string, ownerId: string, teamId: string, orgId: string, accountId: string }} ctx
 */
export async function persistVideoFactsDraft(draft, ctx) {
  const built = buildVideoFactsDetail(draft, ctx);
  if (!built) return null;

  const store = getStore();
  const existing = store.listVideoFactsByCall ? await store.listVideoFactsByCall(ctx.callId) : [];
  for (const prev of existing || []) {
    if (store.deleteTimelineSegmentsByVideoFactsId) {
      await store.deleteTimelineSegmentsByVideoFactsId(prev.id);
    }
    if (store.deleteVideoFacts) {
      await store.deleteVideoFacts(prev.id);
    }
  }

  await store.upsertVideoFacts(built.facts);
  for (const row of built.segments) {
    await store.upsertTimelineSegment(row);
  }

  return built;
}
