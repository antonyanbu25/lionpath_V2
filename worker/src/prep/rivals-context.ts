/**
 * Fallback "How big is this fish?" sizing from SE additional context when web rivals
 * search returns nothing. Only company/account sizing — not deal requirements.
 */

import { extractJson } from "../json";
import { getProvider } from "../providers";
import type { Env, ResearchFact } from "./types";

export interface FishContextMetric {
  label: string;
  value: string;
}

export interface FishContextSizing {
  metrics: FishContextMetric[];
  source: "context";
}

const SIZING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["metrics"],
  properties: {
    metrics: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "aboutCompany"],
        properties: {
          label: {
            type: "string",
            description:
              "Metric name, e.g. Support agents, Funding raised, Employees, Revenue, User volume.",
          },
          value: { type: "string", description: "Figure or range as the SE stated it, max 12 words." },
          aboutCompany: {
            type: "boolean",
            description:
              "True only when this sizes the TARGET COMPANY itself. False for deal requirements, incumbent tools, integrations, timeline, budget, pain, or hiring intent as a need.",
          },
        },
      },
    },
  },
} as const;

const REQUIREMENT_RE =
  /\b(incumbent|integrations?|widget|zendesk|intercom|freshdesk|timeline|budget|pain|meeting|demo|requirement|must have|looking for|evaluating|replace|migration|portal|chat widget|hiring support)\b/i;

function trimWords(value: string, max = 12): string {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .slice(0, max)
    .join(" ");
}

