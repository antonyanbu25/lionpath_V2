import { CUSTOMER_SERVICE_BENCHMARK_KB } from "../benchmark-kb";
import { toPrepGeminiResponseSchema } from "../gemini-schema";
import { FRESHDESK_ICP_KB, FRESHDESK_OMNI_ICP_KB, FRESHDESK_OMNI_PERSONAS_KB } from "../icp-kb";
import { extractJson } from "../json";
import { getSynthesizeProvider } from "../providers";
import { PREP_SCHEMA, type Prep } from "../schema";
import { normalizePrepOutput } from "../word-limits";
import { canonicalizePrepSources } from "./canonicalize-sources";
import { kbContextBlock } from "./extract-facts";
import { allCriteriaPromptBlock } from "./icp-criteria";
import { applySeContextToDiscovery } from "./se-discovery-hints";
import { applySeContextToPrep, factsFromSeContext, SE_SOURCE } from "./se-context-facts";
import type { Env, ResearchFact, SourceRef } from "./types";

const PREP_GEMINI_SCHEMA = toPrepGeminiResponseSchema();

function synthesizeSystemPrompt(): string {
  return `You are a senior Solution Engineer at Freshworks preparing a Discovery + Demo prep brief.

CRITICAL RULES:
- Use ONLY the provided research facts for prospect/account claims — do NOT web search.
- Use ONLY the Freshworks KB for Freshworks product facts.
- SE-context facts (sourceLabel SE) and verbatim SE notes may fill signals, discovery kit, and likely pains — do NOT overwrite SE values with unknown.
- When Additional context is present: at least 2 of 3 discoveryKit questions MUST reference concrete SE-stated facts (channels, inquiry types, team size, tools).
- Each discoveryKit "because" line MUST cite which SE fact the question probes.
- likelyPains MUST prioritize pains implied by SE notes before generic industry pains.
- Where facts are missing or "unknown", output "unknown" or [] — never invent.
- Every facts[]/signals[]/prospects[]/supportJD sourceLabel MUST match sources[].label from facts.
- supportJD: fill title and bullets ONLY from a real job posting present in the research snippets (a careers page or a cited job listing). If no such posting is in the research, return title "" and bullets [] — never describe a generic support role.
- Map SE-context signal facts (sourceLabel SE) into signals[] when present.
- Enforce all word caps from the schema descriptions.

ICP FITMENT (icpFit.criteria):
- Pick icpFit.product first, then emit ONE criteria row for EVERY id listed below for
  that product. Never invent an id and never emit an id from the other product.
- state "met" or "unmet" requires evidence from the research facts plus a sourceLabel
  that matches sources[].label. When the research is silent, state "unknown" with empty
  evidence — do NOT guess "unmet". Absence of evidence is not evidence of misfit.
- [GATING] criteria ALSO need a "band": copy exactly one band name from that criterion's
  own band list, verbatim. These two facts decide the alignment tier, so the evidence must
  be the concrete figure or category you found (e.g. "220 employees", "email and chat live,
  voice planned Q3"), not a paraphrase. If you cannot source the fact, state "unknown" and
  omit the band — never estimate a band to avoid leaving it blank.
- Do NOT put a "band" on a non-gating criterion; it will be discarded.
- [DISQUALIFIER] criteria: mark "unmet" only on an explicit stated fact (e.g. a hard
  on-prem requirement), never on inference. One unmet disqualifier caps the verdict at Weak.
- There is NO numeric score. The verdict is derived server-side from the gating bands, so
  filling "verdict" is a formality — do not tune rows to reach a verdict you prefer.
- Non-gating criteria are shown to the SE as supporting or contradicting evidence and do
  not change the verdict. Report them honestly rather than strategically.
- icpFit.gaps should name criteria you marked unknown that are worth probing on the call.

=== ICP CRITERIA ===
${allCriteriaPromptBlock()}

${kbContextBlock()}

=== FRESHDESK ICP ===
${FRESHDESK_ICP_KB}
=== FRESHDESK OMNI ICP ===
${FRESHDESK_OMNI_ICP_KB}
=== OMNI PERSONAS ===
${FRESHDESK_OMNI_PERSONAS_KB}
=== BENCHMARK ===
${CUSTOMER_SERVICE_BENCHMARK_KB}

OUTPUT: single JSON object matching PREP_SCHEMA. No markdown.

${JSON.stringify(PREP_SCHEMA)}`;
}

