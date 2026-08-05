/**
 * GET /api/admin/llm-usage — token and cost rollup by pass and model (director scope).
 */

import { requireUser } from "../auth";
import { estimateTokenCostUsd } from "../cost-rates";
import { getDoc, queryBy } from "../data/firestore-admin";
import { resolveRequestContext } from "../data/scope";
import type { Env } from "../env";
import { json } from "../http";
import { isNodeRuntime } from "../video/capability";

interface TokenBucket {
  promptTokens: number;
  outputTokens: number;
  cachedTokens: number;
  groundingQueries: number;
  latencyMs: number;
  callCount: number;
  estimatedCostUsd: number;
}

function emptyBucket(): TokenBucket {
  return {
    promptTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    groundingQueries: 0,
    latencyMs: 0,
    callCount: 0,
    estimatedCostUsd: 0,
  };
}

function addRecord(bucket: TokenBucket, row: Record<string, unknown>): void {
  const promptTokens = Number(row.promptTokens) || 0;
  const outputTokens = Number(row.outputTokens) || 0;
  const cachedTokens = Number(row.cachedTokens) || 0;
  const model = typeof row.model === "string" ? row.model : "unknown";
  bucket.promptTokens += promptTokens;
  bucket.outputTokens += outputTokens;
  bucket.cachedTokens += cachedTokens;
  bucket.groundingQueries += Number(row.groundingQueries) || 0;
  bucket.latencyMs += Number(row.latencyMs) || 0;
  bucket.callCount += 1;
  bucket.estimatedCostUsd += estimateTokenCostUsd(model, {
    promptTokens,
    outputTokens,
    cachedTokens,
  });
}

function parseDateParam(raw: string | null, fallbackMs: number): number {
  if (!raw?.trim()) return fallbackMs;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum > 1_000_000_000_000) return Math.round(asNum);
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return parsed;
  throw Object.assign(new Error(`Invalid date: ${raw}`), { status: 400 });
}

async function assertDirectorOnly(
  request: Request,
  env: Env,
): Promise<{ userId: string; orgId: string }> {
  const verified = await requireUser(request, env);
  if (!verified) {
    throw Object.assign(new Error("Sign-in required."), { status: 401 });
  }
  const ctx = await resolveRequestContext(verified, env);
  if (ctx.role === "admin" && ctx.orgId) {
    return { userId: ctx.userId, orgId: ctx.orgId };
  }
  if (!ctx.orgId) {
    throw Object.assign(new Error("User has no orgId."), { status: 403 });
  }
  const org = await getDoc("orgs", ctx.orgId, env);
  const directorId = typeof org?.directorId === "string" ? org.directorId : "";
  if (ctx.userId !== directorId) {
    throw Object.assign(new Error("Director scope required."), { status: 403 });
  }
  return { userId: ctx.userId, orgId: ctx.orgId };
}

export async function handleAdminLlmUsageGet(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isNodeRuntime()) {
    return json({ error: "LLM usage admin API requires Node runtime." }, 503, cors);
  }

  try {
    const { orgId } = await assertDirectorOnly(request, env);
    const now = Date.now();
    const defaultStart = now - 7 * 24 * 60 * 60 * 1000;
    const startMs = parseDateParam(url.searchParams.get("start"), defaultStart);
    const endMs = parseDateParam(url.searchParams.get("end"), now);
    if (startMs > endMs) {
      return json({ error: "start must be before end." }, 400, cors);
    }

    const orgUsers = await queryBy("users", [{ field: "orgId", op: "==", value: orgId }], undefined, 500, env);
    const userIds = new Set(orgUsers.map((u) => u.id));

    const rows = await queryBy(
      "llmUsage",
      [
        { field: "createdAt", op: ">=", value: startMs },
        { field: "createdAt", op: "<=", value: endMs },
      ],
      { field: "createdAt", direction: "desc" },
      10_000,
      env,
    );

    const byPassName: Record<string, TokenBucket> = {};
    const byModel: Record<string, TokenBucket> = {};
    const total = emptyBucket();

    for (const row of rows) {
      const userId = typeof row.userId === "string" ? row.userId : "";
      if (!userIds.has(userId)) continue;

      const passName = typeof row.passName === "string" ? row.passName : "unknown";
      const model = typeof row.model === "string" ? row.model : "unknown";

      if (!byPassName[passName]) byPassName[passName] = emptyBucket();
      if (!byModel[model]) byModel[model] = emptyBucket();

      addRecord(byPassName[passName], row);
      addRecord(byModel[model], row);
      addRecord(total, row);
    }

    return json(
      {
        startMs,
        endMs,
        orgId,
        byPassName,
        byModel,
        total,
      },
      200,
      cors,
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return json({ error: (err as Error).message }, status, cors);
    throw err;
  }
}