/** Keep only explicit company-sizing lines the SE provided about the target account. */
export function filterFishContextMetrics(
  raw: { label?: string; value?: string; aboutCompany?: boolean }[],
): FishContextMetric[] {
  const out: FishContextMetric[] = [];
  const seen = new Set<string>();
  for (const row of raw || []) {
    if (row.aboutCompany === false) continue;
    const label = trimWords(String(row.label || ""), 4);
    const value = trimWords(String(row.value || ""), 12);
    if (!label || !value) continue;
    if (REQUIREMENT_RE.test(`${label} ${value}`)) continue;
    if (!isCanonicalFishLabel(label)) continue;
    const sanitized = sanitizeFishContextMetricValue(label, value);
    if (!sanitized) continue;
    const canonical = canonicalFishLabel(label);
    const key = `${canonical.toLowerCase()}|${sanitized.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: canonical, value: sanitized });
    if (out.length >= 3) break;
  }
  return out;
}

type FishSupplementAxis = { label?: string; prospect?: { display?: string; numeric?: number } | null };

function axisHasProspectValue(axis: FishSupplementAxis): boolean {
  const prospect = axis.prospect;
  if (!prospect) return false;
  if (Number.isFinite(prospect.numeric)) return true;
  const display = String(prospect.display || "").trim();
  return !!display && !UNKNOWN_VALUES.has(display.toLowerCase());
}

/** Labels already covered by a web-sourced rival axis with a prospect value (fuzzy). */
export function fishContextSupplementMetrics(
  metrics: FishContextMetric[] | undefined,
  axes: (string | FishSupplementAxis)[] | undefined,
): FishContextMetric[] {
  if (!metrics?.length) return [];
  const covered = (axes || [])
    .map((axis) => {
      if (typeof axis === "string") return axis;
      if (!axisHasProspectValue(axis)) return "";
      return String(axis.label || "");
    })
    .map((l) => l.toLowerCase())
    .filter(Boolean);
  const out: FishContextMetric[] = [];
  for (const m of metrics) {
    const label = String(m.label || "");
    if (!isCanonicalFishLabel(label)) continue;
    const canonical = canonicalFishLabel(label).toLowerCase();
    const dup = covered.some(
      (a) => a.includes(canonical) || canonical.includes(a) || tokenOverlap(a, canonical) >= 2,
    );
    if (dup) continue;
    out.push({ label: canonicalFishLabel(label), value: m.value });
  }
  return out.slice(0, 3);
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(/\W+/).filter((w) => w.length > 2));
  const tb = new Set(b.split(/\W+/).filter((w) => w.length > 2));
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n;
}

const UNKNOWN_VALUES = new Set(["unknown", "n/a", "na", "not found", "unclear", "—", "-"]);

const FISH_METRIC_BOUNDS: Record<string, number> = {
  employees: 500_000,
  supportAgents: 50_000,
  funding: 1e15,
};

const HEADCOUNT_FORBIDDEN_SUFFIX = /^(?:t|tn|trillion|b|bn|billion)$/i;

function fishMetricTypeFromLabel(label: string): string | null {
  const l = String(label || "").toLowerCase();
  if (/\b(employees?|headcount|staff|employee count)\b/.test(l) && !/\bsupport\b/.test(l)) return "employees";
  if (/\bfunding\b/.test(l)) return "funding";
  if (/\b(support agents?|support team|agent count|agents?)\b/.test(l)) return "supportAgents";
  return null;
}

/** Reject funding-scale magnitudes on headcount fields (e.g. "4 trillion" agents). */
function sanitizeFishContextMetricValue(label: string, value: string): string | null {
  const type = fishMetricTypeFromLabel(label);
  if (!type) return value;
  const text = String(value || "").trim();
  const match = text.match(
    /(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*(t|tn|trillion|b|bn|billion|m|mm|mn|million|k|thousand)?/i,
  );
  if (!match) return text;
  const n = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return text;
  const suffix = (match[2] || "").trim();
  let numeric = n;
  const max = FISH_METRIC_BOUNDS[type];
  if (suffix) {
    if ((type === "employees" || type === "supportAgents") && HEADCOUNT_FORBIDDEN_SUFFIX.test(suffix)) {
      return n <= max ? String(Math.round(n)) : null;
    }
    if (/^(?:m|mm|mn|million)$/i.test(suffix)) numeric = n * 1e6;
    else if (/^(?:k|thousand)$/i.test(suffix)) numeric = n * 1e3;
    else if (/^(?:b|bn|billion)$/i.test(suffix)) numeric = n * 1e9;
    else if (/^(?:t|tn|trillion)$/i.test(suffix)) numeric = n * 1e12;
  }
  if (numeric > max) {
    if (suffix && n <= max) return String(Math.round(n));
    return null;
  }
  return text;
}

/** Map verified research facts to fish INPUT rows (no LLM). */
const FISH_FACT_LABELS: Record<string, string> = {
  "Company size": "Employees",
  "Support team": "Support agents",
};

const CANONICAL_FISH_LABEL_RE =
  /\b(employees?|employee count|headcount|staff|support agents?|support team|agent count|agents?|funding)\b/i;

function isCanonicalFishLabel(label: string): boolean {
  const l = String(label || "").toLowerCase();
  if (!l || !CANONICAL_FISH_LABEL_RE.test(l)) return false;
  if (/\b(industry|ownership|customer base|user volume|revenue)\b/.test(l)) return false;
  if (/\b(employees?|headcount|staff|employee count)\b/.test(l) && !/\bsupport\b/.test(l)) return true;
  if (/\bfunding\b/.test(l)) return true;
  if (/\b(support agents?|support team|agent count|agents?)\b/.test(l)) return true;
  return false;
}

function canonicalFishLabel(label: string): string {
  const l = String(label || "").toLowerCase();
  if (/\b(employees?|headcount|staff|employee count)\b/.test(l) && !/\bsupport\b/.test(l)) return "Employees";
  if (/\bfunding\b/.test(l)) return "Funding raised";
  return "Support agents";
}

function isUsableFactValue(raw: string): boolean {
  const v = String(raw || "").trim();
  if (!v || v.length < 2) return false;
  return !UNKNOWN_VALUES.has(v.toLowerCase());
}

function looksLikeSupportTeam(value: string): boolean {
  return /\b(support|agent|agents|users?)\b/i.test(String(value || ""));
}

/** Resolve company-size tile value — mirrors web About fallbacks. */
function resolveCompanySizeFromPrep(prep: {
  facts?: ResearchFact[];
  businessContext?: { users?: string };
}): string | undefined {
  const fact = prep.facts?.find((f) => f.key === "Company size");
  if (fact) {
    const value = trimWords(String(fact.value || ""), 12);
    if (isUsableFactValue(value) && !looksLikeSupportTeam(value)) return value;
  }
  const users = trimWords(String(prep.businessContext?.users || ""), 12);
  if (isUsableFactValue(users) && !looksLikeSupportTeam(users)) return users;
  return undefined;
}

/** Build fish sizing from final prep JSON (facts + businessContext + companySizeAgents). */
export function fishSizingFromPrepResult(prep: {
  facts?: ResearchFact[];
  businessContext?: { users?: string; fundingParent?: string };
  companySizeAgents?: { agents?: string };
} | null | undefined): FishContextSizing | null {
  if (!prep) return null;
  const syntheticFacts: ResearchFact[] = [];
  const companySize = resolveCompanySizeFromPrep(prep);
  if (companySize) {
    syntheticFacts.push({ key: "Company size", value: companySize, category: "signal", sourceLabel: "SE" });
  }
  const supportFact = prep.facts?.find((f) => f.key === "Support team");
  const supportVal = trimWords(
    String(prep.companySizeAgents?.agents || supportFact?.value || ""),
    12,
  );
  if (isUsableFactValue(supportVal)) {
    syntheticFacts.push({ key: "Support team", value: supportVal, category: "signal", sourceLabel: "SE" });
  }
  for (const fact of prep.facts || []) {
    if (fact.key === "Company size" || fact.key === "Support team") continue;
    const label = FISH_FACT_LABELS[String(fact.key || "")];
    if (!label) continue;
    const value = trimWords(String(fact.value || ""), 12);
    if (!isUsableFactValue(value)) continue;
    syntheticFacts.push({ ...fact, value });
  }
  return fishSizingFromResearchFacts(syntheticFacts);
}

/** Build fish sizing metrics directly from grounded research facts. */
export function fishSizingFromResearchFacts(facts: ResearchFact[] | undefined): FishContextSizing | null {
  const metrics: FishContextMetric[] = [];
  const seen = new Set<string>();
  for (const fact of facts || []) {
    const label = FISH_FACT_LABELS[String(fact.key || "")];
    if (!label) continue;
    const value = trimWords(String(fact.value || ""), 12);
    if (!isUsableFactValue(value)) continue;
    const key = `${label.toLowerCase()}|${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    metrics.push({ label, value });
    if (metrics.length >= 3) break;
  }
  if (!metrics.length) return null;
  return { metrics, source: "context" };
}

/** Merge fish context metrics; first wins on duplicate labels. */
export function mergeFishContextSizing(
  ...groups: (FishContextSizing | null | undefined)[]
): FishContextSizing | null {
  const metrics: FishContextMetric[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const m of group?.metrics || []) {
      if (!isCanonicalFishLabel(String(m.label || ""))) continue;
      const key = canonicalFishLabel(String(m.label || "")).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      metrics.push({ label: canonicalFishLabel(String(m.label || "")), value: m.value });
    }
  }
  if (!metrics.length) return null;
  return { metrics: metrics.slice(0, 3), source: "context" };
}

