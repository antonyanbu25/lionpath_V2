/** Post-call history stored in Cloudflare KV — keyed by SE email. */

export interface HistoryEnv {
  HISTORY_KV?: KVNamespace;
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  zoomLink?: string;
  title?: string;
  analysis?: unknown;
  transcriptMeta?: unknown;
  result?: unknown;
}

const MAX_ENTRIES = 100;

export function normalizeHistoryEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

function historyKey(email: string): string {
  return `history:${normalizeHistoryEmail(email)}`;
}

export function historyKvAvailable(env: HistoryEnv): boolean {
  return !!env.HISTORY_KV;
}

export async function loadHistory(env: HistoryEnv, email: string): Promise<HistoryEntry[]> {
  const kv = env.HISTORY_KV;
  if (!kv) return [];
  const raw = await kv.get(historyKey(email));
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
  const kv = env.HISTORY_KV;
  if (!kv) throw new Error("History storage is not configured (missing HISTORY_KV binding).");
  const list = await loadHistory(env, email);
  const without = list.filter((r) => r.id !== entry.id);
  without.unshift(entry);
  const trimmed = without.slice(0, MAX_ENTRIES);
  await kv.put(historyKey(email), JSON.stringify(trimmed));
  return trimmed;
}

export async function replaceHistory(
  env: HistoryEnv,
  email: string,
  entries: HistoryEntry[],
): Promise<HistoryEntry[]> {
  const kv = env.HISTORY_KV;
  if (!kv) throw new Error("History storage is not configured (missing HISTORY_KV binding).");
  const byId = new Map<string, HistoryEntry>();
  for (const entry of entries) {
    if (entry?.id) byId.set(entry.id, entry);
  }
  const merged = [...byId.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const trimmed = merged.slice(0, MAX_ENTRIES);
  await kv.put(historyKey(email), JSON.stringify(trimmed));
  return trimmed;
}
