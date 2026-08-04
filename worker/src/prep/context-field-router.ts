/**
 * Route SE additional-context sizing phrases to the correct prep fields / fact tiles.
 * Prevents "support users 40-50" from landing on Company size (employee headcount).
 */

import { FACT_KEYS, type Prep } from "../schema";

export type ContextRouteTarget =
  | "supportTeam"
  | "companySize"
  | "endUserVolume";

/** support agents/users/team/seats followed by a numeric range. */
export const SUPPORT_TEAM_RE =
  /\bsupport\s+(?:agents?|users?|team|seats?)\s*[\d–—-]+|\b[\d–—-]+\s+support\s+(?:agents?|users?|team|seats?)\b/i;

/** Employee / headcount sizing — must not mention support. */
export const EMPLOYEE_SIZE_RE = /\b(?:employees?|headcount|fte)\b/i;

/** End-customer scale — not company headcount or support seats. */
export const END_USER_VOLUME_RE = /\b(?:customers?|users?)\s+(?:volume|base)\b/i;

const SUPPORT_VALUE_RE =
  /\b(?:support\s+(?:agents?|users?|team|seats?)\s*([\d–—-]+(?:\s*[-–—]\s*[\d–—-]+)?)|([\d–—-]+(?:\s*[-–—]\s*[\d–—-]+)?)\s+support\s+(?:agents?|users?|team|seats?))/i;

const EMPLOYEE_VALUE_RE =
  /\b([\d,.]+(?:\s*[-–—]\s*[\d,.]+)?\+?\s*(?:employees?|headcount|fte)|(?:employees?|headcount|fte)\s*[:=]?\s*([\d,.]+(?:\s*[-–—]\s*[\d,.]+)?\+?))/i;

const END_USER_VALUE_RE =
  /\b(?:customers?|users?)\s+(?:volume|base)\s*[:=]?\s*([^\n;,.]{1,40})/i;

function trimWords(value: string, max = 12): string {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .slice(0, max)
    .join(" ");
}

function isBlank(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return !s || s === "unknown" || s === "-";
}

/** Classify a free-text snippet to its intended prep destination. */
export function classifyContextSnippet(text: string): ContextRouteTarget | null {
  const blob = String(text || "").trim();
  if (!blob) return null;
  if (SUPPORT_TEAM_RE.test(blob)) return "supportTeam";
  if (END_USER_VOLUME_RE.test(blob)) return "endUserVolume";
  if (EMPLOYEE_SIZE_RE.test(blob) && !/\bsupport\b/i.test(blob)) return "companySize";
  return null;
}

/** True when a stored value reads as support-team sizing, not employee headcount. */
export function looksLikeSupportTeam(value: string): boolean {
  const v = String(value || "").trim();
  if (!v) return false;
  return SUPPORT_TEAM_RE.test(v) || /\bsupport\s+(?:agents?|users?|team|seats?)\b/i.test(v);
}

/** True when a stored value reads as end-user / customer scale. */
export function looksLikeEndUserVolume(value: string): boolean {
  const v = String(value || "").trim();
  if (!v) return false;
  return END_USER_VOLUME_RE.test(v) || /\b(?:customer|user)\s+base\b/i.test(v);
}

/** True when a stored value reads as employee headcount (not support seats). */
export function looksLikeCompanySize(value: string): boolean {
  const v = String(value || "").trim();
  if (!v || looksLikeSupportTeam(v) || looksLikeEndUserVolume(v)) return false;
  return EMPLOYEE_SIZE_RE.test(v) || /\b[\d,.]+(?:\s*[-–—]\s*[\d,.]+)?\s+employees?\b/i.test(v);
}

export function extractSupportTeamValue(text: string): string | null {
  const m = String(text || "").match(SUPPORT_VALUE_RE);
  if (!m) return null;
  const raw = (m[1] || m[2] || "").trim();
  return raw ? trimWords(raw.replace(/\s+/g, " ")) : null;
}

export function extractCompanySizeValue(text: string): string | null {
  const blob = String(text || "");
  if (!EMPLOYEE_SIZE_RE.test(blob)) return null;
  const m = blob.match(EMPLOYEE_VALUE_RE);
  if (!m) return null;
  const raw = (m[1] || m[2] || "").trim();
  if (!raw || /\bsupport\b/i.test(raw)) return null;
  return trimWords(raw.replace(/\s+/g, " "));
}