/** Compose LLM input from company, domain, emails, facts, and optional AE notes. */
export function buildFishSizingPromptContext(input: {
  companyName: string;
  companyDomain?: string;
  emails?: string[];
  facts?: ResearchFact[];
  aeContext?: string;
}): string {
  const lines: string[] = [];
  if (input.companyName) lines.push(`Company: ${input.companyName}`);
  if (input.companyDomain) lines.push(`Domain: ${input.companyDomain}`);
  if (input.emails?.length) lines.push(`Prospect emails: ${input.emails.join(", ")}`);
  for (const fact of input.facts || []) {
    const label = FISH_FACT_LABELS[String(fact.key || "")] || String(fact.key || "").trim();
    const value = String(fact.value || "").trim();
    if (!label || !isUsableFactValue(value)) continue;
    lines.push(`${label}: ${value}`);
  }
  const ae = String(input.aeContext || "").trim();
  if (ae) lines.push("", "SE additional notes:", ae);
  return lines.join("\n").trim();
}

/** Extract company sizing from merged AE context (runs in parallel with web rivals search). */
export async function extractFishSizingFromContext(
  env: Env,
  additionalContext: string | undefined,
  companyName: string,
): Promise<FishContextSizing | null> {
  const text = String(additionalContext || "").trim();
  if (text.length < 12 || !companyName) return null;

  const provider = getProvider(env);
  let result;
  try {
    result = await provider.generate({
      system: `Extract ONLY company/account sizing facts the SE stated about ${companyName}.
Include: headcount, support agents/team size, funding, revenue, user/customer volume, fleet size, market cap — when explicitly about ${companyName}.
CRITICAL: support agents ≠ employees. "40-50 support users" is Support agents, NOT Employees or headcount.
Label support-team counts as "Support agents". Label employee headcount as "Employees" only when explicitly about total staff.
End-customer scale ("user base", "customer volume") is NOT company size — label as "User volume" or "Customer base".
Exclude: deal requirements (incumbent tool, integrations, widget, timeline, budget, pain, meeting logistics, hiring as a need, product evaluation).
Set aboutCompany=false for anything that describes what they want or use, not how big ${companyName} is.
Values max 12 words. Labels max 4 words. No invention.`,
      user: `Target company: ${companyName}\n\nSE context:\n${text.slice(0, 4000)}`,
      maxTokens: 800,
      temperature: 0,
      research: false,
      effort: "low",
      jsonSchema: SIZING_SCHEMA as unknown as Record<string, unknown>,
      passName: "prep/rivals-context",
    });
  } catch (err) {
    console.warn("prep/rivals-context skipped:", (err as Error).message);
    return null;
  }

  try {
    const parsed = extractJson<{ metrics?: { label?: string; value?: string; aboutCompany?: boolean }[] }>(
      result.text,
    );
    const metrics = filterFishContextMetrics(parsed.metrics ?? []);
    if (!metrics.length) return null;
    return { metrics, source: "context" };
  } catch (err) {
    console.warn("prep/rivals-context unparsable:", (err as Error).message);
    return null;
  }
}
