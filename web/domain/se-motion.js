/**
 * SE motion (new business vs expansion) — QIP catalog selection.
 * Distinct from Deal.type (CRM routing). Defaulted from the acting SE's team.
 */

import {
  TEAM_AJAY_ID,
  TEAM_NIKIL_ID,
  TEAM_MARY_ID,
  TEAM_VARUN_ID,
  TEAM_AKSHITA_ID,
  SEG_NEW_BUSINESS_ID,
  SEG_NURTURE_ID,
  SEG_DIGITAL_ID,
} from "./constants.js";
import { canonicalizeSeMotion } from "../rubric-profiles.js";

export { canonicalizeSeMotion };

export const SE_MOTION_LABELS = {
  new_business: "New business",
  expansion: "Expansion",
};

const NB_TEAM_IDS = new Set([TEAM_AJAY_ID, TEAM_NIKIL_ID]);
const EXPANSION_TEAM_IDS = new Set([TEAM_MARY_ID, TEAM_VARUN_ID, TEAM_AKSHITA_ID]);

/**
 * Stamp SQL `post_call.se_motion` / list projections from the Firestore-shaped doc.
 * Do not read `analysis.seMotion` — analysis JSONB v1 cannot gain keys.
 * @param {object|null|undefined} doc
 * @returns {"new_business"|"expansion"}
 */
export function seMotionFromPostCallDoc(doc) {
  if (!doc) return "new_business";
  const analysisMeta = asRecord(doc.analysisMeta) || nestedRecord(doc.detail, "analysisMeta");
  const confirmed = asRecord(doc.confirmed) || nestedRecord(doc.detail, "confirmed");
  const scorecard = asRecord(doc.scorecard) || nestedRecord(doc.detail, "scorecard");
  return canonicalizeSeMotion(
    doc.seMotion ?? analysisMeta?.seMotion ?? confirmed?.seMotion ?? scorecard?.seMotion,
  );
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function nestedRecord(parent, key) {
  return asRecord(asRecord(parent)?.[key]);
}

/**
 * @param {{ teamId?: string|null, segmentId?: string|null, isSegmentLeader?: boolean }} [ctx]
 * @returns {"new_business"|"expansion"}
 */
export function defaultSeMotion(ctx = {}) {
  const teamId = ctx.teamId || null;
  const segmentId = ctx.segmentId || null;
  if (teamId && NB_TEAM_IDS.has(teamId)) return "new_business";
  if (teamId && EXPANSION_TEAM_IDS.has(teamId)) return "expansion";
  if (segmentId === SEG_NEW_BUSINESS_ID) return "new_business";
  if (segmentId === SEG_NURTURE_ID || segmentId === SEG_DIGITAL_ID) return "expansion";
  return "new_business";
}
