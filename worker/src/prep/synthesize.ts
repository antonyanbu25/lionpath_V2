import { CUSTOMER_SERVICE_BENCHMARK_KB } from "../benchmark-kb";
import { FRESHDESK_ICP_KB, FRESHDESK_OMNI_ICP_KB, FRESHDESK_OMNI_PERSONAS_KB } from "../icp-kb";
import { extractJson } from "../json";
import { getProvider } from "../providers";
import { PREP_SCHEMA, type Prep } from "../schema";
import { normalizePrepOutput } from "../word-limits";
import { kbContextBlock } from "./extract-facts";
import type { Env, ResearchFact, SourceRef } from "./types";

function synthesizeSystemPrompt(): string {
  return `You are a senior Solution Engineer at Freshworks preparing a Discovery + Demo prep brief.

CRITICAL RULES:
- Use ONLY the provided research facts for prospect/account claims — do NOT web search.
- Use ONLY the Freshworks KB for Freshworks product facts.
- Where facts are missing or "unknown", output "unknown" or [] — never invent.
- Every facts[]/signals[]/prospects[] sourceLabel MUST match sources[].label from facts.
- Enforce all word caps from the schema descriptions.

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
  },
  facts: ResearchFact[],
  sources: SourceRef[],
): string {
  return [
    `Prepare Discovery brief for:`,
    `Company: ${input.companyName}`,
    `Domain: ${input.companyDomain}`,
    `Prospect emails: ${input.emails.join(", ")}`,
    input.additionalContext ? `Additional context:\n${input.additionalContext}` : "",
    input.meetingType ? `Meeting type: ${input.meetingType}` : "",
    input.ae ? `AE: ${input.ae}` : "",
    "",
    "Extracted research facts (ONLY source for prospect/account claims):",
    JSON.stringify({ facts, sources }, null, 2),
    "",
    "Fill the full prep brief. prospects[] must have one entry per email.",
    "If a fact is unknown in research, use unknown in output.",
  ]
    .filter(Boolean)
    .join("\n");
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
  },
  facts: ResearchFact[],
  sources: SourceRef[],
): Promise<Prep> {
  const provider = getProvider(env);
  const effort = input.effort || env.EFFORT || "medium";

  const result = await provider.generate({
    system: synthesizeSystemPrompt(),
    user: synthesizeUserPrompt(input, facts, sources),
    maxTokens: 12000,
    temperature: 0,
    research: false,
    effort,
    jsonSchema: PREP_SCHEMA as unknown as Record<string, unknown>,
  });

  try {
    return normalizePrepOutput(extractJson<Prep>(result.text));
  } catch (err) {
    const repaired = await provider.generate({
      system: "Repair malformed JSON. Output ONLY valid JSON matching the schema.",
      user: `Parse error: ${(err as Error).message}\n\nSCHEMA:\n${JSON.stringify(PREP_SCHEMA)}\n\nTEXT:\n${result.text}`,
      maxTokens: 8000,
      temperature: 0,
      research: false,
      effort: "low",
      jsonSchema: PREP_SCHEMA as unknown as Record<string, unknown>,
    });
    return normalizePrepOutput(extractJson<Prep>(repaired.text));
  }
}
