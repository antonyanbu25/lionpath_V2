/**
 * Fallback "How big is this fish?" sizing from SE additional context when web rivals
 * search returns nothing. Only company/account sizing — not deal requirements.
 */

import { extractJson } from "../json";
import { getProvider } from "../providers";
import type { Env } from "./types";

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
    const key = `${label.toLowerCase()}|${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, value });
    if (out.length >= 4) break;
  }
  return out;
}

/** Labels already covered by a web-sourced rival axis (fuzzy). */
export function fishContextSupplementMetrics(
  metrics: FishContextMetric[] | undefined,
  axisLabels: string[] | undefined,
): FishContextMetric[] {
  if (!metrics?.length) return [];
  const axes = (axisLabels || []).map((l) => l.toLowerCase());
  const out: FishContextMetric[] = [];
  for (const m of metrics) {
    const label = String(m.label || "").toLowerCase();
    if (!label) continue;
    const dup = axes.some(
      (a) => a.includes(label) || label.includes(a) || tokenOverlap(a, label) >= 2,
    );
    if (dup) continue;
    out.push(m);
  }
  return out;
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(/\W+/).filter((w) => w.length > 2));
  const tb = new Set(b.split(/\W+/).filter((w) => w.length > 2));
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n;
}

/** Extract company sizing from merged AE context (runs in parallel with web rivals search). */
export async function extractFishSizingFromContext(
  env: Env,
  additionalContext: string | undefined,
  companyName: string,
): Promise<FishContextSizing | null> {
  const text = String(additionalContext || "").trim();
  if (text.length < 20 || !companyName) return null;

  const provider = getProvider(env);
  let result;
  try {
    result = await provider.generate({
      system: `Extract ONLY company/account sizing facts the SE stated about ${companyName}.
Include: headcount, support agents/team size, funding, revenue, user/customer volume, fleet size, market cap — when explicitly about ${companyName}.
Exclude: deal requirements (incumbent tool, integrations, widget, timeline, budget, pain, meeting logistics, hiring as a need, product evaluation).
Set aboutCompany=false for anything that describes what they want or use, not how big ${companyName} is.
Values max 12 words. Labels max 4 words. No invention.`,
      user: `Target company: ${companyName}\n\nSE context:\n${text.slice(0, 4000)}`,
      maxTokens: 800,
      temperature: 0,
      research: false,
      effort: "low",
      jsonSchema: SIZING_SCHEMA as unknown as Record<string, unknown>,
      step: "prep/rivals-context",
    });
  } catch (err) {
    console.warn("prep/rivals-context skipped:", (err as Error).message);
    return null;
  }

  try {
    const parsed = extractJson<{ metrics?: { label?: string; value?: string; aboutCompany?: boolean }[] }>(
      result.text,
    );
    const metrics = filterFishContextMetrics(parsed.metrics);
    if (!metrics.length) return null;
    return { metrics, source: "context" };
  } catch (err) {
    console.warn("prep/rivals-context unparsable:", (err as Error).message);
    return null;
  }
}
