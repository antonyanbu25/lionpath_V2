/**
 * Pass 9 — deal + account summaries (spec §5, §10, §11.5–§11.6).
 * Evidence-grounded roll-ups in extension collections — never overwrite Account/Deal CRM fields.
 */

export interface SummaryDraft {
  summary: string;
  sourceCallIds: string[];
}

export interface DealSummaryRecord extends SummaryDraft {
  id: string;
  dealId: string;
  accountId: string;
  generatedAt: number;
  ownerId: string;
  teamId: string;
  orgId: string;
  createdAt: number;
  updatedAt: number;
}

export interface AccountSummaryRecord extends SummaryDraft {
  id: string;
  accountId: string;
  generatedAt: number;
  ownerId: string;
  teamId: string;
  orgId: string;
  createdAt: number;
  updatedAt: number;
}
