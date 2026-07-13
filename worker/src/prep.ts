// Provider-agnostic prep pipeline. Builds the GetGo-format prompt, calls whichever LLM provider
// is configured (see providers/index.ts), and parses the returned JSON defensively.
//
// Grounding rules (mirrors rfp-automation/agents/drafter.py): Freshworks facts come only from the
// KB; prospect facts come only from web research and are cited; gaps say "unknown" rather than
// being invented. Confidence is embedded inline in techStack.summary, per the GetGo template.

import { FRESHWORKS_KB } from "./kb";
import { extractJson } from "./json";
import { PREP_SCHEMA, type Prep } from "./schema";
import { getProvider } from "./providers";
import type { ProviderEnv } from "./providers/types";

export type Env = ProviderEnv;

export interface PrepInput {
  companyName: string;
  prospectEmail: string;
  prospectName?: string;
  additionalContext?: string;
  meetingType?: string;
  ae?: string;
  effort?: string;
}

const ALLOWED_EFFORT = ["low", "medium", "high", "xhigh", "max"];

export function deriveDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

function usesGeminiStructuredOutput(env: Env): boolean {
  return (env.LLM_PROVIDER || "gemini").toLowerCase() === "gemini";
}

function systemPrompt(env: Env): string {
  const schemaBlock = usesGeminiStructuredOutput(env)
    ? `OUTPUT — CRITICAL: respond with a SINGLE JSON object and nothing else. No markdown, no code
fences, no prose. The API enforces the schema (researchSnapshot, demoPlan, sources); use "unknown"
or [] where empty.`
    : `OUTPUT — CRITICAL: respond with a SINGLE JSON object and nothing else. No markdown, no code
fences, no prose before or after. It must match exactly this JSON Schema (all fields required;
use "unknown" or [] where empty):

${JSON.stringify(PREP_SCHEMA)}`;

  return `You are a senior Solution Engineer at Freshworks preparing a colleague for an upcoming
customer discovery + demo call. Research the prospect on the web, then produce a tight, scannable
prep brief.

RESEARCH — be fast and focused (aim for 2–3 searches max):
- Start from the company website and "what they do".
- One query for recent, relevant news.
- Infer the support tech stack from signals like the help-center/KB URL pattern (e.g. a
  help.<domain> on Zendesk), careers pages, or job posts — and mark how confident you are.
Use ONLY web findings for prospect facts; cite each non-obvious claim in "sources" with its URL.
Where you can't find something, write "unknown" (or leave the array empty) — never invent.

FRESHWORKS FACTS — use ONLY the knowledge base below (products, capabilities, industry fit,
competitor differentiators, reference customers). Do not invent Freshworks facts.

FILL THE BRIEF:
- researchSnapshot.techStack.summary: prose that names detected tools per category WITH inline
  confidence, e.g. "Helpdesk/KB: Zendesk (inferred from help.<domain> URL, medium confidence).
  CRM/Chat/Phone: unknown." Put every incumbent vendor you actually detect into
  researchSnapshot.techStack.namedVendors (used to decide competitor positioning).
- painPoints / goals: short phrases tied to their business + support model.
- discoveryGaps: 3–5 items, each a short label (e.g. "Stack", "Team/volume", "Incidents",
  "AI maturity") + one sharp question that closes the biggest gap in what you found.
- demoPlan.flow: one line. demoPlan.useCases: 3–4 ranked use cases with a one-line "why" each
  (do NOT name a specific Freshworks feature — the SE picks that). demoPlan.close: a short
  paragraph tying the pitch to their scale/goal + a pilot suggestion.
- demoPlan.differentiators: include an entry ONLY for each vendor in techStack.namedVendors,
  with 1–3 KB-grounded points. If namedVendors is empty, return an empty array.

=== FRESHWORKS KNOWLEDGE BASE ===
${FRESHWORKS_KB}
=== END KNOWLEDGE BASE ===

${schemaBlock}`;
}

function userPrompt(input: PrepInput, domain: string): string {
  const lines = [
    `Prepare the prep brief for this upcoming call.`,
    ``,
    `Company: ${input.companyName}`,
    `Prospect email: ${input.prospectEmail}`,
    `Prospect company domain: ${domain}`,
  ];
  if (input.prospectName) lines.push(`Prospect contact name: ${input.prospectName}`);
  if (input.additionalContext) {
    lines.push("", "Additional context from SE / Roundhouse answers:", input.additionalContext);
  }
  if (input.meetingType) lines.push(`Meeting type: ${input.meetingType}`);
  if (input.ae) lines.push(`Account Executive: ${input.ae}`);
  lines.push(
    ``,
    `Research ${domain}, infer the support model and stack, and fill every field of the schema.`,
  );
  return lines.join("\n");
}

export async function generatePrep(env: Env, input: PrepInput): Promise<Prep> {
  const domain = deriveDomain(input.prospectEmail);
  if (!domain) throw new Error("Could not derive a domain from the prospect email.");

  const effort = ALLOWED_EFFORT.includes(input.effort || "")
    ? (input.effort as string)
    : env.EFFORT || "low";

  const provider = getProvider(env);
  const result = await provider.generate({
    maxTokens: 8000,
    system: systemPrompt(env),
    user: userPrompt(input, domain),
    effort,
    research: true,
    thinkingBudget: 0,
    jsonSchema: PREP_SCHEMA as unknown as Record<string, unknown>,
  });
  return extractJson<Prep>(result.text);
}
