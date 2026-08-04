/**
 * "How big is this fish?" — sizing the prospect against its market rivals.
 *
 * `rivals` are the PROSPECT's competitors (if Anthropic is evaluating, its rivals are OpenAI,
 * Google, xAI). This is deliberately not called `competitors`: the prep schema already uses that
 * word for *our* competitors — `ProspectProfile.competitorTouchpoints` and `Prep.incumbent` mean
 * Zendesk, Intercom, Freshdesk's rivals. Conflating the two would be a lasting bug, so the two
 * vocabularies never meet.
 *
 * Like `demoGuidance` and `assets`, this is NOT part of PREP_SCHEMA — it runs as its own grounded
 * call in parallel with synthesis, so the synthesis model can neither invent a rival nor pay for
 * the extra schema.
 *
 * Grounding discipline, in the same spirit as placeAccount(): every number the SE sees is
 * traceable, and nothing derived is left to the model's opinion.
 *
 *   - A rival needs a citation whose publisher domain is in Gemini's OWN groundingMetadata.
 *     The model names the domain it read; we check that against the real citation set, so a
 *     hallucinated source cannot survive even if it is plausibly spelled.
 *   - An axis renders only with >= MIN_SOURCED_VALUES_PER_AXIS sourced values. A range built from
 *     one point is not a range.
 *   - `min`/`max` and the prospect's position are computed here from the sourced set. The model is
 *     never asked for them, so it cannot round a number into a better story.
 *   - Everything dropped for want of grounding is recorded in `dropped` and logged, because a
 *     silently thinned comparison reads as "we checked and this is all there is".
 */

import { extractJson } from "../json";
import { getProvider } from "../providers";
import { dedupeCitations, normalizeCitations, resolveRedirectUrls } from "./citations";
import type { Citation } from "../providers/types";
import type { Env } from "./types";

/** Two axes always attempted, plus one industry-specific axis the model proposes. */
export const FIXED_RIVAL_AXES = [
  { id: "supportAgents", label: "Support agents" },
  { id: "fundingRaised", label: "Funding raised" },
] as const;

/** A range needs two real points. One sourced value is a data point, not a comparison. */
export const MIN_SOURCED_VALUES_PER_AXIS = 2;
export const MIN_RIVALS = 2;
export const MAX_RIVALS = 4;

export interface RivalSource {
  label: string;
  /** Publisher domain, used as the identity we verify the model's claim against. */
  domain: string;
  url: string;
  title: string;
}

export interface RivalValue {
  /** As reported, e.g. "1,200" or "$450M" — shown to the SE verbatim. */
  display: string;
  /** Parsed for ordering only. A value that will not parse cannot enter a range. */
  numeric: number;
  sourceLabel: string;
}

export interface Rival {
  name: string;
  /** Why this company is a peer of the prospect — one line, from the search. */
  why: string;
  sourceLabel: string;
  /** Keyed by axis id. Only sourced, parseable values survive. */
  values: Record<string, RivalValue>;
}

export interface RivalAxisEndpoint {
  numeric: number;
  display: string;
  rivalName: string;
}

export interface RivalAxis {
  id: string;
  label: string;
  unit?: string;
  /** Only on the model-proposed third axis: why this axis is the telling one here. */
  rationale?: string;
  min: RivalAxisEndpoint;
  max: RivalAxisEndpoint;
  /** The prospect's own value, when it too is sourced. */
  prospect?: { display: string; numeric: number; sourceLabel: string };
  /** Where the prospect sits in the sourced rival range. Absent when unsourced. */
  verdict?: "below" | "within" | "above";
  sourcedCount: number;
}

export interface RivalComparison {
  rivals: Rival[];
  axes: RivalAxis[];
  sources: RivalSource[];
  /** Human-readable notes on what was dropped and why. Never empty silently. */
  dropped: string[];
}

const VALUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["axisId", "display", "sourceDomain"],
  properties: {
    axisId: {
      type: "string",
      description: "supportAgents, fundingRaised, or the thirdAxis id. Never invent another.",
    },
    display: {
      type: "string",
      description:
        "The figure exactly as the source states it, e.g. '1,200' or '$450M'. Empty string when the source does not give it — never estimate.",
    },
    sourceDomain: {
      type: "string",
      description:
        "Publisher domain of the page this figure was read from, e.g. 'reuters.com'. Must be a page actually returned by search.",
    },
  },
} as const;

