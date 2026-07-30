/** Artifact documents linked to a Lifecycle — wrap existing prep/post-call/task shapes. */

import type { Prep } from "../schema";

/** Prep input shape from the form (mirrors worker/src/prep.ts). */
export interface PrepInput {
  companyName: string;
  prospectEmail: string;
  prospectEmails?: string[];
  prospectName?: string;
  additionalContext?: string;
  meetingType?: string;
  ae?: string;
  effort?: string;
  linkedinProfileExports?: Array<{ fileName: string; text: string }>;
}

export interface PrepBriefMeta {
  company: string;
  domain?: string;
  additionalContext?: string;
}

export interface PrepBrief {
  id: string;
  lifecycleId: string;
  dealId?: string | null;
  ownerId: string;
  teamId: string;
  accountId: string;
  input: PrepInput;
  prep: Prep;
  meta: PrepBriefMeta;
  createdAt: number;
}

/** AE + primary/secondary SE + customer contacts recorded on a call. */
export interface CallIdentities {
  aeName?: string | null;
  aeEmail?: string | null;
  primarySeUserId?: string | null;
  secondarySeUserIds?: string[];
  contactIds?: string[];
}

export interface PostCallDoc {
  id: string;
  lifecycleId: string;
  dealId?: string | null;
  ownerId: string;
  teamId: string;
  accountId: string;
  zoomLink?: string;
  title?: string;
  callIdentityKey: string;
  analysis: Record<string, unknown>;
  transcriptMeta?: unknown;
  qualityScore?: number | null;
  /** AE / primary SE / secondary SE / contacts confirmed for this call. */
  identities?: CallIdentities;
  createdAt: number;
  updatedAt: number;
}

export type TaskStatus = "recommended" | "pending" | "completed" | "dismissed";
export type TaskSource = "postcall" | "prep" | "manual";

export interface TaskDoc {
  id: string;
  lifecycleId: string;
  dealId?: string | null;
  ownerId: string;
  teamId: string;
  accountId: string;
  title: string;
  status: TaskStatus;
  source: TaskSource;
  sourceKey?: string;
  callId?: string;
  company?: string;
  due?: string;
  dueDate?: number | null;
  createdAt: number;
  completedAt?: number;
}
