/** Deal qualification field slot — MEDDPICC on Account. */

export type FieldSlotStatus = "unknown" | "partial" | "confirmed";

export type FieldSlotSource = "prep" | "postcall" | "manual";

export interface MeddpiccFieldSlot {
  value?: string;
  status: FieldSlotStatus;
  source?: FieldSlotSource;
  updatedAt?: number;
  contactId?: string;
}

export interface AccountMeddpicc {
  metrics?: MeddpiccFieldSlot;
  economicBuyer?: MeddpiccFieldSlot;
  decisionCriteria?: MeddpiccFieldSlot;
  decisionProcess?: MeddpiccFieldSlot;
  paperProcess?: MeddpiccFieldSlot;
  identifyPain?: MeddpiccFieldSlot;
  champion?: MeddpiccFieldSlot;
  competition?: MeddpiccFieldSlot;
  lastUpdatedAt?: number;
  completionScore?: number;
}

export const MEDDPICC_FIELD_KEYS = [
  "metrics",
  "economicBuyer",
  "decisionCriteria",
  "decisionProcess",
  "paperProcess",
  "identifyPain",
  "champion",
  "competition",
] as const;

export type MeddpiccFieldKey = (typeof MEDDPICC_FIELD_KEYS)[number];

export const MEDDPICC_FIELD_LABELS: Record<MeddpiccFieldKey, string> = {
  metrics: "Metrics",
  economicBuyer: "Economic buyer",
  decisionCriteria: "Decision criteria",
  decisionProcess: "Decision process",
  paperProcess: "Paper process",
  identifyPain: "Identify pain",
  champion: "Champion",
  competition: "Competition",
};
