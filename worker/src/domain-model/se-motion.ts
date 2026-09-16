/**
 * SE motion (new business vs expansion) — QIP catalog selection.
 * Distinct from Deal.type (CRM routing). Defaulted from the acting SE's team.
 */

import { canonicalizeSeMotion, type SeMotion } from "../rubric-profiles";

export { canonicalizeSeMotion };
export type { SeMotion };

export const SE_MOTION_LABELS: Record<SeMotion, string> = {
  new_business: "New business",
  expansion: "Expansion",
};

const TEAM_AJAY_ID = "team_ajay";
const TEAM_NIKIL_ID = "team_nikil";
const TEAM_MARY_ID = "team_mary";
const TEAM_VARUN_ID = "team_varun";
const TEAM_AKSHITA_ID = "team_akshita";
const SEG_NEW_BUSINESS_ID = "seg_new_business";
const SEG_NURTURE_ID = "seg_nurture";
const SEG_DIGITAL_ID = "seg_digital";

const NB_TEAM_IDS = new Set([TEAM_AJAY_ID, TEAM_NIKIL_ID]);
const EXPANSION_TEAM_IDS = new Set([TEAM_MARY_ID, TEAM_VARUN_ID, TEAM_AKSHITA_ID]);

/**
 * Stamp SQL `post_call.se_motion` from the Firestore-shaped post-call doc.
 * Do not read `analysis.seMotion` — analysis JSONB v1 cannot gain keys.
 */
export function seMotionFromPostCallDoc(doc: Record<string, unknown> | null | undefined): SeMotion {
  if (!doc) return "new_business";
  const analysisMeta = asRecord(doc.analysisMeta) || nestedRecord(doc.detail, "analysisMeta");
  const confirmed = asRecord(doc.confirmed) || nestedRecord(doc.detail, "confirmed");
  const scorecard = asRecord(doc.scorecard) || nestedRecord(doc.detail, "scorecard");
  return canonicalizeSeMotion(
    doc.seMotion ?? analysisMeta?.seMotion ?? confirmed?.seMotion ?? scorecard?.seMotion,
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nestedRecord(parent: unknown, key: string): Record<string, unknown> | null {
  return asRecord(asRecord(parent)?.[key]);
}

export function defaultSeMotion(ctx: {
  teamId?: string | null;
  segmentId?: string | null;
  isSegmentLeader?: boolean;
} = {}): SeMotion {
  const teamId = ctx.teamId || null;
  const segmentId = ctx.segmentId || null;
  if (teamId && NB_TEAM_IDS.has(teamId)) return "new_business";
  if (teamId && EXPANSION_TEAM_IDS.has(teamId)) return "expansion";
  if (segmentId === SEG_NEW_BUSINESS_ID) return "new_business";
  if (segmentId === SEG_NURTURE_ID || segmentId === SEG_DIGITAL_ID) return "expansion";
  return "new_business";
}
