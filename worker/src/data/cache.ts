/**
 * In-process read-through cache for server-side Firestore repositories.
 */

import type { FirestoreDoc } from "./firestore-admin";

const LONG_TTL_MS = 60_000;
const SHORT_TTL_MS = 15_000;
const LONG_COLS = new Set(["users", "teams", "orgs", "accounts"]);

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

function ttlForCollection(col: string): number {
  return LONG_COLS.has(col) ? LONG_TTL_MS : SHORT_TTL_MS;
}

function stableQueryKey(col: string, spec: unknown): string {
  return `query:${col}:${JSON.stringify(spec)}`;
}

function peek(key: string): { hit: true; value: unknown } | { hit: false } {
  const entry = store.get(key);
  if (!entry) return { hit: false };
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return { hit: false };
  }
  return { hit: true, value: entry.value };
}

function put(key: string, value: unknown, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidateByPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function clearAll(): void {
  store.clear();
}

export async function cachedGetDoc(
  col: string,
  id: string,
  fetcher: () => Promise<FirestoreDoc | null>,
): Promise<FirestoreDoc | null> {
  const key = `${col}:${id}`;
  const cached = peek(key);
  if (cached.hit) return cached.value as FirestoreDoc | null;
  const value = await fetcher();
  put(key, value, ttlForCollection(col));
  return value;
}

export async function cachedQuery<T>(
  col: string,
  spec: unknown,
  fetcher: () => Promise<T>,
): Promise<T> {
  const key = stableQueryKey(col, spec);
  const cached = peek(key);
  if (cached.hit) return cached.value as T;
  const value = await fetcher();
  put(key, value, ttlForCollection(col));
  return value;
}
