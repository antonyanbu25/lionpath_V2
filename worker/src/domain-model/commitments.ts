/** Pass 7 — follow-ups, objections, MoM drafts (POST_CALL_SPEC_V2 §9–§10). */

export type FollowUpOwner = "se" | "ae" | "customer";
export type FollowUpStatus = "open" | "done" | "cancelled";

export interface FollowUp {
  id: string;
  callId: string;
  dealId: string | null;
  description: string;
  owner: FollowUpOwner;
  dueDate: string | null;
  status: FollowUpStatus;
  sourceQuote: string | null;
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Objection {
  id: string;
  callId: string;
  objectionText: string;
  handling: string | null;
  landed: boolean;
  theme: string | null;
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
}

/** Structured MoM section — Kaia-style Outcome / Key points / Action items. */
export interface MomKeyPoint {
  title: string;
  detail?: string | null;
}

export interface MomActionItem {
  text: string;
  owner?: FollowUpOwner | null;
  dueDate?: string | null;
  /** Seconds from call start when the commitment was made — null when unknown. */
  atS?: number | null;
  sourceQuote?: string | null;
}

/**
 * Customer-facing minutes. Never auto-send — human edits before send.
 * `sentAt == null` means drafted-but-never-sent (spec §9 metric).
 *
 * `draftBody` stays the flat copy/email form. Structured fields power the Minutes
 * tab (Outcome / Key points / Action items). Older drafts may lack them.
 */
export interface MomDraft {
  id: string;
  callId: string;
  draftBody: string;
  editedBody: string | null;
  outcome?: string | null;
  keyPoints?: MomKeyPoint[] | null;
  actionItems?: MomActionItem[] | null;
  sentAt: number | null;
  sentBy: string | null;
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
}

/** Worker draft — web stamps IDs + RBAC fields at persist time. */
export interface FollowUpDraft {
  description: string;
  owner: FollowUpOwner;
  dueDate: string | null;
  status: FollowUpStatus;
  sourceQuote: string | null;
}

export interface ObjectionDraft {
  objectionText: string;
  handling: string | null;
  landed: boolean;
  theme: string | null;
}

export interface MomDraftDraft {
  draftBody: string;
  outcome?: string | null;
  keyPoints?: MomKeyPoint[];
  actionItems?: MomActionItem[];
  /** Always null from the worker — never auto-send. */
  editedBody: null;
  sentAt: null;
  sentBy: null;
}