const RIVALS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rivals"],
  properties: {
    rivals: {
      type: "array",
      maxItems: MAX_RIVALS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "why", "sourceDomain", "values"],
        properties: {
          name: { type: "string", description: "The rival company's name." },
          why: {
            type: "string",
            description: "Why it competes with the prospect, max 12 words. From the source, not inferred.",
          },
          sourceDomain: {
            type: "string",
            description: "Publisher domain establishing this company as a rival of the prospect.",
          },
          values: { type: "array", maxItems: 3, items: VALUE_SCHEMA },
        },
      },
    },
    thirdAxis: {
      type: "object",
      additionalProperties: false,
      required: ["id", "label", "rationale"],
      properties: {
        id: { type: "string", description: "camelCase id, e.g. 'fleetSize'." },
        label: { type: "string", description: "SE-facing label, e.g. 'Fleet size'." },
        unit: { type: "string", description: "Unit if any, e.g. 'vehicles'." },
        rationale: {
          type: "string",
          description: "Why this axis is the telling one for THIS industry, max 16 words.",
        },
      },
    },
    prospectValues: {
      type: "array",
      maxItems: 3,
      items: VALUE_SCHEMA,
      description: "The prospect's own figures on the same axes, when sourced.",
    },
  },
} as const;

const SYSTEM_PROMPT = `You size a sales prospect against the rivals it competes with, for a Solution Engineer preparing a call.

"Rivals" means the PROSPECT's market competitors — other companies fighting for the same customers. It does NOT mean vendors of support software.

Use web search. Every figure must come from a page you actually retrieved.

RULES
- Name 2 to 4 rivals that genuinely compete with the prospect. Comparable size and market, not the market leader unless the prospect is near it.
- For every rival and every figure, give the publisher domain you read it from. If you did not find a page stating it, leave display as "" — an omitted figure is correct, an estimated one is not.
- Never estimate, average, interpolate or infer a figure. No "approximately", no "~", no ranges you constructed yourself.
- Do NOT report a minimum, maximum, average or verdict. Those are computed from your figures, not supplied.
- Axes: always attempt supportAgents (people handling customer support) and fundingRaised (total capital raised).
- Then propose ONE further axis that is the telling size measure in THIS industry, with a one-line rationale. For a mobility company that might be fleet size; for a bank, assets under management. Choose what a buyer in that industry would actually compare on.
- If you cannot source an axis for at least two companies, still report what you found. Do not pad it.`;

function buildUserPrompt(input: {
  companyName: string;
  companyDomain?: string;
  industry?: string;
  businessModel?: string;
}): string {
  const lines = [
    `PROSPECT: ${input.companyName}`,
    input.companyDomain ? `DOMAIN: ${input.companyDomain}` : "",
    input.industry ? `INDUSTRY: ${input.industry}` : "",
    input.businessModel ? `BUSINESS MODEL: ${input.businessModel}` : "",
    "",
    `Find 2-4 companies that compete with ${input.companyName}. For each, and for ${input.companyName} itself, report support headcount, total funding raised, and the one further size measure that matters most in this industry.`,
    "Cite the publisher domain for every figure. Omit any figure you cannot source.",
  ];
  return lines.filter(Boolean).join("\n");
}

const MAGNITUDE_SUFFIXES: Array<[RegExp, number]> = [
  [/^(?:t|tn|trillion)$/i, 1e12],
  [/^(?:b|bn|billion)$/i, 1e9],
  [/^(?:m|mm|mn|million)$/i, 1e6],
  [/^(?:k|thousand)$/i, 1e3],
];

/** Values that mean "no figure" rather than a figure of zero. */
const NON_VALUES = /^(?:|-|–|—|n\/?a|unknown|none|tbd|undisclosed|not disclosed|\?)$/i;

/**
 * Parse a reported figure into a comparable number.
 *
 * Ordering-only: `display` is what the SE sees, so precision loss here never reaches the UI.
 * Returns null for anything we cannot read confidently — the value is then dropped rather than
 * guessed at, because a misparsed number would silently reorder the range.
 */
