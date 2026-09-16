/**
 * Batch job completion handlers and inline fallback for stuck/partial jobs.
 */

import type { FirestoreEnv } from "./firestore-admin";
import { setDoc } from "./firestore-admin";
import { recordLlmUsage } from "./llm-usage";
import {
  EMBEDDING_BACKFILL_CHUNK,
  loadEmbeddingCursor,
  persistEmbeddingResult,
  queryEmbeddingBackfillChunk,
  saveEmbeddingCursor,
  nextBackfillCollection,
} from "./embedding-backfill";
import {
  type BatchJobItem,
  type GeminiBatchJobRecord,
  batchJobId,
  saveBatchJob,
  summarizeItemStates,
} from "./gemini-batch-jobs";
import { embedText, EMBEDDING_MODEL } from "../embeddings";
import {
  buildSummariesBatchItems,
  buildSummariesContextFromFirestore,
  parseSummaryBatchResult,
  persistSummaryDraftFromBatch,
  type SummariesBatchContext,
} from "../postcall/summaries-batch";
import { runPostCallSummaries } from "../postcall/summaries";
import {
  buildClusterLabelBatchItem,
  heuristicClusterLabel,
  parseClusterLabelText,
  suggestClusterLabel,
} from "../product-signal/cluster-label";
import {
  collectEmbedResults,
  collectGenerateResults,
  pollBatchJob,
  submitEmbedBatch,
  submitGenerateBatch,
  TERMINAL_BATCH_STATES,
  type BatchEmbedItem,
  type BatchGenerateItem,
} from "../providers/gemini-batch";
import { resolvePostCallModel } from "../providers/pass-models";
import type { ProviderEnv } from "../providers/types";

type BatchEnv = ProviderEnv & FirestoreEnv;

function updateItem(items: BatchJobItem[], key: string, patch: Partial<BatchJobItem>): BatchJobItem[] {
  return items.map((item) => (item.key === key ? { ...item, ...patch } : item));
}

function recordBatchItemUsage(
  env: BatchEnv,
  job: GeminiBatchJobRecord,
  passName: string,
  model: string,
  usage?: { promptTokens: number; outputTokens: number },
): void {
  const userId = job.context.userId || job.context.ownerId;
  if (!usage) return;
  recordLlmUsage(env, {
    userId,
    callId: undefined,
    passName,
    model,
    promptTokens: usage.promptTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: 0,
    groundingQueries: 0,
    latencyMs: 0,
  });
}

export async function enqueueClusterLabelBatch(
  env: BatchEnv,
  orgId: string,
  labels: Array<{ clusterId: string; verbatims: string[] }>,
  userId?: string,
): Promise<GeminiBatchJobRecord | null> {
  if (!labels.length) return null;
  const items: BatchGenerateItem[] = labels.map((l) => buildClusterLabelBatchItem(l.clusterId, l.verbatims));
  const model = resolvePostCallModel(env);
  const idempotencyKey = `cluster-label:${orgId}:${labels.map((l) => l.clusterId).sort().join(",")}`;

  const submitted = await submitGenerateBatch(
    env,
    model,
    items,
    `cluster-label-${orgId}-${Date.now()}`,
  );

  const job: GeminiBatchJobRecord = {
    id: batchJobId(),
    workload: "cluster-label",
    kind: "generate",
    geminiJobName: submitted.name,
    model,
    state: "submitted",
    items: items.map((i) => ({
      key: i.key,
      status: "pending",
      meta: { verbatims: labels.find((l) => l.clusterId === i.key)?.verbatims },
    })),
    context: { orgId, userId, clusterIds: labels.map((l) => l.clusterId), idempotencyKey },
    submittedAt: Date.now(),
    fallbackAfterMs: 4 * 60 * 60 * 1000,
    displayName: submitted.displayName,
    geminiState: submitted.state,
  };
  await saveBatchJob(job, env);
  return job;
}

export async function enqueueSummariesBatch(
  env: BatchEnv,
  ctx: SummariesBatchContext,
): Promise<GeminiBatchJobRecord | null> {
  const input = await buildSummariesContextFromFirestore(ctx.dealId || null, ctx.accountId, env);
  if (!input?.account?.calls?.length) return null;

  const batchItems = buildSummariesBatchItems(input);
  const model = resolvePostCallModel(env);
  const idempotencyKey = `summaries:${ctx.accountId}:${ctx.dealId || "none"}`;

  const submitted = await submitGenerateBatch(
    env,
    model,
    batchItems,
    `summaries-${ctx.accountId}-${Date.now()}`,
  );

  const job: GeminiBatchJobRecord = {
    id: batchJobId(),
    workload: "summaries",
    kind: "generate",
    geminiJobName: submitted.name,
    model,
    state: "submitted",
    items: batchItems.map((i) => ({ key: i.key, status: "pending" })),
    context: {
      accountId: ctx.accountId,
      dealId: ctx.dealId || undefined,
      ownerId: ctx.ownerId,
      teamId: ctx.teamId,
      orgId: ctx.orgId,
      userId: ctx.userId || ctx.ownerId,
      idempotencyKey,
    },
    submittedAt: Date.now(),
    fallbackAfterMs: 2 * 60 * 60 * 1000,
    geminiState: submitted.state,
  };
  await saveBatchJob(job, env);
  return job;
}

