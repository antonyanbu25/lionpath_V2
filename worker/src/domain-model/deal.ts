/** Opportunity / pursuit on an account (ADR-003). */

import type { LifecycleStage, LifecycleStatus } from "./lifecycle";

export type DealType = "new_business" | "expansion";

export type AccountProgramPhase = "new_business" | "live" | "expansion";

/** Account Executive on the deal (name and/or email). Free-form: AE is not a system user. */
export interface DealAe {
  name?: string;
  email?: string;
}

export interface Deal {
  id: string;
  accountId: string;
  type: DealType;
  stage: LifecycleStage;
  status: LifecycleStatus;
  ownerId: string;
  teamId: string;
  orgId: string | null;
  primaryContactId: string | null;
  title: string;
  prepCount: number;
  postCallCount: number;
  openTaskCount: number;
  latestQualityScore: number | null;
  closedWonAt?: number | null;
  crmOpportunityId?: string | null;
  /** Deal-scoped metadata (ARR, MEDDPICC rollup, AE — see ENTITY_CATALOG.md). */
  metadata?: {
    ae?: DealAe;
    closedWonAt?: number | null;
    crmOpportunityId?: string | null;
    [key: string]: unknown;
  };
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
}