export function parseMagnitude(raw: string): number | null {
  const text = String(raw ?? "").trim();
  if (NON_VALUES.test(text)) return null;

  // Take the first number in a range ("1,000-1,200 agents"): averaging would invent a figure
  // no source states, and the endpoints are what a range is built from anyway.
  const match = text.match(
    /(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*(t|tn|trillion|b|bn|billion|m|mm|mn|million|k|thousand)?/i,
  );
  if (!match) return null;

  const n = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;

  const suffix = (match[2] || "").trim();
  if (!suffix) return n;
  for (const [pattern, multiplier] of MAGNITUDE_SUFFIXES) {
    if (pattern.test(suffix)) return n * multiplier;
  }
  return n;
}

interface RawValue {
  axisId?: string;
  display?: string;
  sourceDomain?: string;
}

interface RawRival {
  name?: string;
  why?: string;
  sourceDomain?: string;
  values?: RawValue[];
}

interface RawRivals {
  rivals?: RawRival[];
  thirdAxis?: { id?: string; label?: string; unit?: string; rationale?: string };
  prospectValues?: RawValue[];
}

/** Index the call's real citations by publisher domain, minting a stable label per domain. */
export function buildRivalSources(citations: Citation[] | undefined): {
  byDomain: Map<string, RivalSource>;
  sources: RivalSource[];
} {
  const byDomain = new Map<string, RivalSource>();
  const sources: RivalSource[] = [];
  for (const cite of dedupeCitations(normalizeCitations(citations))) {
    // normalizeCitations already prefers the resolved publisher URL and falls back to Gemini's
    // title for the domain when the URI is still a grounding redirect. An entry with no readable
    // domain is unusable here, because the domain IS the identity we verify claims against.
    const domain = String(cite.domain || "").trim().toLowerCase();
    if (!domain || byDomain.has(domain)) continue;
    const source: RivalSource = {
      label: `R${sources.length + 1}`,
      domain,
      url: cite.uri,
      title: cite.title || domain,
    };
    byDomain.set(domain, source);
    sources.push(source);
  }
  return { byDomain, sources };
}

/** Match a model-claimed domain against a real one, tolerating a `www.` or subdomain prefix. */
function resolveDomain(
  claimed: string | undefined,
  byDomain: Map<string, RivalSource>,
): RivalSource | null {
  const key = String(claimed || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  if (!key) return null;
  const direct = byDomain.get(key);
  if (direct) return direct;
  // "blog.reuters.com" cited as "reuters.com" (and the reverse) is the same publisher.
  for (const [domain, source] of byDomain) {
    if (domain.endsWith(`.${key}`) || key.endsWith(`.${domain}`)) return source;
  }
  return null;
}

function normalizeValues(
  raw: RawValue[] | undefined,
  allowedAxisIds: Set<string>,
  byDomain: Map<string, RivalSource>,
  dropped: string[],
  who: string,
): Record<string, RivalValue> {
  const out: Record<string, RivalValue> = {};
  for (const value of raw || []) {
    const axisId = String(value?.axisId || "").trim();
    if (!axisId || !allowedAxisIds.has(axisId) || out[axisId]) continue;

    const display = String(value?.display || "").trim();
    if (NON_VALUES.test(display)) continue; // an omitted figure is the model obeying the prompt

    const source = resolveDomain(value?.sourceDomain, byDomain);
    if (!source) {
      dropped.push(`${who} ${axisId}: cited "${value?.sourceDomain || "nothing"}", not in the search results`);
      continue;
    }
    const numeric = parseMagnitude(display);
    if (numeric == null) {
      dropped.push(`${who} ${axisId}: "${display}" is not a readable figure`);
      continue;
    }
    out[axisId] = { display, numeric, sourceLabel: source.label };
  }
  return out;
}

/**
 * Turn the model's raw answer into a comparison, dropping everything that cannot be traced.
 * Pure, so the grounding rules are testable without a provider.
 */
export function shapeRivalComparison(
  raw: RawRivals | null | undefined,
  citations: Citation[] | undefined,
): RivalComparison | null {
  const dropped: string[] = [];
  const { byDomain, sources } = buildRivalSources(citations);
  if (!byDomain.size) {
    console.warn("[prep/rivals] no grounded citations returned — nothing can be sourced");
    return null;
  }

  const third = raw?.thirdAxis;
  const thirdId = String(third?.id || "").trim();
  const thirdLabel = String(third?.label || "").trim();
  const hasThird = !!thirdId && !!thirdLabel && !FIXED_RIVAL_AXES.some((a) => a.id === thirdId);
  const axisDefs = [
    ...FIXED_RIVAL_AXES.map((a) => ({ id: a.id, label: a.label as string, unit: undefined as string | undefined, rationale: undefined as string | undefined })),
    ...(hasThird
      ? [{
          id: thirdId,
          label: thirdLabel,
          unit: String(third?.unit || "").trim() || undefined,
          rationale: String(third?.rationale || "").trim() || undefined,
        }]
      : []),
  ];
  const allowedAxisIds = new Set(axisDefs.map((a) => a.id));

  const rivals: Rival[] = [];
  for (const rawRival of raw?.rivals || []) {
    const name = String(rawRival?.name || "").trim();
    if (!name || rivals.some((r) => r.name.toLowerCase() === name.toLowerCase())) continue;
    if (rivals.length >= MAX_RIVALS) break;

    // A rival is itself a claim. Unsourced, it does not get to appear at all.
    const source = resolveDomain(rawRival?.sourceDomain, byDomain);
    if (!source) {
      dropped.push(`rival "${name}": no sourced page establishes it as a rival`);
      continue;
    }
    rivals.push({
      name,
      why: String(rawRival?.why || "").trim(),
      sourceLabel: source.label,
      values: normalizeValues(rawRival?.values, allowedAxisIds, byDomain, dropped, `rival "${name}"`),
    });
  }

  if (rivals.length < MIN_RIVALS) {
    console.warn(
      `[prep/rivals] only ${rivals.length} sourced rival(s), need ${MIN_RIVALS} — section omitted. ${dropped.join("; ")}`,
    );
    return null;
  }

  const prospectValues = normalizeValues(raw?.prospectValues, allowedAxisIds, byDomain, dropped, "prospect");

  const axes: RivalAxis[] = [];
  for (const def of axisDefs) {
    const points = rivals
      .map((r) => ({ rivalName: r.name, value: r.values[def.id] }))
      .filter((p): p is { rivalName: string; value: RivalValue } => !!p.value);

    if (points.length < MIN_SOURCED_VALUES_PER_AXIS) {
      dropped.push(
        `axis "${def.label}": ${points.length} sourced value(s), needs ${MIN_SOURCED_VALUES_PER_AXIS}`,
      );
      continue;
    }

    const sorted = [...points].sort((a, b) => a.value.numeric - b.value.numeric);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    const axis: RivalAxis = {
      id: def.id,
      label: def.label,
      ...(def.unit ? { unit: def.unit } : {}),
      ...(def.rationale ? { rationale: def.rationale } : {}),
      min: { numeric: low.value.numeric, display: low.value.display, rivalName: low.rivalName },
      max: { numeric: high.value.numeric, display: high.value.display, rivalName: high.rivalName },
      sourcedCount: points.length,
    };

    const own = prospectValues[def.id];
    if (own) {
      axis.prospect = own;
      // Derived here, never asked of the model — the same reason placeAccount computes its tier.
      axis.verdict =
        own.numeric < axis.min.numeric ? "below" : own.numeric > axis.max.numeric ? "above" : "within";
    }
    axes.push(axis);
  }

  if (!axes.length) {
    console.warn(`[prep/rivals] no axis cleared the sourcing bar — section omitted. ${dropped.join("; ")}`);
    return null;
  }

  // Keep only sources something actually cites, so the chip list matches the figures shown.
  const cited = new Set<string>();
  for (const rival of rivals) {
    cited.add(rival.sourceLabel);
    for (const value of Object.values(rival.values)) cited.add(value.sourceLabel);
  }
  for (const axis of axes) if (axis.prospect) cited.add(axis.prospect.sourceLabel);

  if (dropped.length) {
    console.warn(`[prep/rivals] dropped ${dropped.length} item(s): ${dropped.join("; ")}`);
  }

  return {
    rivals,
    axes,
    sources: sources.filter((s) => cited.has(s.label)),
    dropped,
  };
}

/**
 * Grounded rival comparison. Returns null whenever the result would not be traceable — an absent
 * section is honest, a thinned one pretending to be complete is not.
 */
export async function generateRivalComparison(
  env: Env,
  input: {
    companyName: string;
    companyDomain?: string;
    industry?: string;
    businessModel?: string;
  },
): Promise<RivalComparison | null> {
  if (!input?.companyName) return null;
  const provider = getProvider(env);

  let result;
  try {
    result = await provider.generate({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(input),
      maxTokens: 2200,
      temperature: 0.2,
      // Grounded: the citation set this returns is the only thing a figure can be traced to.
      research: true,
      jsonSchema: RIVALS_SCHEMA as unknown as Record<string, unknown>,
      step: "prep/rivals",
    });
  } catch (err) {
    console.warn("prep/rivals skipped:", (err as Error).message);
    return null;
  }

  try {
    const normalized = dedupeCitations(normalizeCitations(result.citations));
    const resolved = await resolveRedirectUrls(normalized);
    return shapeRivalComparison(extractJson<RawRivals>(result.text), resolved);
  } catch (err) {
    console.warn("prep/rivals unparsable:", (err as Error).message);
    return null;
  }
}
