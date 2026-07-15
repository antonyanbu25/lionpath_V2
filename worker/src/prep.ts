// Provider-agnostic prep pipeline. Builds the SE Discovery one-pager prompt, calls whichever LLM
// provider is configured (see providers/index.ts), and parses the returned JSON defensively.
//
// Grounding rules: Freshworks facts come only from the KB; prospect facts come only from web
// research and are cited; gaps use "-" rather than being invented.

import { isLikelyInvalidDomain, suggestDomain } from "./domain";
import { FRESHWORKS_KB } from "./kb";
import { extractJson } from "./json";
import { PREP_SCHEMA, type Prep } from "./schema";
import { getProvider } from "./providers";
import type { ProviderEnv } from "./providers/types";
import { normalizePrepOutput } from "./word-limits";

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
SE Discovery one-pager.

RESEARCH — be fast and focused (aim for 3–4 searches max):
- PRIMARY target: the COMPANY NAME (Google-search it first). Prospect email domains are often
  typos, aliases, or parent-company addresses — never rely on the domain alone.
- If the domain looks invalid or returns no real site, ignore it and research by company name.
- For well-known organizations (e.g. Khan Academy, Stripe, Shopify), use established public
  facts from their official site and reputable sources — never return all "-" or "unknown".
- Start from the official company website, then "what they do" and recent news.
- Infer the support tech stack from signals like help-center/KB URL patterns (e.g. Zendesk),
  careers pages, or job posts.
Use ONLY web findings for prospect facts; cite each non-obvious claim in "sources" with its URL.
Where you truly can't find something, write "-" for string fields (or leave arrays empty).

FRESHWORKS FACTS — use ONLY the knowledge base below (products, capabilities, industry fit,
competitor differentiators, reference customers). Do not invent Freshworks facts.

OUTPUT FORMAT — one printable page, tables and bullets ONLY (no paragraphs):
- description: one-line company summary, max 25 words.
- Table cells (fitSnapshot.*, businessContext key values): max 10 words each.
- Bullets (workflows, discoveryKit.question, sources.claim): max 14 words each.
- discoveryKit.because: max 12 words each.
- painCapabilityValue cells: max 10 words each.

NO-REPEAT RULE — facts in fitSnapshot hero table must NOT appear in businessContext,
discoveryKit, or painCapabilityValue below. Use different angles or omit duplicates.

FIT SNAPSHOT (hero) — max 6 rows with gap enum per row:
- label: short row name (e.g. Industry, Support channels, Incumbent stack)
- thisCompany / industryNorm: max 10 words each
- gap: "large" (big Freshworks opportunity), "partial" (some fit), "parity" (already strong)

BUSINESS CONTEXT — key/value table rows + workflows bullets (max 4):
- market, model, users, uptimeNeed, incumbent, industryUseCase, fundingParent
- workflows: max 4 bullets, max 14 words each

DISCOVERY KIT — max 4 pairs of {question, because}:
- question: sharp discovery question, max 14 words
- because: why to ask, max 12 words

DEMO PREP FLOWCHART — painCapabilityValue, max 3 rows:
- pain → capability → value (Freshworks angle), max 10 words per cell

ATTENDEES: include prospect contact if known; decisionPower enum:
decision_maker | influencer | unknown

SOURCES: 3–5 cited URLs; use "unknown" if URL not found.

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
  const invalidDomain = isLikelyInvalidDomain(domain, input.companyName);
  const suggested = suggestDomain(input.companyName);

  const lines = [
    `Prepare the Discovery brief for this upcoming call.`,
    ``,
    `Company (PRIMARY research target): ${input.companyName}`,
    `Prospect email: ${input.prospectEmail}`,
    `Email domain (hint only): ${domain}`,
  ];

  if (invalidDomain) {
    lines.push(
      ``,
      `⚠ The email domain "${domain}" looks misspelled or non-official.`,
      `Research "${input.companyName}" by COMPANY NAME via web search — do NOT rely on this domain.`,
    );
    if (suggested) {
      lines.push(`Likely official domain: ${suggested} (verify via search, not the typo domain).`);
    }
  } else if (suggested && domain.toLowerCase() !== suggested.toLowerCase()) {
    lines.push(`Note: official domain may be ${suggested} — confirm via search if needed.`);
  }

  if (input.prospectName) lines.push(`Prospect contact name: ${input.prospectName}`);
  if (input.additionalContext) {
    lines.push("", "Additional context from SE / Roundhouse answers:", input.additionalContext);
  }
  if (input.meetingType) lines.push(`Meeting type: ${input.meetingType}`);
  if (input.ae) lines.push(`Account Executive: ${input.ae}`);
  lines.push(
    ``,
    `Google-search "${input.companyName}" first, infer their support model and stack,`,
    `and fill fitSnapshot, businessContext, discoveryKit, and painCapabilityValue with real findings.`,
    `For recognizable orgs, use public knowledge — never leave the entire brief empty.`,
    `Enforce all word caps strictly.`,
  );
  return lines.join("\n");
}

function parsePrep(text: string): Prep {
  return normalizePrepOutput(extractJson<Prep>(text));
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
    return parsePrep(result.text);
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
      return parsePrep(repaired.text);
    } catch (err2) {
      throw new Error(
        `Could not parse prep JSON even after a repair attempt: ${(err2 as Error).message}`,
      );
    }
  }
}
