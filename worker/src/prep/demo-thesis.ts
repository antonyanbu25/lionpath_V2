/**
 * Demo Prep "The thesis" — theme-first headline for the sixty-second hero tile.
 *
 * Deliberately NOT part of PREP_SCHEMA. Runs after synthesis when the brief is not thin,
 * so incumbent, fitSnapshot, pains, and signals are all available.
 *
 * temperature: 0.04 is used ONLY in this module — do not change other pass temperatures.
 */

import { extractJson } from "../json";
import { getProvider } from "../providers";
import type { Prep } from "../schema";
import type { Env } from "./types";

export interface DemoThesis {
  headline: string;
  sub: string;
}

const THESIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "sub"],
  properties: {
    headline: {
      type: "string",
      description:
        "Demo theme or motion — transformation, gap, or evaluation driver. Max 16 words. NOT a company description.",
    },
    sub: {
      type: "string",
      description: "Proof point, displacement angle, or demo lead-in. Max 14 words.",
    },
  },
} as const;

const SYSTEM_PROMPT = `You write the Demo Prep thesis for a Solution Engineer — the theme of the call, not who the company is.

headline = the motion or story (pick the STRONGEST from supplied signals):
- Transformation: incumbent/tool → target state (use → when natural)
- Maturity gap: where they lag vs industry norm (fitSnapshot)
- Evaluation driver: pain, scale, hiring, or urgency

sub = one proof line: displacement, biggest gap, or what to lead the demo with.

Rules:
- NEVER restate the About paragraph or generic company boilerplate ("B2B SaaS", "manufactures", "leading provider").
- Use ONLY facts in the user message — no invention.
- If signals are too thin to name a credible theme, return {"headline":"","sub":""}.

Good headline: "Email inbox → structured ticketing platform"
Good sub: "Zendesk entrenched — lead with routing + omnichannel"

Bad headline: "Commercial door manufacturer serving healthcare facilities"`;

function trimWords(value: string, max: number): string {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .slice(0, max)
    .join(" ");
}

function isUnknown(val: string): boolean {
  const s = String(val || "").trim().toLowerCase();
  return !s || s === "unknown" || s === "-" || s === "–" || s === "—";
}

/** Mirrors web sixtySeconds() — skip thesis LLM when UI shows listening fallback. */
export function isThinBrief(prep: Pick<Prep, "facts">): boolean {
  const facts = prep.facts || [];
  const total = Math.max(facts.length, 1);
  const sourced = facts.filter((f) => !isUnknown(String(f.value || ""))).length;
  return Math.round((sourced / total) * 100) < 40;
}

/** At least one anchor to ground a theme — not just generic about text. */
export function hasThesisGrounding(prep: Prep, aeContext?: string): boolean {
  const incumbent = String(prep.incumbent?.incumbent_name || "").trim();
  if (incumbent && !isUnknown(incumbent)) return true;

  if ((prep.likelyPains || []).some((p) => !isUnknown(p))) return true;

  if ((prep.fitSnapshot || []).some((f) => f.gap === "large" || f.gap === "partial")) return true;

  if ((prep.signals || []).some((s) => !isUnknown(String(s.value || "")))) return true;

  if ((prep.painCapabilityValue || []).some((r) => !isUnknown(String(r.pain || "")))) return true;

  if (String(aeContext || "").trim().length >= 20) return true;

  return false;
}

const COMPANY_DESC_RE =
  /\b(manufactures|provides|offers|is a|leading|company serving|platform for|specializes in|founded in)\b/i;

/** Trim, validate, and reject company-description theses. */
export function shapeDemoThesis(
  raw: { headline?: string; sub?: string } | null | undefined,
  about?: string,
): DemoThesis | null {
  const headline = trimWords(String(raw?.headline || ""), 16);
  const sub = trimWords(String(raw?.sub || ""), 14);
  if (!headline || !sub) return null;

  const aboutNorm = String(about || "")
    .trim()
    .toLowerCase()
    .slice(0, 48);
  const headNorm = headline.toLowerCase();
  if (aboutNorm.length >= 12 && (headNorm.includes(aboutNorm.slice(0, 24)) || aboutNorm.includes(headNorm.slice(0, 24)))) {
    return null;
  }

  const hasMotion = /\→|->|→/.test(headline) || /\b(from|to|toward|replacing|beyond|off|without)\b/i.test(headline);
  if (COMPANY_DESC_RE.test(headline) && !hasMotion) return null;

  return { headline, sub };
}

export function buildDemoThesisPrompt(prep: Prep, aeContext?: string): string {
  const lines: string[] = [];
  if (prep.description) lines.push(`Description: ${trimWords(prep.description, 20)}`);
  if (prep.about) lines.push(`About (do NOT copy into headline): ${trimWords(prep.about, 30)}`);

  const inc = prep.incumbent;
  if (inc?.incumbent_name && !isUnknown(inc.incumbent_name)) {
    lines.push(`Incumbent: ${inc.incumbent_name}${inc.displacement ? ` (${inc.displacement})` : ""}`);
  }

  for (const row of prep.fitSnapshot || []) {
    if (!row?.label) continue;
    lines.push(
      `Fit ${row.label}: them=${trimWords(row.thisCompany || "", 8)} norm=${trimWords(row.industryNorm || "", 8)} gap=${row.gap}`,
    );
  }

  for (const p of (prep.likelyPains || []).slice(0, 4)) {
    if (!isUnknown(p)) lines.push(`Pain: ${trimWords(p, 12)}`);
  }

  for (const row of (prep.painCapabilityValue || []).slice(0, 3)) {
    if (row.pain) lines.push(`Pain→capability: ${trimWords(row.pain, 10)} → ${trimWords(row.capability || "", 8)}`);
  }

  for (const s of (prep.signals || []).slice(0, 6)) {
    const v = String(s.value || "").trim();
    if (!isUnknown(v)) lines.push(`Signal ${s.label}: ${trimWords(v, 10)}`);
  }

  if (prep.icpFit?.verdict) lines.push(`ICP: ${prep.icpFit.verdict}`);
  for (const h of (prep.icpFit?.highlights || []).slice(0, 2)) {
    if (!isUnknown(h)) lines.push(`ICP highlight: ${trimWords(h, 12)}`);
  }

  const ae = String(aeContext || "").trim();
  if (ae) lines.push("", "SE additional notes:", ae.slice(0, 800));

  return lines.join("\n").trim();
}

export async function generateDemoThesis(
  env: Env,
  prep: Prep,
  aeContext?: string,
): Promise<DemoThesis | null> {
  if (isThinBrief(prep)) return null;
  if (!hasThesisGrounding(prep, aeContext)) return null;

  const user = buildDemoThesisPrompt(prep, aeContext);
  if (user.length < 24) return null;

  const provider = getProvider(env);
  let result;
  try {
    result = await provider.generate({
      system: SYSTEM_PROMPT,
      user,
      maxTokens: 200,
      temperature: 0.04,
      research: false,
      effort: "low",
      jsonSchema: THESIS_SCHEMA as unknown as Record<string, unknown>,
      passName: "prep/demo-thesis",
    });
  } catch (err) {
    console.warn("prep/demo-thesis skipped:", (err as Error).message);
    return null;
  }

  try {
    return shapeDemoThesis(extractJson<{ headline?: string; sub?: string }>(result.text), prep.about);
  } catch (err) {
    console.warn("prep/demo-thesis unparsable:", (err as Error).message);
    return null;
  }
}
