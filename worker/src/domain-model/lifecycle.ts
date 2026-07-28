/** One SE's engagement thread with an account. */

export type LifecycleStage =
  | "research"
  | "discovery"
  | "demo"
  | "evaluation"
  | "business_case"
  | "closed_won"
  | "closed_lost"
  | "nurture";

export type LifecycleStatus = "active" | "paused" | "archived";

export interface Lifecycle {
  id: string;
  dealId?: string | null;
  ownerId: string;
  teamId: string;
  accountId: string;
  primaryContactId: string | null;
  stage: LifecycleStage;
  status: LifecycleStatus;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  prepCount: number;
  postCallCount: number;
  openTaskCount: number;
  latestQualityScore: number | null;
}

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  "research",
  "discovery",
  "demo",
  "evaluation",
  "business_case",
  "closed_won",
  "closed_lost",
  "nurture",
];

export const STAGE_LABELS: Record<LifecycleStage, string> = {
  research: "Research",
  discovery: "Discovery",
  demo: "Demo",
  evaluation: "Evaluation",
  business_case: "Business Case",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
  nurture: "Nurture",
};

/** MVP: first post-call auto-advances research → discovery. */
export function stageAfterFirstPostCall(current: LifecycleStage): LifecycleStage {
  if (current === "research") return "discovery";
  return current;
}
