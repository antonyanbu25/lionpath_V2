/**
 * Technical commit — deal-scoped current state plus per-call movement (spec §2.2, §10).
 *
 * Snapshot lives on the deal (`technicalCommits`, one per deal). Movement lives on the call
 * (`tcDeltas`). "TC = yes" as a static field tells you nothing about whether the commit is
 * strengthening or quietly rotting — the delta is the point.
 */

export type TcStatus = "yes" | "no" | "pending" | "at_risk";

export const TC_STATUSES: TcStatus[] = ["yes", "no", "pending", "at_risk"];

export interface TcFieldSlot {
  value: string;
  evidence?: string;
}

/**
 * AI attach is a first-class value, not a boolean (spec §11.9) — it earns its own column
 * in the deal list, call strip and TC tab, e.g. "Copilot 14/14".
 */
export interface AiAttachValue {
  product?: string;
  agentCount?: number;
  agentTotal?: number;
  summary?: string;
  /** Opted in after being shown, not before — the distinction the metric exists for. */
  optedInAfterDemo?: boolean;
}

export const TC_SLOT_KEYS = [
  "incumbent",
  "competitor",
  "identifiedRisk",
  "timelineForClosure",
  "reasonForEvaluation",
  "whatsWorking",
] as const;

export type TcSlotKey = (typeof TC_SLOT_KEYS)[number];

export type TcFieldKey = TcSlotKey | "aiAttach" | "status" | "justification";

export type TcChangeType = "confirmed" | "changed" | "new";

export type TcFieldValue = TcFieldSlot | AiAttachValue | TcStatus | string;

/** Worker draft — web stamps IDs + RBAC fields at persist time. */
export interface TechnicalCommitDraft {
  status: TcStatus;
  justification: string | null;
  incumbent: TcFieldSlot | null;
  competitor: TcFieldSlot | null;
  identifiedRisk: TcFieldSlot | null;
  timelineForClosure: TcFieldSlot | null;
  reasonForEvaluation: TcFieldSlot | null;
  aiAttach: AiAttachValue | null;
  whatsWorking: TcFieldSlot | null;
}

export interface TechnicalCommit extends TechnicalCommitDraft {
  id: string;
  dealId: string;
  accountId: string;
  ownerId: string;
  teamId: string;
  orgId: string;
  createdAt: number;
  updatedAt: number;
}

export interface TcDeltaDraft {
  field: TcFieldKey;
  previous: TcFieldValue | null;
  current: TcFieldValue;
  changeType: TcChangeType;
  /** Transcript quote, or the explicit string "not surfaced". */
  evidence: string;
}

export interface TcDelta extends TcDeltaDraft {
  id: string;
  callId: string;
  dealId: string;
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
}