export function extractEndUserVolumeValue(text: string): string | null {
  const m = String(text || "").match(END_USER_VALUE_RE);
  if (!m?.[1]) return null;
  return trimWords(m[1].trim());
}

/** Resolve Company size display value — never reuse support-team or end-user figures. */
export function resolveCompanySizeValue(prep: Prep): string | undefined {
  const fact = prep.facts?.find((f) => f.key === "Company size");
  if (fact && !isBlank(fact.value) && !looksLikeSupportTeam(fact.value) && !looksLikeEndUserVolume(fact.value)) {
    return String(fact.value).trim();
  }
  const users = prep.businessContext?.users;
  if (users && looksLikeCompanySize(users)) return String(users).trim();
  return undefined;
}

/** Apply routing rules from SE notes onto prep fields and fact tiles. */
export function routeContextFields(prep: Prep, additionalContext?: string): Prep {
  const text = String(additionalContext || "").trim();
  if (!text) return prep;

  let companySizeAgents = { ...(prep.companySizeAgents || { agents: "unknown", estimated: false }) };
  let businessContext = { ...prep.businessContext! };
  let facts = [...(prep.facts || [])];

  const supportVal = extractSupportTeamValue(text);
  const employeeVal = extractCompanySizeValue(text);
  const endUserVal = extractEndUserVolumeValue(text);

  if (supportVal) {
    companySizeAgents = { agents: supportVal, estimated: false };
    facts = upsertFact(facts, "Support team", supportVal);
    if (looksLikeSupportTeam(businessContext.users)) {
      businessContext = { ...businessContext, users: endUserVal || "unknown" };
    }
    facts = clearMisplacedFact(facts, "Company size", looksLikeSupportTeam);
  }

  if (employeeVal) {
    facts = upsertFact(facts, "Company size", employeeVal);
    if (looksLikeSupportTeam(businessContext.users)) {
      businessContext = { ...businessContext, users: endUserVal || "unknown" };
    } else if (isBlank(businessContext.users) || looksLikeCompanySize(businessContext.users)) {
      businessContext = { ...businessContext, users: employeeVal };
    }
  }

  if (endUserVal) {
    businessContext = { ...businessContext, users: endUserVal };
    facts = clearMisplacedFact(facts, "Company size", looksLikeEndUserVolume);
  }

  // Correct values the model placed on the wrong tile without fresh extraction.
  for (const f of facts) {
    if (f.key === "Company size" && looksLikeSupportTeam(f.value)) {
      const val = trimWords(String(f.value));
      companySizeAgents = { agents: val, estimated: false };
      facts = upsertFact(facts, "Support team", val);
      facts = upsertFact(facts, "Company size", "unknown");
    }
  }

  if (looksLikeSupportTeam(businessContext.users) && !supportVal) {
    const val = trimWords(String(businessContext.users));
    companySizeAgents = { agents: val, estimated: false };
    facts = upsertFact(facts, "Support team", val);
    businessContext = { ...businessContext, users: "unknown" };
  }

  return { ...prep, companySizeAgents, businessContext, facts };
}

function upsertFact(facts: Prep["facts"], key: (typeof FACT_KEYS)[number], value: string): Prep["facts"] {
  const out = [...facts];
  const idx = out.findIndex((f) => f.key === key);
  const row = { key, value: trimWords(value), sourceLabel: "SE" };
  if (idx >= 0) out[idx] = { ...out[idx], ...row };
  else out.push(row);
  return out;
}

function clearMisplacedFact(
  facts: Prep["facts"],
  key: (typeof FACT_KEYS)[number],
  predicate: (v: string) => boolean,
): Prep["facts"] {
  return facts.map((f) => (f.key === key && predicate(String(f.value)) ? { ...f, value: "unknown" } : f));
}

/** Post-synthesize: mirror routeContextFields for fact tiles (web + worker). */
export function applySeContextToFacts(prep: Prep, additionalContext?: string): Prep {
  return routeContextFields(prep, additionalContext);
}
