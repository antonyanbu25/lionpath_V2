/**
 * LinkedIn "Save to PDF" identity extraction (v2.3, Agent 3).
 *
 * Post-call already parses LinkedIn PDFs client-side and ships the extracted text as
 * `linkedinProfileExports` — but nothing worker-side ever reads it. This module turns that
 * raw text into a small structured identity (name/title/company/seniorityHint) and matches
 * it against the call's transcript speakers / typed contact emails, so a LinkedIn export can
 * auto-fill a page-2 attendee row and its confirmed title can persist to the CRM contact.
 *
 * Identity and context ONLY — never scoring evidence. Nothing in this file's output is wired
 * into scorecard.ts's prompt; see generate.ts / resolve.ts callers for the boundary.
 */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";

export type Env = ProviderEnv;

export type SeniorityHint = "executive" | "general_manager" | "management" | "ic";

export interface LinkedInIdentity {
  name: string;
  title?: string;
  company?: string;
  seniorityHint?: SeniorityHint;
}

export interface LinkedInIdentityMatch extends LinkedInIdentity {
  fileName: string;
  /** Best-matching transcript speaker / typed email label, when one was found. */
  matchedLabel?: string;
  matchConfidence?: number;
}

const EXECUTIVE_TITLE_RE = /\b(chief|c[a-z]o|founder|co-founder|president|owner)\b/i;
const GM_TITLE_RE = /\b(general\s*manager|gm|managing\s*director|regional\s*director|country\s*manager)\b/i;
const MANAGEMENT_TITLE_RE = /\b(vp|vice\s*president|head\s*of|director|senior\s*director)\b/i;

function seniorityHintFromTitle(title: string | undefined): SeniorityHint | undefined {
  if (!title) return undefined;
  if (EXECUTIVE_TITLE_RE.test(title)) return "executive";
  if (GM_TITLE_RE.test(title)) return "general_manager";
  if (MANAGEMENT_TITLE_RE.test(title)) return "management";
  return "ic";
}

/**
 * LinkedIn's "Save to PDF" export reliably opens with the person's name on its own line,
 * followed shortly by a headline line of the form "Title at Company" or "Title | Company"
 * (occasionally just "Title", with company appearing later under Experience). Returns null
 * when the text doesn't look like a LinkedIn profile export at all (caller falls back to LLM).
 */
function parseDeterministic(text: string): LinkedInIdentity | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  // Skip a leading "Contact" / "Summary" style section header some exports include.
  let i = 0;
  while (i < lines.length && /^(contact|summary|profile)$/i.test(lines[i])) i++;
  const name = lines[i];
  if (!name || name.length > 80 || /[@0-9]{4,}/.test(name)) return null; // not a plausible name line

  const headline = lines[i + 1];
  if (!headline) return { name };

  // A real "Title at Company" / "Title | Company" headline is short and reads like a job
  // title, not prose — a career tagline ("Building great products, one release at a time")
  // can coincidentally contain " at " too, so reject anything sentence-shaped rather than
  // guessing. Ambiguous cases fall back to the LLM pass instead.
  const looksLikeTitleOrCompany = (s: string) => !/[,.!?]/.test(s) && s.split(/\s+/).length <= 8;

  const atMatch = headline.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  const pipeMatch = !atMatch ? headline.match(/^(.+?)\s*\|\s*(.+)$/) : null;
  if (atMatch) {
    const title = atMatch[1].trim();
    const company = atMatch[2].trim();
    if (looksLikeTitleOrCompany(title) && looksLikeTitleOrCompany(company)) {
      return { name, title, company, seniorityHint: seniorityHintFromTitle(title) };
    }
  } else if (pipeMatch) {
    const title = pipeMatch[1].trim();
    const company = pipeMatch[2].trim();
    if (looksLikeTitleOrCompany(title) && looksLikeTitleOrCompany(company)) {
      return { name, title, company, seniorityHint: seniorityHintFromTitle(title) };
    }
  }
  // Headline present but doesn't split cleanly into title/company — ambiguous, let the
  // caller decide whether to fall back to the LLM pass rather than guessing here.
  return null;
}

