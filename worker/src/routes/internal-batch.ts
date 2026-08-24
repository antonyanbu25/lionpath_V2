/**
 * Internal cron routes — Gemini Batch poll/enqueue/fallback + nightly read-model rebuild.
 */

import type { Env } from "../env";
import { json } from "../http";
import { isNodeRuntime } from "../video/capability";
import {
  assertFirestoreAvailable,
  firestoreAdminReady,
  queryBy,
  type FirestoreEnv,
} from "../data/firestore-admin";
import {
  findOpenJobByKey,
  listFallbackEligibleJobs,
  listOpenBatchJobs,
  type BatchWorkload,
} from "../data/gemini-batch-jobs";
import {
  enqueueClusterLabelBatch,
  enqueueEmbeddingBackfillBatch,
  enqueueSummariesBatch,
  pollAndApplyBatchJob,
  runBatchJobFallback,
} from "../data/gemini-batch-orchestrator";
import { runDealGraceSweep } from "../jobs/deal-grace-sweep";
import {
  rebuildAccountRollup,
  rebuildDealTraction,
  rebuildOrgMetrics,
  rebuildSeLaunchpad,
  rebuildTeamMetrics,
} from "../data/read-models";
import type { SummariesBatchContext } from "../postcall/summaries-batch";
import type { ProviderEnv } from "../providers/types";

type BatchEnv = Env & ProviderEnv & FirestoreEnv;

function fsEnv(env: Env): FirestoreEnv {
  return env;
}

function ensureNodeFirestore(env: Env): void {
  if (!isNodeRuntime() || !firestoreAdminReady(env)) {
    throw Object.assign(new Error("Internal batch routes require Node runtime with Firestore admin."), {
      status: 503,
    });
  }
  assertFirestoreAvailable(env);
}

function cronSecret(env: Env): string {
  return (env.INTERNAL_CRON_SECRET || process.env.INTERNAL_CRON_SECRET || "").trim();
}

export function verifyInternalCronAuth(request: Request, env: Env): boolean {
  const secret = cronSecret(env);
  if (!secret) return false;
  const header = request.headers.get("X-Cron-Secret") || request.headers.get("x-cron-secret") || "";
  // M4 fix: constant-time comparison to prevent timing side-channel leakage
  // of the cron secret. Uses crypto.timingSafeEqual when available (Node);
  // falls back to a manual constant-time compare for edge runtimes.
  return timingSafeEqualString(header, secret);
}

