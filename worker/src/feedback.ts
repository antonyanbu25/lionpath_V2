/** User feedback — per-user KV + global aggregate log. */

import { type HistoryBackend, type HistoryEnv, normalizeHistoryEmail } from "./history";

export interface FeedbackEntry {
  id: string;
  category: "Bug" | "Idea" | "Data quality" | string;
  message: string;
  page?: string;
  email?: string;
  createdAt: number;
}

export type FeedbackEnv = HistoryEnv;

const MAX_FEEDBACK = 100;
const MAX_GLOBAL = 500;
const GLOBAL_KEY = "feedback:global";

function resolveBackend(env: FeedbackEnv): HistoryBackend | null {
  if (env.HISTORY_BACKEND) return env.HISTORY_BACKEND;
  if (env.HISTORY_KV) return env.HISTORY_KV;
  return null;
}

export function feedbackStorageAvailable(env: FeedbackEnv): boolean {
  return !!resolveBackend(env);
}

function feedbackKey(email: string): string {
  return `feedback:${normalizeHistoryEmail(email)}`;
}

export async function loadFeedback(env: FeedbackEnv, email: string): Promise<FeedbackEntry[]> {
  const backend = resolveBackend(env);
  if (!backend) return [];
  const raw = await backend.get(feedbackKey(email));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as FeedbackEntry[]) : [];
  } catch {
    return [];
  }
}

export async function loadGlobalFeedback(env: FeedbackEnv): Promise<FeedbackEntry[]> {
  const backend = resolveBackend(env);
  if (!backend) return [];
  const raw = await backend.get(GLOBAL_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as FeedbackEntry[]) : [];
  } catch {
    return [];
  }
}

async function appendGlobal(env: FeedbackEnv, entry: FeedbackEntry): Promise<void> {
  const backend = resolveBackend(env);
  if (!backend) return;
  const list = await loadGlobalFeedback(env);
  const merged = [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, MAX_GLOBAL);
  await backend.put(GLOBAL_KEY, JSON.stringify(merged));
}

export async function appendFeedback(
  env: FeedbackEnv,
  email: string,
  entry: FeedbackEntry,
): Promise<FeedbackEntry[]> {
  const backend = resolveBackend(env);
  if (!backend) {
    throw new Error("Feedback storage is not configured (missing HISTORY_KV or HISTORY_FILE_DIR).");
  }
  const withEmail = { ...entry, email: entry.email || email };
  const list = await loadFeedback(env, email);
  const merged = [withEmail, ...list.filter((e) => e.id !== withEmail.id)].slice(0, MAX_FEEDBACK);
  await backend.put(feedbackKey(email), JSON.stringify(merged));
  await appendGlobal(env, withEmail);
  return merged;
}

export function normalizeFeedbackCategory(raw: string): FeedbackEntry["category"] {
  const key = String(raw || "").trim().toLowerCase();
  if (key === "bug") return "Bug";
  if (key === "data" || key === "data quality") return "Data quality";
  if (raw === "Bug" || raw === "Idea" || raw === "Data quality") return raw;
  return "Idea";
}
