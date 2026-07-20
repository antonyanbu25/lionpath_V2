import { CUSTOMER_SERVICE_BENCHMARK_KB } from "../benchmark-kb";
import { FRESHDESK_ICP_KB, FRESHDESK_OMNI_ICP_KB, FRESHDESK_OMNI_PERSONAS_KB } from "../icp-kb";
import { extractJson } from "../json";
import { buildPrepSchemaForGemini } from "../gemini-schema";
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
  ]
    .filter(Boolean)
    .join("\n");
}

function isGeminiInvalidSchemaError(err: unknown): boolean {
  const msg = (err as Error)?.message || "";
  return msg.includes("Gemini API 400") && /INVALID_ARGUMENT|invalid argument/i.test(msg);
}

async function generateSynthesis(
  provider: ReturnType<typeof getProvider>,
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
  };

  const geminiSchema = buildPrepSchemaForGemini(PREP_SCHEMA as unknown as Record<string, unknown>);

  try {
    return await provider.generate({
      ...base,
      jsonSchema: geminiSchema,
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
  const provider = getProvider(env);

  const result = await generateSynthesis(provider, input, facts, sources);

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
      jsonMimeOnly: true,
    });
    return normalizePrepOutput(extractJson<Prep>(repaired.text));
  }
}
