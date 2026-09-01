/** SE task list — Cloudflare KV (production) or file backend (VPS). */

import {
  type HistoryBackend,
  type HistoryEnv,
  normalizeHistoryEmail,
} from "./history";

export interface Task {
  id: string;
  title: string;
  status: "recommended" | "pending" | "completed" | "dismissed";
  source: "postcall" | "prep" | "manual";
  sourceKey?: string;
  callId?: string;
  company?: string;
  due?: string;
  dueDate?: number | null;
  createdAt: number;
  completedAt?: number;
}

export type TasksEnv = HistoryEnv & {
  /** VPS / Node: injected by node-server when HISTORY_BACKEND_MODE or PERSISTENCE_READ_MODE is pg. */
  TASKS_BACKEND?: HistoryBackend;
};

const MAX_TASKS = 200;

function resolveBackend(env: TasksEnv): HistoryBackend | null {
  if (env.TASKS_BACKEND) return env.TASKS_BACKEND;
  if (env.HISTORY_BACKEND) return env.HISTORY_BACKEND;
  if (env.HISTORY_KV) return env.HISTORY_KV;
  return null;
}

export function tasksStorageAvailable(env: TasksEnv): boolean {
  return !!resolveBackend(env);
}

function tasksKey(email: string): string {
  return `tasks:${normalizeHistoryEmail(email)}`;
}

export async function loadTasks(env: TasksEnv, email: string): Promise<Task[]> {
  const backend = resolveBackend(env);
  if (!backend) return [];
  const raw = await backend.get(tasksKey(email));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as Task[]) : [];
  } catch {
    return [];
  }
}

export async function saveTasks(
  env: TasksEnv,
  email: string,
  tasks: Task[],
): Promise<Task[]> {
  const backend = resolveBackend(env);
  if (!backend) {
    throw new Error("Task storage is not configured (missing HISTORY_KV or HISTORY_FILE_DIR).");
  }
  const byId = new Map<string, Task>();
  for (const task of tasks) {
    if (task?.id) byId.set(task.id, task);
  }
  const merged = [...byId.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const trimmed = merged.slice(0, MAX_TASKS);
  await backend.put(tasksKey(email), JSON.stringify(trimmed));
  return trimmed;
}

export async function upsertTask(
  env: TasksEnv,
  email: string,
  task: Task,
): Promise<Task[]> {
  const list = await loadTasks(env, email);
  const without = list.filter((t) => t.id !== task.id);
  without.unshift(task);
  return saveTasks(env, email, without);
}

export async function patchTask(
  env: TasksEnv,
  email: string,
  id: string,
  patch: Partial<Task>,
): Promise<Task | null> {
  const list = await loadTasks(env, email);
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const updated = { ...list[idx], ...patch, id };
  list[idx] = updated;
  await saveTasks(env, email, list);
  return updated;
}

export async function deleteTask(
  env: TasksEnv,
  email: string,
  id: string,
): Promise<boolean> {
  const list = await loadTasks(env, email);
  const filtered = list.filter((t) => t.id !== id);
  if (filtered.length === list.length) return false;
  await saveTasks(env, email, filtered);
  return true;
}