const LINKEDIN_IDENTITY_SCHEMA = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string" },
    title: { type: "string", nullable: true },
    company: { type: "string", nullable: true },
  },
} as const;

function llmSystemPrompt(): string {
  return `Extract the profile owner's identity from this LinkedIn "Save to PDF" export text.
Return their name, current job title, and current company — omit title/company if genuinely
unclear from the text. Never invent a title or company that isn't stated. Respond with JSON only.`;
}

/**
 * Deterministic parse first; only calls the LLM when the export's layout doesn't match the
 * expected pattern (e.g. a redesigned export, or a non-standard "Save to PDF" variant).
 */
export async function extractLinkedInIdentity(
  env: Env,
  text: string,
  ids?: { userId?: string; callId?: string },
): Promise<LinkedInIdentity | null> {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  const deterministic = parseDeterministic(trimmed);
  if (deterministic) return deterministic;

  try {
    const provider = getPostCallProvider(env);
    const result = await provider.generate({
      maxTokens: 300,
      system: llmSystemPrompt(),
      user: trimmed.slice(0, 4000),
      effort: env.POSTCALL_EFFORT || env.EFFORT || "low",
      research: false,
      thinkingBudget: 0,
      temperature: 0,
      jsonSchema: LINKEDIN_IDENTITY_SCHEMA as unknown as Record<string, unknown>,
      passName: "linkedin-identity",
      userId: ids?.userId,
      callId: ids?.callId,
    });
    const parsed = extractJson<{ name?: string; title?: string; company?: string }>(result.text);
    const name = String(parsed.name || "").trim();
    if (!name) return null;
    const title = parsed.title ? String(parsed.title).trim() || undefined : undefined;
    const company = parsed.company ? String(parsed.company).trim() || undefined : undefined;
    return { name, title, company, seniorityHint: seniorityHintFromTitle(title) };
  } catch {
    // Soft-fail — a LinkedIn PDF that can't be parsed just doesn't contribute an identity.
    return null;
  }
}

/** Same normalization spirit as web/identity-merge.js normalizePersonKey — lowercase, strip punctuation/whitespace. */
function normalizeNameKey(label: string | null | undefined): string {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function nameTokens(label: string): Set<string> {
  return new Set(
    String(label || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1),
  );
}

/**
 * Name-similarity match against transcript speakers / typed candidate labels — exact
 * normalized match first, then token-overlap (handles "Priyal Shah" vs "Priyal Shah | SE
 * @Freshworks" or reordered/partial names) above a confidence floor.
 */
export function matchLinkedInIdentityToCandidates(
  identity: LinkedInIdentity,
  candidates: string[],
): { matchedLabel: string; confidence: number } | null {
  const targetKey = normalizeNameKey(identity.name);
  if (!targetKey) return null;

  for (const candidate of candidates) {
    if (normalizeNameKey(candidate) === targetKey) return { matchedLabel: candidate, confidence: 1 };
  }

  const targetTokens = nameTokens(identity.name);
  if (!targetTokens.size) return null;
  let best: { matchedLabel: string; confidence: number } | null = null;
  for (const candidate of candidates) {
    const candidateTokens = nameTokens(candidate);
    if (!candidateTokens.size) continue;
    let overlap = 0;
    for (const t of targetTokens) if (candidateTokens.has(t)) overlap++;
    const confidence = overlap / Math.max(targetTokens.size, candidateTokens.size);
    if (confidence >= 0.5 && (!best || confidence > best.confidence)) {
      best = { matchedLabel: candidate, confidence };
    }
  }
  return best;
}

export async function extractAndMatchLinkedInIdentities(
  env: Env,
  exports: { fileName: string; text: string }[],
  candidates: string[],
  ids?: { userId?: string; callId?: string },
): Promise<LinkedInIdentityMatch[]> {
  const out: LinkedInIdentityMatch[] = [];
  for (const exp of exports) {
    const identity = await extractLinkedInIdentity(env, exp.text, ids);
    if (!identity) continue;
    const match = matchLinkedInIdentityToCandidates(identity, candidates);
    out.push({
      ...identity,
      fileName: exp.fileName,
      matchedLabel: match?.matchedLabel,
      matchConfidence: match?.confidence,
    });
  }
  return out;
}
