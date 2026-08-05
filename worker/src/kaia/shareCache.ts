import type { KaiaShareContentResponse } from "./fetchShareContent";
import type { KaiaShareRef } from "./shareLink";

const TTL_MS = 15 * 60 * 1000;
/** Max cached Kaia share responses before FIFO eviction. */
export const KAIA_SHARE_CACHE_MAX_ENTRIES = 64;

interface CacheEntry {
  expiresAt: number;
  value: KaiaShareContentResponse;
}

const cache = new Map<string, CacheEntry>();

function evictIfNeeded(): void {
  while (cache.size >= KAIA_SHARE_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function kaiaShareCacheKey(ref: KaiaShareRef): string {
  return `${ref.bento}|${ref.instanceId}|${ref.linkId}|${ref.password}`;
}

export function getCachedKaiaShare(key: string): KaiaShareContentResponse | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCachedKaiaShare(key: string, value: KaiaShareContentResponse): void {
  if (cache.has(key)) cache.delete(key);
  evictIfNeeded();
  cache.set(key, { expiresAt: Date.now() + TTL_MS, value });
}

export const KAIA_SHARE_CACHE_TTL_MS = TTL_MS;
