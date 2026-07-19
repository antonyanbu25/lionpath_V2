/** Immutable audit trail entry inside a lifecycle. */

export type LifecycleEventType =
  | "lifecycle_created"
  | "stage_changed"
  | "prep_generated"
  | "postcall_analyzed"
  | "task_created"
  | "task_completed"
  | "contact_updated"
  | "lifecycle_archived"
  | "artifact_imported";

export interface LifecycleEvent {
  id: string;
  lifecycleId: string;
  type: LifecycleEventType;
  actorId: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export const EVENT_LABELS: Record<LifecycleEventType, string> = {
  lifecycle_created: "Lifecycle created",
  stage_changed: "Stage changed",
  prep_generated: "Prep generated",
  postcall_analyzed: "Post-call analyzed",
  task_created: "Task created",
  task_completed: "Task completed",
  contact_updated: "Contact updated",
  lifecycle_archived: "Lifecycle archived",
  artifact_imported: "Artifact imported",
};
