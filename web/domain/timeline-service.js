/**
 * Call timeline — fetch the transcript-derived spine + markers from the worker and
 * persist them to timelineSegments / timelineMarkers.
 *
 * Transcript segments carry `source: "transcript"` and a null `videoFactsId`. They are
 * display evidence only: video-dependent themes stay not-applicable, and markers never
 * change a score (spec §6.5, §11.4).
 */

import { WORKER_BASE_URL } from "../firebase-config.js";
import { getStore } from "./store.js";
import { newId, now } from "./types.js";

const TIMELINE_URL = `${WORKER_BASE_URL}/api/postcall/timeline`;

/** @type {(() => Promise<string|null>)|null} */
let getAuthToken = null;

/** @param {() => Promise<string|null>} fn */
export function setTimelineAuthGetter(fn) {
  getAuthToken = fn;
}

async function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = getAuthToken ? await getAuthToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Derive the timeline for a transcript. Returns null when the worker is unreachable —
 * the timeline is an enhancement, never a reason to fail an analysis.
 *
 * @param {{ transcript: string, gaps?: object[], whatWorks?: object[], objections?: object[], scorecardLines?: object[] }} input
 */
export async function deriveCallTimeline(input) {
  if (!input?.transcript?.trim()) return null;
  try {
    const res = await fetch(TIMELINE_URL, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        transcript: input.transcript,
        gaps: input.gaps || [],
        whatWorks: input.whatWorks || [],
        objections: input.objections || [],
        scorecardLines: input.scorecardLines || [],
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * @param {object} draft — CallTimelineDraft from the worker
 * @param {{ callId: string, ownerId: string, teamId?: string, orgId?: string }} ctx
 * @returns {{ segments: object[], markers: object[] }|null}
 */
export function buildCallTimelineDetail(draft, ctx) {
  if (!draft || !ctx?.callId || !ctx?.ownerId) return null;
  if (!draft.hasTimestamps) return null;

  const ts = now();
  const segments = [];
  for (const seg of draft.segments || []) {
    segments.push({
      id: newId("timelineSegment"),
      callId: ctx.callId,
      videoFactsId: null,
      source: "transcript",
      startS: seg.startS,
      endS: seg.endS,
      segmentType: seg.segmentType,
      label: seg.label || null,
      ownerId: ctx.ownerId,
      teamId: ctx.teamId || "",
      orgId: ctx.orgId || "",
    });
  }

  const markers = [];
  for (const marker of draft.markers || []) {
    markers.push({
      id: newId("timelineMarker"),
      callId: ctx.callId,
      atS: marker.atS,
      kind: marker.kind,
      label: marker.label || "",
      quote: marker.quote || null,
      themeKey: marker.themeKey || null,
      source: marker.source || "transcript",
      ownerId: ctx.ownerId,
      teamId: ctx.teamId || "",
      orgId: ctx.orgId || "",
      createdAt: ts,
    });
  }

  return { segments, markers };
}

/**
 * @param {object} draft — CallTimelineDraft from the worker
 * @param {{ callId: string, ownerId: string, teamId?: string, orgId?: string }} ctx
 */
export async function persistCallTimelineDraft(draft, ctx) {
  const built = buildCallTimelineDetail(draft, ctx);
  if (!built) return null;

  const store = getStore();
  if (store.deleteTranscriptTimelineByCall) {
    await store.deleteTranscriptTimelineByCall(ctx.callId);
  }

  for (const row of built.segments) {
    if (store.upsertTimelineSegment) await store.upsertTimelineSegment(row);
  }
  for (const row of built.markers) {
    if (store.upsertTimelineMarker) await store.upsertTimelineMarker(row);
  }

  return built;
}
