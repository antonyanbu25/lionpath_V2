/**
 * Pre-call LLM pass → model mapping (single source of truth).
 *
 * Cost notes (vs prior defaults of gemini-3.6-flash on research + synthesize):
 * - flash-lite token rates are ~2× cheaper than 3.5/3.6-flash (see cost-rates.ts).
 * - google_search grounding is billed per request on top of tokens; consolidating
 *   company-news onto playbook news snippets removes ~1 grounding call per brief (~$0.035/search).
 * - 30-day research bundle cache skips playbook + gap + extract on repeat accounts.
 * Expected savings: ~40–60% per cold brief, ~85%+ on cache hits (1 synthesize call only).
 */

import type { ProviderEnv } from "./types";

export const DEFAULT_MODEL = "gemini-3.1-flash-lite";
/** Premium tier — only synthesize uses this by default; set SYNTHESIZE_MODEL to override. */
export const PREMIUM_MODEL = "gemini-3.6-flash";

export type PrepPassName =
  | "research"
  | "gap-research"
  | "company-news"
  | "rivals"
  | "extract-facts"
  | "linkedin-pdf"
  | "se-context-extract"
  | "rivals-context"
  | "demo-guidance"
  | "synthesize"
  | "contact/enrich";

export type PassTier = "premium-reasoning" | "grounding" | "extraction";

export interface PassModelConfig {
  model: string;
  tier: PassTier;
  /** Uses google_search when the pass sets research:true (unless cached snippets supplied). */
  grounding?: boolean;
}

/** All 11 pre-call LLM passes — one row each, no scattered env vars per pass. */
export const PREP_PASS_MODELS: Record<PrepPassName, PassModelConfig> = {
  // Grounding — flash-lite + google_search (quality validated on prep-golden fixtures).
  research: { model: DEFAULT_MODEL, tier: "grounding", grounding: true },
  "gap-research": { model: DEFAULT_MODEL, tier: "grounding", grounding: true },
  "company-news": { model: DEFAULT_MODEL, tier: "grounding", grounding: true },
  rivals: { model: DEFAULT_MODEL, tier: "grounding", grounding: true },
  // Pure extraction / structuring — no web search.
  "extract-facts": { model: DEFAULT_MODEL, tier: "extraction" },
  "linkedin-pdf": { model: DEFAULT_MODEL, tier: "extraction" },
  "se-context-extract": { model: DEFAULT_MODEL, tier: "extraction" },
  "rivals-context": { model: DEFAULT_MODEL, tier: "extraction" },
  "demo-guidance": { model: DEFAULT_MODEL, tier: "extraction" },
  "contact/enrich": { model: DEFAULT_MODEL, tier: "extraction" },
  // Premium reasoning — composes the final brief JSON.
  synthesize: { model: PREMIUM_MODEL, tier: "premium-reasoning" },
};

const GROUNDING_PASSES = new Set<PrepPassName>(
  Object.entries(PREP_PASS_MODELS)
    .filter(([, c]) => c.grounding)
    .map(([name]) => name as PrepPassName),
);

function isPremiumModel(model: string): boolean {
  return /^gemini-3\.[56]/i.test(model.trim());
}

/** Resolve the model id for a pre-call pass. Premium requires explicit env or table default on synthesize only. */
export function resolvePassModel(passName: PrepPassName, env: ProviderEnv): string {
  const cfg = PREP_PASS_MODELS[passName];

  if (passName === "synthesize") {
    const explicit = env.SYNTHESIZE_MODEL?.trim();
    if (explicit) return explicit;
    return cfg.model;
  }

  if (GROUNDING_PASSES.has(passName)) {
    const explicit = env.RESEARCH_MODEL?.trim();
    if (explicit) return explicit;
    return cfg.model;
  }

  // Extraction passes: explicit MODEL only when set to a non-premium override, or flash-lite default.
  const model = env.MODEL?.trim();
  if (model && !isPremiumModel(model)) return model;
  return cfg.model;
}

export function resolveDefaultModel(env: ProviderEnv): string {
  return env.MODEL?.trim() || DEFAULT_MODEL;
}

export function resolveResearchModel(env: ProviderEnv): string {
  return resolvePassModel("research", env);
}

export function resolveSynthesizeModel(env: ProviderEnv): string {
  return resolvePassModel("synthesize", env);
}

export function resolvePostCallModel(env: ProviderEnv): string {
  return env.POSTCALL_MODEL?.trim() || DEFAULT_MODEL;
}
