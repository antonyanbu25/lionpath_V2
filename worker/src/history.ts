/** Post-call history — Cloudflare KV (production) or file backend (VPS). */

export interface HistoryEntry {
  id: string;
  timestamp: number;
  zoomLink?: string;
  title?: string;
  analysis?: unknown;
  transcriptMeta?: unknown;
  result?: unknown;
}

/** Minimal key-value interface shared by KV and file storage. */
export interface HistoryBackend {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface HistoryEnv {
  HISTORY_KV?: KVNamespace;
  /** VPS / Node: injected by node-server when HISTORY_FILE_DIR is set. */
  HISTORY_BACKEND?: HistoryBackend;
}

const MAX_ENTRIES = 100;

export function normalizeHistoryEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

function historyKey(email: string): string {
  return `history:${normalizeHistoryEmail(email)}`;
}

function resolveBackend(env: HistoryEnv): HistoryBackend | null {
  if (env.HISTORY_BACKEND) return env.HISTORY_BACKEND;
  if (env.HISTORY_KV) return env.HISTORY_KV;
  return null;
}

export function historyStorageAvailable(env: HistoryEnv): boolean {
  return !!resolveBackend(env);
}

/** @deprecated Use historyStorageAvailable */
export function historyKvAvailable(env: HistoryEnv): boolean {
  return historyStorageAvailable(env);
}

export function historyStorageKind(env: HistoryEnv): "kv" | "file" | "none" {
  if (env.HISTORY_BACKEND) return "file";
  if (env.HISTORY_KV) return "kv";
  return "none";
}

export async function loadHistory(env: HistoryEnv, email: string): Promise<HistoryEntry[]> {
  const backend = resolveBackend(env);
  if (!backend) return [];
  const raw = await backend.get(historyKey(email));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export async function saveHistoryEntry(
  env: HistoryEnv,
  email: string,
  entry: HistoryEntry,
): Promise<HistoryEntry[]> {
  const backend = resolveBackend(env);
  if (!backend) {
    throw new Error("History storage is not configured (missing HISTORY_KV or HISTORY_FILE_DIR).");
  }
  const list = await loadHistory(env, email);
  const without = list.filter((r) => r.id !== entry.id);
  without.unshift(entry);
  const trimmed = without.slice(0, MAX_ENTRIES);
  await backend.put(historyKey(email), JSON.stringify(trimmed));
  return trimmed;
}

export async function replaceHistory(
  env: HistoryEnv,
  email: string,
  entries: HistoryEntry[],
): Promise<HistoryEntry[]> {
  const backend = resolveBackend(env);
  if (!backend) {
    throw new Error("History storage is not configured (missing HISTORY_KV or HISTORY_FILE_DIR).");
  }
  const byId = new Map<string, HistoryEntry>();
  for (const entry of entries) {
    if (entry?.id) byId.set(entry.id, entry);
  }
  const merged = [...byId.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const trimmed = merged.slice(0, MAX_ENTRIES);
  await backend.put(historyKey(email), JSON.stringify(trimmed));
  return trimmed;
}
