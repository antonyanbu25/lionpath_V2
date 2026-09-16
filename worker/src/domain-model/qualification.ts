/** Pass 4 — MEDDPICC qualification extracted from one call (spec §10). */

import type { MeddpiccFieldKey } from "./meddpicc";

export interface QualificationElement {
  value: string;
  evidence: string;
  surfaced: boolean;
  contactId?: string | null;
}

export type QualificationDraft = Record<MeddpiccFieldKey, QualificationElement>;

export interface CallQualificationResult {
  callId?: string | null;
  dealId?: string | null;
  framework: "MEDDPICC";
  qualification: QualificationDraft;
}
