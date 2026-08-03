/**
 * @deprecated v2.1 — sub-parameters replace the 1–5 anchor system.
 * Scoring path no longer uses anchors. Kept for import compatibility during migration.
 */

import type { CallType } from "./rubric-profiles";

export const ANCHORS_RETIRED = true;
export const ANCHOR_SCORES = [1, 2, 3, 4, 5] as const;
export type AnchorScore = (typeof ANCHOR_SCORES)[number];
export const UNANCHORED_CONFIDENCE_CAP = 0.55;
export const UNANCHORED_PROMPT_NOTICE =
  "Anchors retired in v2.1 — score five sub-parameters (0/1/2) per theme.";

export interface RubricAnchorLevel {
  score: AnchorScore;
  description: string;
}

export interface RubricAnchorsJson {
  themeKey: string;
  profileCallType: CallType;
  levels: RubricAnchorLevel[];
  author: string;
  approvedBy: string;
  approvedAt: number;
  notes?: string | null;
}

/** @deprecated */
export function isThemeAnchored(_anchors: RubricAnchorsJson | null | undefined): boolean {
  return false;
}

/** @deprecated */
export function applyUnanchoredConfidenceCap(confidence: number): number {
  return confidence;
}

/** @deprecated */
export function anchorsJsonForTheme(_themeKey: string, _callType: CallType): RubricAnchorsJson | null {
  return null;
}

/** @deprecated */
export function formatAnchorBlockForPrompt(_anchors: RubricAnchorsJson | null): string {
  return "";
}

/** @deprecated */
export function parseRubricAnchors(raw: unknown): RubricAnchorsJson {
  throw new Error("Rubric anchors retired in QIP v2.1");
}

/** @deprecated */
export function validateRubricAnchors(_raw: unknown): string[] {
  return ["Anchors retired in QIP v2.1"];
}

/** @deprecated */
export function prepareRubricAnchorsWrite(): never {
  throw new Error("Rubric anchors retired in QIP v2.1");
}

/** @deprecated */
export function computeAnchorCoverageReport(): { anchored: number; total: number; pct: number } {
  return { anchored: 0, total: 0, pct: 0 };
}

/** @deprecated */
export function formatAnchorCoverageReport(): string {
  return "Anchors retired in QIP v2.1 — sub-parameters replace anchor tables.";
}

/** @deprecated */
export function buildStorytellingAnchors(_profileCallType: CallType): RubricAnchorsJson {
  throw new Error("Rubric anchors retired in QIP v2.1");
}
