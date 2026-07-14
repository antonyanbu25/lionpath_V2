// Provider-agnostic prep pipeline. Builds the SE one-pager prompt, calls whichever LLM provider
// is configured (see providers/index.ts), and parses the returned JSON defensively.
//
// Grounding rules: Freshworks facts come only from the KB; prospect facts come only from web
// research and are cited; gaps use "-" rather than being invented.

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
  effort?: string; // optional per-request override (for A/B testing); sanitized below
}

const ALLOWED_EFFORT = ["low", "medium", "high", "xhigh", "max"];

export function deriveDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

function systemPrompt(): string {
  return `You are a senior Solution Engineer at Freshworks preparing a colleague for an upcoming
customer discovery + demo call. Research the prospect on the web, then produce a tight, scannable
SE prep one-pager.

RESEARCH — be fast and focused (aim for 3–4 searches max):
- Start from the company website and "what they do".
- One query for recent, relevant news.
- Infer the support tech stack from signals like the help-center/KB URL pattern (e.g. a
  help.<domain> on Zendesk), careers pages, or job posts.
Use ONLY web findings for prospect facts; cite each non-obvious claim in "sources" with its URL.
Where you can't find something, write "-" for string fields (or leave arrays empty) — never invent.

FRESHWORKS FACTS — use ONLY the knowledge base below (products, capabilities, industry fit,
competitor differentiators, reference customers). Do not invent Freshworks facts.

OUTPUT FORMAT — one scrollable page, bullets not paragraphs:
- Total output ~600–800 words across all fields.
- Table cells (comparison.*.thisCompany and comparison.*.industryNorm): max 12 words each.
- Bullet items (aboutBusiness, supportProcess, workflows, seActions.painPoints): max 15 words each.
- seActions.demoFlow steps: max 15 words each, 4–5 numbered steps (strings only, no numbers in text).
- seActions.discoveryGaps: exactly 3 sharp questions (strings, no labels).
- seActions.painPoints: 3–4 items.
- aboutBusiness, supportProcess, workflows: 3–5 bullets each.
- sources: 3–5 cited URLs for prospect facts.

COMPARISON TABLE (hero) — fill every row; industryNorm = one short typical line for their sector:
- industry: vertical / what they sell
- sizeAgents: headcount or support-team size if known
- supportChannels: email, phone, chat, social, etc.
- incumbentStack: helpdesk, CRM, chat, phone vendors detected
- supportPortal: self-service portal / KB URL or platform
- integrations: key systems tied to support (CRM, billing, etc.)
- webChatWidget: on-site chat widget if any
- fundingParent: funding round, PE owner, or parent company

SE ACTION BLOCKS:
- seActions.topUseCase: single highest-value demo angle (one line, max 15 words).
- seActions.painPoints: 3–4 likely pains tied to their support model.
- seActions.discoveryGaps: 3 questions that close the biggest research gaps.
- seActions.demoFlow: 4–5 demo steps in order (SE picks Freshworks features live — do not name SKUs).

ATTENDEES: include prospect contact if known; note role uncertainty briefly in note field.

=== FRESHWORKS KNOWLEDGE BASE ===
${FRESHWORKS_KB}
=== END KNOWLEDGE BASE ===

OUTPUT — CRITICAL: respond with a SINGLE, strictly valid JSON object and nothing else:
- No markdown, no code fences, no text before or after the object.
- No citation markers (e.g. [1], superscripts), footnotes, or comments.
- No trailing commas; quote and escape every string properly.
It must match exactly this JSON Schema (all fields required; use "-" or [] where empty):

${JSON.stringify(PREP_SCHEMA)}`;
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
    : env.EFFORT || "medium";

  const provider = getProvider(env);
  const result = await provider.generate({
    maxTokens: 12000,
    system: systemPrompt(),
    user: userPrompt(input, domain),
    effort,
    research: true,
  });

  try {
    return extractJson<Prep>(result.text);
  } catch (err) {
    const repaired = await provider.generate({
      system:
        "You repair malformed JSON. Output ONLY a single valid JSON object — no markdown, no " +
        "commentary, no citation markers.",
      user:
        `This must be ONE JSON object matching the schema but it failed to parse ` +
        `(${(err as Error).message}). Return the corrected JSON only.\n\nSCHEMA:\n` +
        `${JSON.stringify(PREP_SCHEMA)}\n\nTEXT:\n${result.text}`,
      maxTokens: 8000,
      effort: "low",
      research: false,
    });
    try {
      return extractJson<Prep>(repaired.text);
    } catch (err2) {
      throw new Error(
        `Could not parse prep JSON even after a repair attempt: ${(err2 as Error).message}`,
      );
    }
  }
}