export async function enqueueEmbeddingBackfillBatch(env: BatchEnv): Promise<GeminiBatchJobRecord | null> {
  const cursor = await loadEmbeddingCursor(env);
  const collection = nextBackfillCollection(cursor);
  const docs = await queryEmbeddingBackfillChunk(collection, cursor, EMBEDDING_BACKFILL_CHUNK, env);
  if (!docs.length) {
    await saveEmbeddingCursor({ ...cursor, completed: true }, env);
    return null;
  }

  const embedItems: BatchEmbedItem[] = docs.map((d) => ({
    key: `${d.collection}:${d.docId}`,
    text: d.text,
  }));

  const submitted = await submitEmbedBatch(
    env,
    EMBEDDING_MODEL,
    embedItems,
    `embedding-backfill-${collection}-${Date.now()}`,
  );

  const job: GeminiBatchJobRecord = {
    id: batchJobId(),
    workload: "embedding-backfill",
    kind: "embed",
    geminiJobName: submitted.name,
    model: EMBEDDING_MODEL,
    state: "submitted",
    items: embedItems.map((i) => {
      const doc = docs.find((d) => `${d.collection}:${d.docId}` === i.key);
      return {
        key: i.key,
        status: "pending" as const,
        meta: {
          collection: doc?.collection,
          docId: doc?.docId,
          text: doc?.text,
        },
      };
    }),
    context: {
      collection,
      cursor: cursor.lastId,
      idempotencyKey: `embedding:${collection}:${docs[docs.length - 1]?.docId}`,
    },
    submittedAt: Date.now(),
    fallbackAfterMs: 24 * 60 * 60 * 1000,
    geminiState: submitted.state,
  };
  await saveBatchJob(job, env);
  return job;
}

async function applyClusterLabelResults(
  env: BatchEnv,
  job: GeminiBatchJobRecord,
  results: Awaited<ReturnType<typeof collectGenerateResults>>,
): Promise<BatchJobItem[]> {
  let items = [...job.items];
  for (const result of results) {
    if (!result.ok || !result.text) {
      items = updateItem(items, result.key, { status: "error", error: result.error || "label failed" });
      continue;
    }
    const label = parseClusterLabelText(result.text) || heuristicClusterLabel([]);
    await setDoc(
      "gapClusters",
      result.key,
      { label, labelSource: "batch", updatedAt: Date.now() },
      env,
    );
    items = updateItem(items, result.key, { status: "ok" });
    recordBatchItemUsage(env, job, "batch/cluster-label", job.model, result.usage);
  }
  return items;
}

async function applySummariesResults(
  env: BatchEnv,
  job: GeminiBatchJobRecord,
  results: Awaited<ReturnType<typeof collectGenerateResults>>,
): Promise<BatchJobItem[]> {
  const ctx: SummariesBatchContext = {
    accountId: job.context.accountId!,
    dealId: job.context.dealId || null,
    ownerId: job.context.ownerId!,
    teamId: job.context.teamId,
    orgId: job.context.orgId,
    userId: job.context.userId,
  };

  let items = [...job.items];
  for (const result of results) {
    if (!result.ok || !result.text) {
      items = updateItem(items, result.key, { status: "error", error: result.error || "summary failed" });
      continue;
    }
    const isDeal = result.key.startsWith("deal:");
    const maxWords = isDeal ? 320 : 400;
    let draft;
    try {
      draft = parseSummaryBatchResult(result.text, maxWords);
    } catch (err) {
      items = updateItem(items, result.key, {
        status: "error",
        error: err instanceof Error ? err.message : "parse failed",
      });
      continue;
    }
    await persistSummaryDraftFromBatch(ctx, draft, isDeal ? "deal" : "account", env);
    items = updateItem(items, result.key, { status: "ok" });
    recordBatchItemUsage(env, job, "batch/summaries", job.model, result.usage);
  }
  return items;
}