/**
 * Constant-time string comparison. Returns true iff a === b, but takes time
 * proportional to max(len(a), len(b)) regardless of where the first
 * difference is. Prevents timing side-channels on secret comparisons.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still hash both to keep the timing similar; the length mismatch already
    // tells the attacker the secret length, but not the content.
    let dummy = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) dummy |= 1;
    return false;
  }
  // Node.js crypto.timingSafeEqual requires Buffer inputs.
  try {
    const { timingSafeEqual } = require("crypto") as typeof import("crypto");
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    // Fallback: manual constant-time compare (XOR all bytes).
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
}

function unauthorized(cors: Record<string, string>): Response {
  return json({ error: "Unauthorized." }, 401, cors);
}

export async function handleBatchEnqueuePost(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  ensureNodeFirestore(env);
  if (!verifyInternalCronAuth(request, env)) return unauthorized(cors);

  let body: {
    workload?: BatchWorkload;
    orgId?: string;
    pendingLabels?: Array<{ clusterId: string; verbatims: string[] }>;
    summaries?: SummariesBatchContext;
    userId?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400, cors);
  }

  const workload = body.workload || (_url.searchParams.get("workload") as BatchWorkload | null);
  if (!workload) return json({ error: "workload is required." }, 400, cors);

  const batchEnv = env as BatchEnv;

  if (workload === "cluster-label") {
    if (!body.orgId?.trim() || !body.pendingLabels?.length) {
      return json({ error: "orgId and pendingLabels are required." }, 400, cors);
    }
    const idempotencyKey = `cluster-label:${body.orgId}:${body.pendingLabels.map((l) => l.clusterId).sort().join(",")}`;
    const existing = await findOpenJobByKey("cluster-label", idempotencyKey, fsEnv(env));
    if (existing) return json({ jobId: existing.id, duplicate: true }, 200, cors);

    const job = await enqueueClusterLabelBatch(
      batchEnv,
      body.orgId.trim(),
      body.pendingLabels,
      body.userId,
    );
    return json({ jobId: job?.id || null, enqueued: !!job }, job ? 202 : 200, cors);
  }

  if (workload === "summaries") {
    const ctx = body.summaries;
    if (!ctx?.accountId || !ctx.ownerId) {
      return json({ error: "summaries.accountId and summaries.ownerId are required." }, 400, cors);
    }
    const idempotencyKey = `summaries:${ctx.accountId}:${ctx.dealId || "none"}`;
    const existing = await findOpenJobByKey("summaries", idempotencyKey, fsEnv(env));
    if (existing) return json({ jobId: existing.id, duplicate: true }, 200, cors);

    const job = await enqueueSummariesBatch(batchEnv, ctx);
    return json({ jobId: job?.id || null, enqueued: !!job }, job ? 202 : 200, cors);
  }

  if (workload === "embedding-backfill") {
    const job = await enqueueEmbeddingBackfillBatch(batchEnv);
    return json({ jobId: job?.id || null, enqueued: !!job }, job ? 202 : 200, cors);
  }

  return json({ error: `Unknown workload: ${workload}` }, 400, cors);
}

export async function handleBatchPollPost(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  ensureNodeFirestore(env);
  if (!verifyInternalCronAuth(request, env)) return unauthorized(cors);

  const batchEnv = env as BatchEnv;
  const open = await listOpenBatchJobs(fsEnv(env));
  const results: Array<{ jobId: string; state: string }> = [];

  for (const job of open) {
    const updated = await pollAndApplyBatchJob(batchEnv, job);
    results.push({ jobId: updated.id, state: updated.state });
  }

  return json({ polled: results.length, results }, 200, cors);
}

export async function handleBatchFallbackPost(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  ensureNodeFirestore(env);
  if (!verifyInternalCronAuth(request, env)) return unauthorized(cors);

  const batchEnv = env as BatchEnv;
  const now = Date.now();
  const eligible = await listFallbackEligibleJobs(now, fsEnv(env));
  const results: Array<{ jobId: string; state: string }> = [];

  for (const job of eligible) {
    const updated = await runBatchJobFallback(batchEnv, job);
    results.push({ jobId: updated.id, state: updated.state });
  }

  return json({ fallback: results.length, results }, 200, cors);
}

export async function handleReadModelsNightlyRebuildPost(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  ensureNodeFirestore(env);
  if (!verifyInternalCronAuth(request, env)) return unauthorized(cors);

  const fs = fsEnv(env);
  const ts = Date.now();
  let accountCount = 0;
  let teamCount = 0;
  let orgCount = 0;
  let launchpadCount = 0;

  const accounts = await queryBy("accounts", [], undefined, undefined, fs);
  for (const account of accounts) {
    const accountId = String(account.id);
    await rebuildAccountRollup(accountId, ts, fs);
    const deals = await queryBy("deals", [{ field: "accountId", op: "==", value: accountId }], undefined, undefined, fs);
    for (const deal of deals) {
      await rebuildDealTraction(String(deal.id), ts, fs);
    }
    accountCount += 1;
  }

  const teams = await queryBy("teams", [], undefined, undefined, fs);
  for (const team of teams) {
    await rebuildTeamMetrics(String(team.id), ts, fs);
    teamCount += 1;
  }

  const orgs = await queryBy("orgs", [], undefined, undefined, fs);
  for (const org of orgs) {
    await rebuildOrgMetrics(String(org.id), ts, fs);
    orgCount += 1;
  }

  const users = await queryBy("users", [], undefined, undefined, fs);
  for (const user of users) {
    await rebuildSeLaunchpad(String(user.id), ts, fs);
    launchpadCount += 1;
  }

  return json(
    {
      rebuilt: true,
      accounts: accountCount,
      teams: teamCount,
      orgs: orgCount,
      launchpads: launchpadCount,
    },
    200,
    cors,
  );
}

/** POST /api/internal/deal-grace-sweep — archive closed_won_grace deals past 90 days. */
export async function handleDealGraceSweepPost(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  ensureNodeFirestore(env);
  if (!verifyInternalCronAuth(request, env)) return unauthorized(cors);
  const result = await runDealGraceSweep(fsEnv(env));
  return json(result, 200, cors);
}
