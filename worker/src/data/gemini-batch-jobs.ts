/**
 * Firestore ledger for Gemini Batch jobs — tracks submit/poll/collect lifecycle.
 */

import { newId } from "../domain-model/id";
import type { FirestoreEnv } from "./firestore-admin";
import { getDoc, queryBy, setDoc } from "./firestore-admin";

export type BatchWorkload = "cluster-label" | "summaries" | "embedding-backfill";

export type BatchJobKind = "generate" | "embed";

export type BatchJobState =
  | "submitted"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "fallback"
  | "fallback_failed";

export type BatchItemStatus = "pending" | "ok" | "error" | "fallback" | "fallback_failed";

export interface BatchJobItem {
  key: string;
  status: BatchItemStatus;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface BatchJobContext {
  orgId?: string;
  accountId?: string;
  dealId?: string;
  ownerId?: string;
  teamId?: string;
  userId?: string;
  clusterIds?: string[];
  collection?: string;
  cursor?: string;
  idempotencyKey?: string;
}

export interface GeminiBatchJobRecord {
  id: string;
  workload: BatchWorkload;
  kind: BatchJobKind;
  geminiJobName: string;
  model: string;
  state: BatchJobState;
  items: BatchJobItem[];
  context: BatchJobContext;
  submittedAt: number;
  completedAt?: number;
  fallbackAfterMs: number;
  displayName?: string;
  geminiState?: string;
  error?: string;
}

export const FALLBACK_MS: Record<BatchWorkload, number> = {
  "cluster-label": 4 * 60 * 60 * 1000,
  summaries: 2 * 60 * 60 * 1000,
  "embedding-backfill": 24 * 60 * 60 * 1000,
};

const COL = "geminiBatchJobs";

export function batchJobId(): string {
  return newId();
}

export async function getBatchJob(id: string, env?: FirestoreEnv): Promise<GeminiBatchJobRecord | null> {
  const doc = await getDoc(COL, id, env);
  if (!doc) return null;
  return doc as unknown as GeminiBatchJobRecord;
}

export async function saveBatchJob(job: GeminiBatchJobRecord, env?: FirestoreEnv): Promise<void> {
  await setDoc(COL, job.id, job as unknown as Record<string, unknown>, env);
}

export async function listOpenBatchJobs(env?: FirestoreEnv): Promise<GeminiBatchJobRecord[]> {
  const rows = await queryBy(
    COL,
    [{ field: "state", op: "in", value: ["submitted", "running"] }],
    { field: "submittedAt", direction: "asc" },
    50,
    env,
  );
  return rows as unknown as GeminiBatchJobRecord[];
}

export async function listFallbackEligibleJobs(now: number, env?: FirestoreEnv): Promise<GeminiBatchJobRecord[]> {
  const rows = await queryBy(
    COL,
    [{ field: "state", op: "in", value: ["submitted", "running", "partial"] }],
    { field: "submittedAt", direction: "asc" },
    100,
    env,
  );
  return (rows as unknown as GeminiBatchJobRecord[]).filter(
    (job) => now >= job.submittedAt + job.fallbackAfterMs,
  );
}

/** Return an open job with the same workload + idempotency key, if any. */
export async function findOpenJobByKey(
  workload: BatchWorkload,
  idempotencyKey: string,
  env?: FirestoreEnv,
): Promise<GeminiBatchJobRecord | null> {
  if (!idempotencyKey.trim()) return null;
  const rows = await queryBy(
    COL,
    [
      { field: "workload", op: "==", value: workload },
      { field: "context.idempotencyKey", op: "==", value: idempotencyKey },
      { field: "state", op: "in", value: ["submitted", "running", "partial"] },
    ],
    undefined,
    1,
    env,
  );
  return (rows[0] as unknown as GeminiBatchJobRecord) || null;
}

export function summarizeItemStates(items: BatchJobItem[]): BatchJobState {
  const pending = items.some((i) => i.status === "pending");
  const errors = items.filter((i) => i.status === "error" || i.status === "fallback_failed").length;
  const ok = items.filter((i) => i.status === "ok" || i.status === "fallback").length;
  if (pending) return "running";
  if (errors && ok) return "partial";
  if (errors && !ok) return "failed";
  return "succeeded";
}