async function applyEmbeddingResults(
  env: BatchEnv,
  job: GeminiBatchJobRecord,
  results: Awaited<ReturnType<typeof collectEmbedResults>>,
): Promise<BatchJobItem[]> {
  let items = [...job.items];
  let lastDocId = job.context.cursor || "";

  for (const result of results) {
    const [collection, docId] = result.key.split(":");
    if (!result.ok || !result.embedding) {
      items = updateItem(items, result.key, { status: "error", error: result.error || "embed failed" });
      continue;
    }
    await persistEmbeddingResult(collection, docId, result.embedding, env);
    items = updateItem(items, result.key, { status: "ok" });
    lastDocId = docId;
    recordBatchItemUsage(env, job, "batch/embeddings", job.model, result.usage);
  }

  if (lastDocId) {
    await saveEmbeddingCursor(
      {
        lastCollection: job.context.collection || "",
        lastId: lastDocId,
        completed: false,
      },
      env,
    );
  }
  return items;
}

/** Poll one batch job; collect and apply results when terminal. */
export async function pollAndApplyBatchJob(
  env: BatchEnv,
  job: GeminiBatchJobRecord,
): Promise<GeminiBatchJobRecord> {
  const polled = await pollBatchJob(env, job.geminiJobName);
  job.geminiState = polled.state;

  if (!TERMINAL_BATCH_STATES.has(polled.state)) {
    job.state = polled.state === "JOB_STATE_RUNNING" ? "running" : "submitted";
    await saveBatchJob(job, env);
    return job;
  }

  if (polled.state !== "JOB_STATE_SUCCEEDED") {
    job.state = "failed";
    job.error = polled.error || polled.state;
    job.completedAt = Date.now();
    await saveBatchJob(job, env);
    return job;
  }

  const keys = job.items.map((i) => i.key);
  let items = job.items;
  if (job.kind === "generate") {
    const results = await collectGenerateResults(env, job.geminiJobName, keys);
    if (job.workload === "cluster-label") {
      items = await applyClusterLabelResults(env, job, results);
    } else if (job.workload === "summaries") {
      items = await applySummariesResults(env, job, results);
    }
  } else if (job.kind === "embed") {
    const results = await collectEmbedResults(env, job.geminiJobName, keys);
    items = await applyEmbeddingResults(env, job, results);
  }

  job.items = items;
  job.state = summarizeItemStates(items);
  job.completedAt = Date.now();
  await saveBatchJob(job, env);
  return job;
}

/** Inline fallback for pending/error items on a stuck or partial job. */
export async function runBatchJobFallback(
  env: BatchEnv,
  job: GeminiBatchJobRecord,
): Promise<GeminiBatchJobRecord> {
  const pending = job.items.filter((i) => i.status === "pending" || i.status === "error");
  if (!pending.length) return job;

  job.state = "fallback";
  let items = [...job.items];

  if (job.workload === "cluster-label") {
    for (const item of pending) {
      const verbatims = (item.meta?.verbatims as string[]) || [];
      try {
        const label = await suggestClusterLabel(env, verbatims, true);
        await setDoc(
          "gapClusters",
          item.key,
          { label, labelSource: "fallback", updatedAt: Date.now() },
          env,
        );
        items = updateItem(items, item.key, { status: "fallback" });
      } catch (err) {
        items = updateItem(items, item.key, {
          status: "fallback_failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else if (job.workload === "summaries") {
    const ctx: SummariesBatchContext = {
      accountId: job.context.accountId!,
      dealId: job.context.dealId || null,
      ownerId: job.context.ownerId!,
      teamId: job.context.teamId,
      orgId: job.context.orgId,
      userId: job.context.userId,
    };
    try {
      const input = await buildSummariesContextFromFirestore(ctx.dealId || null, ctx.accountId, env);
      if (input) {
        const result = await runPostCallSummaries(env, input);
        if (result.dealSummary && ctx.dealId) {
          await persistSummaryDraftFromBatch(ctx, result.dealSummary, "deal", env);
          items = updateItem(items, `deal:${ctx.dealId}`, { status: "fallback" });
        }
        if (result.accountSummary) {
          await persistSummaryDraftFromBatch(ctx, result.accountSummary, "account", env);
          items = updateItem(items, `account:${ctx.accountId}`, { status: "fallback" });
        }
      }
    } catch (err) {
      for (const item of pending) {
        items = updateItem(items, item.key, {
          status: "fallback_failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else if (job.workload === "embedding-backfill") {
    for (const item of pending) {
      const collection = String(item.meta?.collection || "");
      const docId = String(item.meta?.docId || item.key.split(":")[1] || "");
      const text = String(item.meta?.text || "");
      try {
        const result = await embedText(env, text, {
          passName: "batch/embeddings-fallback",
          userId: job.context.userId,
        });
        if (!result) throw new Error("embed returned null");
        await persistEmbeddingResult(collection, docId, result.embedding, env);
        items = updateItem(items, item.key, { status: "fallback" });
      } catch (err) {
        items = updateItem(items, item.key, {
          status: "fallback_failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  job.items = items;
  job.state = summarizeItemStates(items);
  job.completedAt = Date.now();
  await saveBatchJob(job, env);
  return job;
}
