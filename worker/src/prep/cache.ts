import type { PrepInput, ResearchBundle } from "./types";
import { PLAYBOOK_VERSION, RESEARCH_TTL_MS } from "./types";
import { computeInputHash } from "./normalize-input";

const MIN_SOFT_CACHE_FACTS = 8;

function isBundleUsable(bundle: ResearchBundle | null | undefined): boolean {
  if (!bundle?.lastResearchedAt) return false;
  if (bundle.playbookVersion !== PLAYBOOK_VERSION) return false;
  if (Date.now() - bundle.lastResearchedAt >= RESEARCH_TTL_MS) return false;
  return (bundle.facts?.length ?? 0) >= MIN_SOFT_CACHE_FACTS;
}

export function isResearchFresh(bundle: ResearchBundle | null | undefined, inputHash: string): boolean {
  if (!isBundleUsable(bundle)) return false;
  return bundle!.inputHash === inputHash;
}

export function resolveCachedResearch(
  input: PrepInput,
  emails: string[],
): { cacheHit: boolean; bundle: ResearchBundle | null; softCacheHit?: boolean } {
  if (input.forceRefresh) return { cacheHit: false, bundle: null };

  const inputHash = computeInputHash(input, emails);
  const cached = input.cachedResearch;
  if (!cached || !isBundleUsable(cached)) {
    return { cacheHit: false, bundle: null };
  }
  if (cached.inputHash === inputHash) {
    return { cacheHit: true, bundle: cached, softCacheHit: false };
  }
  // Same account/domain within TTL — reuse account research when context/PDF hash changed.
  return { cacheHit: true, bundle: cached, softCacheHit: true };
}

export function buildResearchBundle(
  input: PrepInput,
  emails: string[],
  partial: Omit<ResearchBundle, "lastResearchedAt" | "inputHash" | "playbookVersion">,
): ResearchBundle {
  return {
    ...partial,
    lastResearchedAt: Date.now(),
    inputHash: computeInputHash(input, emails),
    playbookVersion: PLAYBOOK_VERSION,
  };
}
