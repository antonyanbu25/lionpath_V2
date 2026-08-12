/**
 * Browser localStorage sync upload — ops endpoint for post-call / prep / tasks / disputes.
 * User-facing UI calls this "Update"; internal logs use recovery terminology.
 */

import { resolveHistoryEmailForWrite, requireUser } from "../auth";
import { appendFeedback, type FeedbackEntry } from "../feedback";
import {
  historyStorageAvailable,
  loadHistory,
  replaceHistory,
  type HistoryEntry,
  type HistoryEnv,
} from "../history";
import { json } from "../http";
import { saveTasks, type Task } from "../tasks";
import type { Env } from "../env";

export const RECOVERY_MANIFEST_KEY = "recovery:manifest";
const RECOVERY_SIDEcar_PREFIX = "recovery:sidecar:";

export interface RecoveryUploadBody {
  email?: string;
  postCalls?: HistoryEntry[];
  prepBriefs?: unknown[];
  tasks?: Task[];
  feedback?: FeedbackEntry[];
  disputes?: {
    prep?: unknown[];
    score?: unknown[];
    scoreOverrides?: unknown[];
  };
  clientMeta?: {
    userAgent?: string;
    recoveryVersion?: string;
    scannedKeys?: string[];
  };
}

export interface RecoveryManifestLine {
  email: string;
  ts: number;
  counts: {
    postCalls: number;
    prepBriefs: number;
    tasks: number;
    feedback: number;
    disputes: number;
  };
  recordIds: string[];
  recoveryVersion?: string;
}

function resolveBackend(env: HistoryEnv) {
  if (env.HISTORY_BACKEND) return env.HISTORY_BACKEND;
  if (env.HISTORY_KV) return env.HISTORY_KV;
  return null;
}

async function appendManifest(env: HistoryEnv, line: RecoveryManifestLine): Promise<void> {
  const backend = resolveBackend(env);
  if (!backend) return;
  const prev = (await backend.get(RECOVERY_MANIFEST_KEY)) || "";
  const next = prev ? `${prev.trimEnd()}\n${JSON.stringify(line)}` : JSON.stringify(line);
  await backend.put(RECOVERY_MANIFEST_KEY, next.slice(-500_000));
}

async function mergePostCalls(
  env: HistoryEnv,
  email: string,
  incoming: HistoryEntry[],
): Promise<HistoryEntry[]> {
  if (!incoming.length) return loadHistory(env, email);
  const existing = await loadHistory(env, email);
  const byId = new Map<string, HistoryEntry>();
  for (const entry of existing) {
    if (entry?.id) byId.set(entry.id, entry);
  }
  for (const entry of incoming) {
    if (!entry?.id) continue;
    const prev = byId.get(entry.id);
    if (!prev || (entry.timestamp || 0) >= (prev.timestamp || 0)) {
      byId.set(entry.id, entry);
    }
  }
  const merged = [...byId.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return replaceHistory(env, email, merged);
}

async function saveSidecar(env: HistoryEnv, email: string, kind: string, data: unknown): Promise<void> {
  const backend = resolveBackend(env);
  if (!backend) return;
  const key = `${RECOVERY_SIDEcar_PREFIX}${kind}:${email}`;
  let existing: unknown[] = [];
  try {
    const raw = await backend.get(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed;
    }
  } catch {
    /* fresh sidecar */
  }
  const incoming = Array.isArray(data) ? data : [];
  const byKey = new Map<string, unknown>();
  for (const item of existing) {
    const id = (item as { id?: string })?.id;
    if (id) byKey.set(id, item);
    else byKey.set(JSON.stringify(item), item);
  }
  for (const item of incoming) {
    const id = (item as { id?: string })?.id;
    if (id) byKey.set(id, item);
    else byKey.set(JSON.stringify(item), item);
  }
  await backend.put(key, JSON.stringify([...byKey.values()]));
}

function isRecoveryAdmin(email: string): boolean {
  const local = email.split("@")[0] || "";
  return /^(vipin|antony|sathish|ajay)\./.test(local) || local === "admin";
}

export async function handleRecoveryUpload(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!historyStorageAvailable(env)) {
    return json({ error: "History storage is not configured." }, 503, cors);
  }
  const body = (await request.json()) as RecoveryUploadBody;
  const email = await resolveHistoryEmailForWrite(request, env, body);

  const counts = {
    postCalls: 0,
    prepBriefs: 0,
    tasks: 0,
    feedback: 0,
    disputes: 0,
  };
  const recordIds: string[] = [];

  if (Array.isArray(body.postCalls) && body.postCalls.length) {
    const merged = await mergePostCalls(env, email, body.postCalls);
    counts.postCalls = body.postCalls.length;
    recordIds.push(...body.postCalls.map((r) => r.id).filter(Boolean) as string[]);
    console.info(`[recovery] merged ${body.postCalls.length} post-call(s) for ${email} (total ${merged.length})`);
  }

  if (Array.isArray(body.prepBriefs) && body.prepBriefs.length) {
    await saveSidecar(env, email, "prepBriefs", body.prepBriefs);
    counts.prepBriefs = body.prepBriefs.length;
  }

  if (Array.isArray(body.tasks) && body.tasks.length) {
    const existing = await import("../tasks").then((m) => m.loadTasks(env, email));
    const byId = new Map(existing.map((t) => [t.id, t]));
    for (const task of body.tasks) {
      if (task?.id) byId.set(task.id, task);
    }
    await saveTasks(env, email, [...byId.values()]);
    counts.tasks = body.tasks.length;
  }

  if (Array.isArray(body.feedback) && body.feedback.length) {
    for (const entry of body.feedback) {
      if (!entry?.message) continue;
      await appendFeedback(env, email, {
        id: entry.id || crypto.randomUUID(),
        category: entry.category || "Idea",
        message: entry.message,
        page: entry.page,
        email,
        createdAt: entry.createdAt || Date.now(),
        severity: entry.severity,
        area: entry.area,
        priority: entry.priority,
        context: entry.context,
      });
      counts.feedback += 1;
    }
  }

  const disputeBundle = body.disputes || {};
  const disputeItems = [
    ...(Array.isArray(disputeBundle.prep) ? disputeBundle.prep : []),
    ...(Array.isArray(disputeBundle.score) ? disputeBundle.score : []),
    ...(Array.isArray(disputeBundle.scoreOverrides) ? disputeBundle.scoreOverrides : []),
  ];
  if (disputeItems.length) {
    await saveSidecar(env, email, "disputes", disputeItems);
    counts.disputes = disputeItems.length;
  }

  await appendManifest(env, {
    email,
    ts: Date.now(),
    counts,
    recordIds,
    recoveryVersion: body.clientMeta?.recoveryVersion,
  });

  return json({ email, counts, recordIds }, 200, cors);
}

export async function handleRecoveryStatus(
  request: Request,
  env: Env,
  _url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  if (!historyStorageAvailable(env)) {
    return json({ error: "History storage is not configured." }, 503, cors);
  }

  const user = await requireUser(request, env);
  if (!user || !isRecoveryAdmin(user.email)) {
    return json({ error: "Admin access required." }, 403, cors);
  }

  const backend = resolveBackend(env);
  if (!backend) {
    return json({ entries: [], count: 0 }, 200, cors);
  }

  const raw = await backend.get(RECOVERY_MANIFEST_KEY);
  const entries: RecoveryManifestLine[] = [];
  if (raw) {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as RecoveryManifestLine);
      } catch {
        /* skip malformed line */
      }
    }
  }

  return json({ entries, count: entries.length }, 200, cors);
}
