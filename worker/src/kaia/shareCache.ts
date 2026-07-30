import type { KaiaShareContentResponse } from "./fetchShareContent";
import type { KaiaShareRef } from "./shareLink";

const TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  value: KaiaShareContentResponse;
}

const cache = new Map<string, CacheEntry>();

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
  cache.set(key, { expiresAt: Date.now() + TTL_MS, value });
}

export const KAIA_SHARE_CACHE_TTL_MS = TTL_MS;
