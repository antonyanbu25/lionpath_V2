/** QIP scoring rubrics — versioned reference data (POST_CALL_SPEC_V2 §10). */

import type { RubricAnchorsJson } from "../rubric-anchors";
import type { CallType } from "../rubric-profiles";

export interface Rubric {
  id: string;
  callType: CallType;
  version: string;
  totalPoints: number;
  active: boolean;
  /** Shadow mode — scores compute but stay out of aggregates until calibrated (§6.6). */
  provisional: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RubricTheme {
  rubricId: string;
  themeKey: string;
  weight: number;
  anchorsJson: RubricAnchorsJson | null;
}