function synthesizeUserPrompt(
  input: {
    companyName: string;
    companyDomain: string;
    emails: string[];
    additionalContext?: string;
    meetingType?: string;
    ae?: string;
    confirmedProspectProfiles?: import("./merge-enrichment").ConfirmedProspectProfile[];
  },
  facts: ResearchFact[],
  sources: SourceRef[],
): string {
  const confirmedBlock =
    input.confirmedProspectProfiles?.length ?
      `\nConfirmed prospect profiles (copy name, role, experience, summary, skills, discHint into matching prospects[] by email order — do NOT overwrite with unknown):\n${JSON.stringify(input.confirmedProspectProfiles, null, 2)}\n`
    : "";

  return [
    `Prepare Discovery brief for:`,
    `Company: ${input.companyName}`,
    `Domain: ${input.companyDomain}`,
    `Prospect emails: ${input.emails.join(", ")}`,
    input.additionalContext ? `Additional context:\n${input.additionalContext}` : "",
    input.meetingType ? `Meeting type: ${input.meetingType}` : "",
    input.ae ? `AE: ${input.ae}` : "",
    confirmedBlock,
    "",
    "Extracted research facts (ONLY source for prospect/account claims):",
    JSON.stringify({ facts, sources }, null, 2),
    "",
    "Fill the full prep brief. prospects[] must have one entry per email.",
    "Prefer LinkedIn PDF facts (sourceLabel LinkedIn PDF) for prospect name, role, experience when present.",
    "If a fact is unknown in research, use unknown in output.",
    input.additionalContext
      ? "Anchor discoveryKit and likelyPains to Additional context first; do not produce generic questions unrelated to SE notes when context exists."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function mergeSeSources(existing: SourceRef[], seSources: SourceRef[]): SourceRef[] {
  const byLabel = new Map(existing.map((s) => [s.label, s]));
  for (const s of seSources) {
    if (!byLabel.has(s.label)) byLabel.set(s.label, s);
  }
  return [...byLabel.values()];
}

/** Overlay regex-parsed SE signal facts so synthesize attributes them to SE, not web. */
export function applySeContextToFacts(
  facts: ResearchFact[],
  sources: SourceRef[],
  additionalContext?: string,
): { facts: ResearchFact[]; sources: SourceRef[] } {
  const se = factsFromSeContext(additionalContext);
  if (!se.facts.length) return { facts, sources };

  const seByKey = new Map(se.facts.map((f) => [f.key, f]));
  const out: ResearchFact[] = [];
  const added = new Set<string>();

  for (const f of facts) {
    const overlay = seByKey.get(f.key);
    if (overlay) {
      added.add(f.key);
      out.push({
        ...f,
        value: overlay.value,
        sourceLabel: "SE",
        sourceUrl: "se-context",
        confidence: overlay.confidence ?? SE_SOURCE.confidence,
        category: overlay.category ?? f.category,
      });
    } else {
      out.push(f);
    }
  }
  for (const f of se.facts) {
    if (!added.has(f.key)) out.push(f);
  }

  return {
    facts: out,
    sources: mergeSeSources(sources, se.sources),
  };
}

function isGeminiInvalidSchemaError(err: unknown): boolean {
  const msg = (err as Error)?.message || "";
  return msg.includes("Gemini API 400") && /INVALID_ARGUMENT|invalid argument/i.test(msg);
}

async function generateSynthesis(
  provider: ReturnType<typeof getSynthesizeProvider>,
  input: {
    companyName: string;
    companyDomain: string;
    emails: string[];
    additionalContext?: string;
    meetingType?: string;
    ae?: string;
    effort?: string;
    confirmedProspectProfiles?: import("./merge-enrichment").ConfirmedProspectProfile[];
  },
  facts: ResearchFact[],
  sources: SourceRef[],
) {
  const effort = input.effort || "medium";
  const base = {
    system: synthesizeSystemPrompt(),
    user: synthesizeUserPrompt(input, facts, sources),
    maxTokens: 12000,
    temperature: 0,
    research: false as const,
    effort,
    step: "prep/synthesize",
  };

  try {
    return await provider.generate({
      ...base,
      jsonSchema: PREP_GEMINI_SCHEMA,
    });
  } catch (err) {
    if (!isGeminiInvalidSchemaError(err)) throw err;
    return await provider.generate({
      ...base,
      jsonMimeOnly: true,
    });
  }
}

export async function synthesizePrep(
  env: Env,
  input: {
    companyName: string;
    companyDomain: string;
    emails: string[];
    additionalContext?: string;
    meetingType?: string;
    ae?: string;
    effort?: string;
    confirmedProspectProfiles?: import("./merge-enrichment").ConfirmedProspectProfile[];
  },
  facts: ResearchFact[],
  sources: SourceRef[],
): Promise<Prep> {
  const provider = getSynthesizeProvider(env);
  const { facts: seFacts, sources: seSources } = applySeContextToFacts(
    facts,
    sources,
    input.additionalContext,
  );

  const result = await generateSynthesis(provider, input, seFacts, seSources);

  function finalizePrep(raw: Prep): Prep {
    // `raw.sources` is the model's own lossy echo of the source list; pass the real
    // research table so rows resolve against it instead of a positional guess.
    const normalized = normalizePrepOutput(raw, { authoritative: seSources });
    const withSignals = applySeContextToPrep(normalized, input.additionalContext);
    const withDiscovery = applySeContextToDiscovery(withSignals, input.additionalContext);
    // Must be last: applySeContextToPrep unshifts the SE source after normalization.
    return canonicalizePrepSources(withDiscovery, { authoritative: seSources }).prep;
  }

  try {
    return finalizePrep(extractJson<Prep>(result.text));
  } catch (err) {
    const repaired = await provider.generate({
      system: "Repair malformed JSON. Output ONLY valid JSON matching the schema.",
      user: `Parse error: ${(err as Error).message}\n\nSCHEMA:\n${JSON.stringify(PREP_SCHEMA)}\n\nTEXT:\n${result.text}`,
      maxTokens: 8000,
      temperature: 0,
      research: false,
      effort: "low",
      jsonSchema: PREP_GEMINI_SCHEMA,
      step: "prep/synthesize-repair",
    });
    return finalizePrep(extractJson<Prep>(repaired.text));
  }
}
