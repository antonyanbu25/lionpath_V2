/** Opportunity / pursuit on an account (ADR-003). */

import type { LifecycleStage, LifecycleStatus } from "./lifecycle";

export type DealType = "new_business" | "expansion";

export type AccountProgramPhase = "new_business" | "live" | "expansion";

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
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
}
