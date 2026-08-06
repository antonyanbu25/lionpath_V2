/**
 * Persist Pass 2 drafts to videoFacts / timelineSegments collections.
 */

import { getStore } from "./store.js";
import { newId, now } from "./types.js";

/**
 * @param {object} draft — VideoFactsDraft from worker
 * @param {{ callId: string, ownerId: string, teamId: string, orgId: string, accountId: string, dealId?: string|null }} ctx
 */
export async function persistVideoFactsDraft(draft, ctx) {
  if (!draft || !ctx?.callId || !ctx?.ownerId) return null;

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

  const ts = now();
  const factsId = newId("videoFacts");
  const facts = {
    id: factsId,
    callId: ctx.callId,
    dealId: ctx.dealId || null,
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

  await store.upsertVideoFacts(facts);

  const segments = [];
  for (const seg of draft.segments || []) {
    const row = {
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
    };
    await store.upsertTimelineSegment(row);
    segments.push(row);
  }

  return { facts, segments };
}
