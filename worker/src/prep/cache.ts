import type { PrepInput, ResearchBundle } from "./types";
import { PLAYBOOK_VERSION, RESEARCH_TTL_MS } from "./types";
import { computeInputHash } from "./normalize-input";

export function isResearchFresh(bundle: ResearchBundle | null | undefined, inputHash: string): boolean {
  if (!bundle?.lastResearchedAt || !bundle.inputHash) return false;
  if (bundle.inputHash !== inputHash) return false;
  if (bundle.playbookVersion !== PLAYBOOK_VERSION) return false;
  return Date.now() - bundle.lastResearchedAt < RESEARCH_TTL_MS;
}

export function resolveCachedResearch(
  input: PrepInput,
  emails: string[],
): { cacheHit: boolean; bundle: ResearchBundle | null } {
  if (input.forceRefresh) return { cacheHit: false, bundle: null };

  const inputHash = computeInputHash(input, emails);
  const cached = input.cachedResearch;
  if (cached && isResearchFresh(cached, inputHash)) {
    return { cacheHit: true, bundle: cached };
  }
  return { cacheHit: false, bundle: null };
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
