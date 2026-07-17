// Provider-agnostic prep pipeline. Builds the SE Discovery one-pager prompt, calls whichever LLM
// provider is configured (see providers/index.ts), and parses the returned JSON defensively.
//
// Grounding rules: Freshworks facts come only from the KB; prospect facts come only from web
// research and are cited; gaps use "-" rather than being invented.

import { isLikelyInvalidDomain, suggestDomain } from "./domain";
import { FRESHWORKS_KB } from "./kb";
import { FRESHDESK_ICP_KB, FRESHDESK_OMNI_ICP_KB, FRESHDESK_OMNI_PERSONAS_KB } from "./icp-kb";
import { CUSTOMER_SERVICE_BENCHMARK_KB } from "./benchmark-kb";
import { extractJson } from "./json";
import { PREP_SCHEMA, type Prep } from "./schema";
import { getProvider } from "./providers";
import type { ProviderEnv } from "./providers/types";
import { normalizePrepOutput } from "./word-limits";

export type Env = ProviderEnv;

export interface PrepInput {
  companyName: string;
  prospectEmail: string;
  prospectEmails?: string[];
  prospectName?: string;
  additionalContext?: string;
  meetingType?: string;
  ae?: string;
  effort?: string; // optional per-request override (for A/B testing); sanitized below
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/** Parse comma/semicolon-separated emails; dedupe; cap at 5. */
export function resolveProspectEmails(input: PrepInput): string[] {
  const fromArray = (input.prospectEmails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  const fromString = String(input.prospectEmail || "")
    .split(/[,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const merged = [...fromArray, ...fromString].filter((e) => EMAIL_RE.test(e));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of merged) {
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
    if (out.length >= 5) break;
  }
  return out;
}

const ALLOWED_EFFORT = ["low", "medium", "high", "xhigh", "max"];

export function deriveDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

function systemPrompt(): string {
  return `You are a senior Solution Engineer at Freshworks preparing a colleague for an upcoming
customer discovery + demo call. Research the prospect on the web, then produce a structured
Discovery + Demo prep brief for the SE portal wireframe (Account facts, Signals, Fit, Discovery kit,
Demo script, sandbox checklist).

RESEARCH — be fast and focused (aim for 3–4 searches max):
- PRIMARY target: the COMPANY NAME (Google-search it first). Prospect email domains are often
  typos, aliases, or parent-company addresses — never rely on the domain alone.
- If the domain looks invalid or returns no real site, ignore it and research by company name.
- For well-known organizations (e.g. Khan Academy, Stripe, Shopify), use established public
  facts from their official site and reputable sources.
- Start from the official company website, then "what they do" and recent news.
- Infer the support tech stack from help-center/KB URL patterns (e.g. Zendesk), careers pages,
  or job posts.
Use ONLY web findings for prospect facts; cite each non-obvious claim in "sources" with its URL.
Where you truly can't find something, write "unknown" for string fields (or leave arrays empty).

FRESHWORKS FACTS — use ONLY the knowledge base below (products, capabilities, industry fit,
competitor differentiators, reference customers). Do not invent Freshworks facts.

OUTPUT FORMAT — wireframe brief sections:
WORD CAPS (strict):
- description: max 15 words (one-line header).
- about: max 60 words (account facts paragraph).
- fitSnapshot / businessContext / incumbent / companySizeAgents cells: max 8 words each.
- facts[].value: max 12 words; facts[].key from standard list below.
- signals[].value: max 12 words; signals[].label MUST be exactly one of the six fixed labels.
- supportJD bullets: max 14 words each; title max 12 words.
- evaluatorJD.tools[]: max 4 words each, max 8 tools from evaluator prospect's LinkedIn JD/profile.
- prospects[].experienceSummary: max 20 words — overall career/work experience summary.
- likelyPains: max 12 words each, max 5 items.
- discoveryKit question/because: max 12 words each.
- industryUseCases: return empty array [] (deprecated).
- painCapabilityValue: one row per prioritized pain (max 5). pain max 12 words; capability max 8 words; values[] = 2–3 bullets (max 10 words each). At most one values bullet across all rows may cite BENCHMARK KB.
- icpFit highlights[] and gaps[] max 2 each, max 10 words; frameworkRefs[] max 2, max 8 words. Scannable bullets only.
- checklist items: max 10 words each, max 6 sandbox setup steps for Freshworks demo.
- sources[].title: max 12 words; confidence 0–100 integer.

NO-REPEAT RULE — facts in FIT and facts[] must NOT repeat verbatim in discoveryKit.
painCapabilityValue pains SHOULD match likelyPains[] strings; capability and values must use different angles than discoveryKit.

HEADER: description, about, incumbent, attendees.

FACTS[] — up to 8 rows with keys (in order if known):
Industry, Head office, Company size, Support team, Business model, Ownership, Parent company, Languages.
Each row: key, value, sourceLabel referencing sources[].label.

SIGNALS[] — exactly 6 rows with these labels (verbatim):
Incumbent tool | Integrations | Web chat widget | AI in their current tech stack | Support portal | Hiring support roles
Each: label, value, sourceLabel.

PROSPECTS[] — one entry per prospect email provided; research each on LinkedIn/web:
{ name, role, totalExperience, experienceSummary, priorEmployers[], competitorTouchpoints[], sourceLabel }
Research LinkedIn/careers for role, years experience, overall career summary, prior employers, known Zendesk/Intercom/Zoho use.
Map attendees[] when sparse; never leave prospects empty.

EVALUATOR JD — evaluatorJD: { tools[] } from the primary prospect's LinkedIn job description or profile.
List support/CX platforms and tools they mention (e.g. Zendesk, Salesforce, Intercom, Freshdesk). Empty [] if none found.

SUPPORT JD — supportJD: { title, sourceLabel, bullets[] up to 4 } from company's support-agent LinkedIn/careers posting if found.
- product: "Freshdesk Omni" OR "Freshdesk" — choose ONE using AUTHORITATIVE ICP docs below ONLY
- Score against the SELECTED product ICP doc only
- verdict: Strong | Moderate | Weak | Unknown — use Unknown if account data insufficient
- highlights[] and gaps[] MUST cite named framework traits — max 2 each, max 10 words, scannable bullets
- frameworkRefs[]: 1–2 exact trait/zone names from the chosen ICP doc (verbatim from framework), max 8 words each
- Never invent ICP criteria outside the AUTHORITATIVE framework blocks below
- When prospect role matches OMNI PERSONAS KB, align discovery hooks to persona pains (web sources for facts)

ICP FIT — icpFit: { product, verdict, score?, highlights[], gaps[], frameworkRefs[] }
Each: label, thisCompany, industryNorm, gap (large|partial|parity), gapVerdict (one word).

Also fill businessContext + companySizeAgents + incumbent for downstream use.

LIKELY PAINS — max 5 bullet strings inferred from research.
If Additional context from SE lists customer pains, prepend those to likelyPains[] (dedupe, keep context pains first).

DISCOVERY KIT — max 3 {question, because} pairs.

DEMO SCRIPT — painCapabilityValue: one row per prioritized pain (same order as likelyPains[], max 5 rows).
Pain priority: Additional context pains first (already at top of likelyPains), then remaining likelyPains items.

For EACH row:
- pain: use the matching likelyPains[] string verbatim (shorten to 12 words max if needed)
- capability: one Freshdesk/Omni feature aligned with icpFit.product that addresses THIS pain
- values[]: 2–3 concise outcome bullets for this pain; at most ONE bullet across all rows may cite BENCHMARK KB
Do not invent pains outside likelyPains[] / Additional context. Keep pain and capability to one line each.

CHECKLIST — max 6 sandbox setup items (e.g. configure widget, sample tickets, admin login).

ATTENDEES: prospect contact if known; decisionPower: decision_maker | influencer | unknown

SOURCES — 3–8 entries with label S1, S2, S3… each { label, title, url, confidence }.
Assign confidence: High ≥80, Medium ≥55, Low <55 based on source quality.
Every facts[].sourceLabel, signals[].sourceLabel, supportJD.sourceLabel MUST match a sources[].label.
Use url "unknown" if not found.

=== FRESHWORKS KNOWLEDGE BASE ===
${FRESHWORKS_KB}
=== END KNOWLEDGE BASE ===

=== FRESHDESK ICP — AUTHORITATIVE (email-first / smaller teams) ===
${FRESHDESK_ICP_KB}
=== END FRESHDESK ICP ===

=== FRESHDESK OMNI ICP — AUTHORITATIVE (omnichannel / 50+ agents) ===
${FRESHDESK_OMNI_ICP_KB}
=== END FRESHDESK OMNI ICP ===

=== FRESHDESK OMNI PERSONAS — AUTHORITATIVE (buying committee hooks) ===
${FRESHDESK_OMNI_PERSONAS_KB}
=== END FRESHDESK OMNI PERSONAS ===

=== CUSTOMER SERVICE BENCHMARK — AUTHORITATIVE (stats only) ===
${CUSTOMER_SERVICE_BENCHMARK_KB}
=== END BENCHMARK ===

OUTPUT — CRITICAL: respond with a SINGLE, strictly valid JSON object and nothing else:
- No markdown, no code fences, no text before or after the object.
- No citation markers (e.g. [1], superscripts), footnotes, or comments.
- No trailing commas; quote and escape every string properly.
It must match exactly this JSON Schema (all fields required; use "unknown" or [] where empty):

${JSON.stringify(PREP_SCHEMA)}`;
}

function userPrompt(input: PrepInput, domain: string, emails: string[]): string {
  const invalidDomain = isLikelyInvalidDomain(domain, input.companyName);
  const suggested = suggestDomain(input.companyName);

  const lines = [
    `Prepare the Discovery brief for this upcoming call.`,
    ``,
    `Company (PRIMARY research target): ${input.companyName}`,
    `Prospect emails (${emails.length}): ${emails.join(", ")}`,
    `Primary email: ${emails[0] || input.prospectEmail}`,
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
    `Research EACH prospect email and populate prospects[] with one entry per person.`,
    `and fill facts, signals, fitSnapshot, prospects, icpFit (with frameworkRefs citing ICP traits), discoveryKit, likelyPains (context pains first), painCapabilityValue (one row per likelyPain → feature → values), and checklist with real findings.`,
    `For recognizable orgs, use public knowledge — never leave the entire brief empty.`,
    `Enforce all word caps strictly.`,
  );
  return lines.join("\n");
}

function parsePrep(text: string): Prep {
  return normalizePrepOutput(extractJson<Prep>(text));
}

export async function generatePrep(env: Env, input: PrepInput): Promise<Prep> {
  const emails = resolveProspectEmails(input);
  if (!emails.length) {
    throw new Error("At least one valid prospect email is required.");
  }
  const primaryEmail = emails[0];
  const domain = deriveDomain(primaryEmail);
  if (!domain) throw new Error("Could not derive a domain from the prospect email.");

  const normalizedInput: PrepInput = {
    ...input,
    prospectEmail: primaryEmail,
    prospectEmails: emails,
  };

  const effort = ALLOWED_EFFORT.includes(input.effort || "")
    ? (input.effort as string)
    : env.EFFORT || "medium";

  const provider = getProvider(env);
  const result = await provider.generate({
    maxTokens: 12000,
    system: systemPrompt(),
    user: userPrompt(normalizedInput, domain, emails),
    effort,
    research: true,
    jsonSchema: PREP_SCHEMA as unknown as Record<string, unknown>,
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
      jsonSchema: PREP_SCHEMA as unknown as Record<string, unknown>,
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
