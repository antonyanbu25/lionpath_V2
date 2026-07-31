/**
 * "How to run this demo" — DISC-driven demo guidance.
 *
 * Deliberately NOT part of PREP_SCHEMA, for the same reason `assets` isn't
 * (see prep-assets.ts): keeping it out means the synthesis model can neither invent it
 * nor inflate its already 12k-token schema, which has a JSON-repair fallback we don't
 * want to make more likely to fire.
 *
 * Runs as its own small call on MODEL (not SYNTHESIZE_MODEL), fired in parallel with
 * synthesizePrep — it needs the prospects' DISC plus pains and incumbent, not the
 * finished demo script, so it is off the critical path.
 *
 * DISC here is INFERRED, never assessed: enrich only ever emits confidence low|medium
 * and hard-forces inferred:true. The prompt therefore requires guidance to be phrased as
 * a hypothesis at low confidence, and every ice breaker to cite supplied profile data.
 */

import { extractJson } from "../json";
import { getProvider } from "../providers";
import type { Prep } from "../schema";
import type { ConfirmedProspectProfile } from "./merge-enrichment";
import type { Env } from "./types";

export interface DemoGuidanceObjection {
  objection: string;
  counter: string;
}

export interface DemoGuidanceForProspect {
  email: string;
  name: string;
  /** Display form, e.g. "C / S". Empty when primary is unknown. */
  disc: string;
  confidence: "low" | "medium" | "high";
  /** Free string from enrich — never treat as a closed set. */
  decisionRole: string;
  openWith: string;
  iceBreakers: string[];
  pacing: string;
  objections: DemoGuidanceObjection[];
  avoid: string[];
  nextStep: string;
  /** Must match one of prep.assets[].label, or be absent. */
  leadAsset?: string;
  /** Verbatim discHint.evidence, so the guidance is auditable. */
  evidence: string[];
}

export interface DemoUseCase {
  name: string;
  /**
   * 2-3 lines about the account's own business: what creates this work, when it spikes,
   * how it is handled today. Explicitly NOT a demo click path and NOT a product pitch —
   * the first build of this shipped click paths ("Open the inbox, click the ticket"),
   * which told an SE nothing about the customer.
   */
  scenario: string[];
}

export interface DemoGuidance {
  perProspect: DemoGuidanceForProspect[];
  /** Present only when 2+ prospects have differing known DISC types. */
  room?: { read: string; sequence: string };
  /**
   * Industry-specific common use cases. Deliberately NOT PREP_SCHEMA.industryUseCases —
   * that field was removed for poor output quality and its normalizer is hard-forced to
   * [], so reviving it would invite the old behaviour back. These live here because this
   * call already has industry, pains, incumbent and icpFit in scope, runs off the
   * critical path, and already has the shapeGuidance reconciliation pattern to enforce
   * quality deterministically rather than hoping the prompt holds.
   *
   * Empty when nothing cleared the grounding bar — no use cases beats generic ones.
   */
  useCases?: DemoUseCase[];
  generatedAt: number;
}

const GUIDANCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  // useCases is required: as an optional field the model simply omitted it, so the
  // section never rendered. Grounding is still enforced in shapeUseCases — requiring
  // three makes the model produce candidates, not makes us accept them.
  required: ["perProspect", "useCases"],
  properties: {
    perProspect: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["email", "openWith", "iceBreakers", "pacing", "objections", "avoid", "nextStep"],
        properties: {
          email: { type: "string" },
          openWith: { type: "string", description: "How to open with this person. Max 20 words." },
          iceBreakers: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            items: {
              type: "string",
              description:
                "Opener grounded in a supplied profile detail (employer, education, skill, tenure). Max 22 words.",
            },
          },
          pacing: {
            type: "string",
            description: "How to pace and structure the demo for this person. Max 24 words.",
          },
          objections: {
            type: "array",
            minItems: 2,
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["objection", "counter"],
              properties: {
                objection: { type: "string", description: "As they would say it. Max 14 words." },
                counter: { type: "string", description: "How to answer it. Max 20 words." },
              },
            },
          },
          avoid: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            items: { type: "string", description: "Demo anti-pattern for this person. Max 14 words." },
          },
          nextStep: { type: "string", description: "How to land the close. Max 18 words." },
          leadAsset: {
            type: "string",
            description: "Copy EXACTLY one of the supplied asset labels, or omit entirely.",
          },
        },
      },
    },
    room: {
      type: "object",
      additionalProperties: false,
      required: ["read", "sequence"],
      properties: {
        read: { type: "string", description: "The mixed-room tension in one line. Max 24 words." },
        sequence: { type: "string", description: "Running order that serves both. Max 24 words." },
      },
    },
    useCases: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "scenario"],
        properties: {
          name: {
            type: "string",
            description:
              "Support scenario named in THIS account's own terms — their industry, product, channel or market. Max 10 words.",
          },
          scenario: {
            type: "array",
            minItems: 2,
            maxItems: 3,
            items: {
              type: "string",
              description:
                "One line about the customer's business: who raises this, what triggers it, when it spikes, or how they cope today. Max 18 words. Never a UI instruction and never a product feature.",
            },
          },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You brief a Solution Engineer on how to run a product demo for specific people, using an INFERRED DISC read of each attendee.

DISC meanings: D = direct, results-first, impatient with detail. I = social, enthusiastic, story-driven. S = steady, cooperative, wary of disruption. C = analytical, precise, wants proof and control.

HARD RULES — breaking any of these makes the output useless:
- Every iceBreakers entry MUST reference a concrete detail from that prospect's supplied profile (a prior employer, school, skill, certification, tenure, or competitor tool). Never invent biography. If the profile has no usable detail, give an opener grounded in their ROLE or the company's stated pain instead.
- Every objection MUST be traceable to a supplied pain, the incumbent situation, or an ICP gap. Do not invent commercial objections (pricing, legal) unless the input mentions them.
- leadAsset MUST be copied character-for-character from the supplied asset labels, or omitted. Never invent an asset.
- Combine DISC with decisionRole: an economic buyer needs a different close from an influencer, even at the same DISC type.
- When a prospect's DISC confidence is "low", phrase openWith / pacing / nextStep as a hypothesis to TEST ("if she reads as analytical, try…"), not as an instruction.
- When a prospect's DISC is unknown, do NOT guess a type. Base that person's guidance on role and pains only, and say so plainly.
- Emit "room" ONLY when two or more prospects have different known DISC types. Otherwise omit it entirely.
- Write for an SE to skim 60 seconds before a call. Plain sentences, no headers, no markdown, no filler.

USE CASES — industry-specific support scenarios, NOT demo instructions:
- Emit exactly 3. Each is a support scenario THIS company faces because of the industry
  it is in, the product it sells, the channels it runs, or the markets it covers.
- Each MUST name this account's actual industry, or a supplied pain, signal, market or
  incumbent tool. A use case that would read identically for any company is worthless
  and will be discarded.
- scenario lines describe the CUSTOMER'S BUSINESS: who raises the request, what triggers
  it, when volume spikes, how they cope today. Write them as if explaining the company's
  operation to a colleague who has never heard of Freshworks.
- Do NOT write demo steps. "Open the unified inbox", "Click the Jira sidebar", "Navigate
  to the reporting tab" are all wrong — that is a click path, not a use case.
- Do NOT name Freshworks products or features. No Freddy, no unified inbox, no routing
  rules. The scenario is theirs; the product answer is elsewhere in the brief.
- Do NOT write benefits or outcomes ("improves CSAT", "reduces handle time").
- Anchor the scenario in the ICP framework's use-case families where one fits: shared
  inbox replacement, first helpdesk adoption, ticketing + chat + automation, early
  omnichannel setup, omnichannel upgrade, AI-powered support automation, consolidation of
  multiple tools — but describe it in the customer's own operational terms.

GOOD (retail promotions vendor, 5 EU markets):
  name: "Voucher redemption disputes at campaign close"
  scenario: ["Retail partners query mismatched redemption totals when a promotion ends.",
             "Each dispute spans finance and support and arrives in five languages.",
             "Handled over shared email today, with no audit trail per partner."]
BAD (this is a click path, not a use case):
  name: "Consolidation of multiple tools"
  scenario: ["Open the unified inbox dashboard", "Click channel settings"]

OUTPUT: single JSON object matching the schema. No markdown.`;

function discDisplay(disc: ConfirmedProspectProfile["disc"] | undefined): string {
  const primary = disc?.primary;
  if (!primary || primary === "unknown") return "";
  const secondary = disc?.secondary && disc.secondary !== "unknown" ? ` / ${disc.secondary}` : "";
  return `${primary}${secondary}`;
}

/** Distinct known DISC primaries across the room — the mixed-room trigger. */
function knownPrimaries(profiles: ConfirmedProspectProfile[]): Set<string> {
  const out = new Set<string>();
  for (const p of profiles) {
    const primary = p.disc?.primary;
    if (primary && primary !== "unknown") out.add(primary);
  }
  return out;
}

function buildUserPrompt(
  input: {
    companyName: string;
    incumbent?: Prep["incumbent"];
    likelyPains?: string[];
    icpFit?: Prep["icpFit"];
    assetLabels: string[];
    industry?: string;
    signals?: string[];
  },
  profiles: ConfirmedProspectProfile[],
): string {
  const people = profiles.map((p, i) => {
    const prof = p.profile || ({} as ConfirmedProspectProfile["profile"]);
    const disc = p.disc;
    const lines = [
      `Prospect ${i + 1}`,
      `  email: ${p.email}`,
      `  name: ${prof.name || "unknown"}`,
      `  role: ${prof.role || "unknown"}`,
      `  DISC: ${discDisplay(disc) || "unknown"} (confidence: ${disc?.confidence || "low"})`,
      `  decisionRole: ${p.influence?.decisionRole || "unknown"} (influence: ${p.influence?.level || "unknown"})`,
    ];
    // Only the fields an ice breaker is allowed to draw on.
    if (prof.totalExperience && prof.totalExperience !== "unknown") lines.push(`  tenure: ${prof.totalExperience}`);
    if (prof.priorEmployers?.length) lines.push(`  priorEmployers: ${prof.priorEmployers.join(", ")}`);
    if (prof.education?.length) lines.push(`  education: ${prof.education.join("; ")}`);
    if (prof.skills?.length) lines.push(`  skills: ${prof.skills.slice(0, 8).join(", ")}`);
    if (prof.competitorTouchpoints?.length)
      lines.push(`  competitorTouchpoints: ${prof.competitorTouchpoints.join(", ")}`);
    if (disc?.evidence?.length) lines.push(`  DISC evidence: ${disc.evidence.join(" | ")}`);
    return lines.join("\n");
  });

  const parts = [
    `Company: ${input.companyName}`,
    input.industry && input.industry !== "unknown" ? `Industry: ${input.industry}` : "",
    input.incumbent?.incumbent_name && input.incumbent.incumbent_name !== "unknown"
      ? `Incumbent: ${input.incumbent.incumbent_name} (${input.incumbent.displacement})`
      : "",
    input.likelyPains?.length ? `Likely pains:\n${input.likelyPains.map((p) => `  - ${p}`).join("\n")}` : "",
    input.signals?.length ? `Observed signals:\n${input.signals.map((s) => `  - ${s}`).join("\n")}` : "",
    input.icpFit?.gaps?.length ? `ICP gaps to probe:\n${input.icpFit.gaps.map((g) => `  - ${g}`).join("\n")}` : "",
    input.assetLabels.length
      ? `Available assets (leadAsset must be copied from this list verbatim, or omitted):\n${input.assetLabels.map((a) => `  - ${a}`).join("\n")}`
      : "No assets available — omit leadAsset.",
    "",
    "Attendees:",
    people.join("\n\n"),
  ];
  return parts.filter(Boolean).join("\n");
}

/**
 * @returns guidance, or null when there is nothing to base it on / the call failed.
 *          Never throws — a brief must render without guidance.
 */
export async function generateDemoGuidance(
  env: Env,
  input: {
    companyName: string;
    incumbent?: Prep["incumbent"];
    likelyPains?: string[];
    icpFit?: Prep["icpFit"];
    assetLabels?: string[];
    /** Drives use-case grounding — without it nothing clears the specificity bar. */
    industry?: string;
    signals?: string[];
  },
  profiles: ConfirmedProspectProfile[],
): Promise<DemoGuidance | null> {
  const usable = (profiles || []).filter((p) => p?.email && p.profile);
  // Enrichment only runs when a PDF / notes / Kaia link exists, so this is a normal
  // path rather than an edge case.
  if (!usable.length) return null;

  const assetLabels = input.assetLabels || [];
  const anchors = groundingAnchors({
    industry: input.industry,
    likelyPains: input.likelyPains,
    signals: input.signals,
    incumbentName: input.incumbent?.incumbent_name,
    companyName: input.companyName,
  });
  const provider = getProvider(env);

  let result;
  try {
    result = await provider.generate({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({ ...input, assetLabels }, usable),
      // Raised from 2000: three use cases with click paths are ~400 extra output tokens,
      // and a truncated response loses the whole guidance object, not just the extra.
      maxTokens: 2800,
      temperature: 0.2,
      research: false,
      effort: "low",
      jsonSchema: GUIDANCE_SCHEMA as unknown as Record<string, unknown>,
      step: "prep/demo-guidance",
    });
  } catch (err) {
    console.warn("prep/demo-guidance skipped:", (err as Error).message);
    return null;
  }

  try {
    return shapeGuidance(extractJson<RawGuidance>(result.text), usable, assetLabels, anchors);
  } catch (err) {
    console.warn("prep/demo-guidance unparsable:", (err as Error).message);
    return null;
  }
}

interface RawGuidance {
  perProspect?: Array<Partial<DemoGuidanceForProspect>>;
  room?: { read?: string; sequence?: string };
  useCases?: Array<{ name?: string; steps?: unknown }>;
}

/** Words too common to prove a use case is about this account. */
const ANCHOR_STOPWORDS = new Set([
  "unknown",
  "support",
  "customer",
  "service",
  "team",
  "tool",
  "tools",
  "software",
  "platform",
  "system",
  "systems",
  "company",
  "business",
  "with",
  "from",
  "their",
  "they",
  "have",
  "high",
  "more",
  "into",
  "over",
  "this",
  "that",
  "using",
  "used",
  "across",
  "channel",
  "channels",
  "agent",
  "agents",
  "ticket",
  "tickets",
]);

/**
 * Tokens that prove a use case is about THIS account: its industry, its stated pains and
 * signals, its incumbent. Short and generic words are excluded so "customer support" in
 * a boilerplate sentence cannot pass as grounding.
 */
export function groundingAnchors(input: {
  industry?: string;
  likelyPains?: string[];
  signals?: string[];
  incumbentName?: string;
  companyName?: string;
}): string[] {
  const raw = [
    input.industry || "",
    input.incumbentName || "",
    input.companyName || "",
    ...(input.likelyPains || []),
    ...(input.signals || []),
  ].join(" ");

  const out = new Set<string>();
  for (const word of raw.toLowerCase().split(/[^a-z0-9+]+/)) {
    if (word.length < 4) continue;
    if (ANCHOR_STOPWORDS.has(word)) continue;
    out.add(word);
  }
  return [...out];
}

/**
 * A UI instruction rather than a description of the customer's business. This is the
 * exact failure mode of the first build: every use case came back as "Open the unified
 * inbox dashboard / Click the Jira integration sidebar", which tells an SE nothing about
 * the account.
 */
const CLICK_PATH_OPENERS =
  /^(open|click|select|navigate|show|display|go to|switch to|drag|drop|hover|scroll|type|enter|press|expand|collapse|configure|set up|add a|create a|filter|sort|toggle)\b/i;

/**
 * Benefit prose and product pitch. A use-case scenario is about their operation, not
 * about what our platform does or what they will feel afterwards.
 */
const BENEFIT_OPENERS =
  /^(improve|increase|decrease|reduce|boost|streamline|empower|leverage|drive|deliver|unlock|enhance|optimi[sz]e|transform|accelerate|maximi[sz]e|minimi[sz]e|ensure|enable)\b/i;
const MARKETING_FILLER = /\b(roi|seamless|world[- ]class|best[- ]in[- ]class|game[- ]chang|synerg|holistic|cutting[- ]edge|next[- ]generation)/i;
/** Naming our own product means the line has stopped describing the customer. */
const PRODUCT_MENTION =
  /\b(freddy|freshdesk|freshworks|freshservice|freshchat|freshcaller|our platform|the platform)\b/i;

/**
 * True when the line describes the account's own operation.
 *
 * A heuristic, not a parser: it catches lines that open as instructions, benefits or
 * product pitch, and will miss a click path phrased as a statement. The prompt carries
 * the rest; this is the backstop that made the last version's failure impossible to ship
 * silently.
 */
export function isScenarioLine(line: string): boolean {
  const s = String(line || "").trim();
  if (s.split(/\s+/).filter(Boolean).length < 4) return false;
  if (CLICK_PATH_OPENERS.test(s)) return false;
  if (BENEFIT_OPENERS.test(s)) return false;
  if (MARKETING_FILLER.test(s)) return false;
  if (PRODUCT_MENTION.test(s)) return false;
  return true;
}

/** True when name+scenario mention at least one anchor token from this account. */
export function isGroundedUseCase(uc: DemoUseCase, anchors: string[]): boolean {
  if (!anchors.length) return false;
  const haystack = `${uc.name} ${uc.scenario.join(" ")}`.toLowerCase();
  return anchors.some((a) => haystack.includes(a));
}

/**
 * Enforce the quality bar in code, not just in the prompt. Use cases were pulled once
 * for being generic; a prompt rule alone is what allowed that.
 *
 * Returns only the cases that are BOTH grounded in this account and shaped like a click
 * path. Returning fewer than 3 — or none — is the intended outcome when the model
 * produces filler.
 */
export function shapeUseCases(
  raw: Array<{ name?: string; scenario?: unknown }> | undefined,
  anchors: string[],
): DemoUseCase[] {
  if (!Array.isArray(raw)) return [];
  const out: DemoUseCase[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (out.length >= 3) break;
    const name = String(item?.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    const scenario = (Array.isArray(item?.scenario) ? item.scenario : [])
      .map((s) => String(s || "").trim())
      .filter(isScenarioLine)
      .slice(0, 3);
    // One surviving line is a headline, not a scenario. Two is the floor.
    if (scenario.length < 2) continue;

    const candidate: DemoUseCase = { name, scenario };
    if (!isGroundedUseCase(candidate, anchors)) continue;

    seen.add(key);
    out.push(candidate);
  }

  return out;
}

/**
 * Deterministically reconcile the model output against what we actually know.
 * The model supplies prose; email/name/DISC/decisionRole/evidence all come from the
 * enrich data so they cannot drift, and leadAsset is validated against the real catalog.
 */
export function shapeGuidance(
  raw: RawGuidance,
  profiles: ConfirmedProspectProfile[],
  assetLabels: string[],
  useCaseAnchors: string[] = [],
): DemoGuidance | null {
  const byEmail = new Map(
    (raw.perProspect || []).map((p) => [String(p.email || "").toLowerCase(), p]),
  );
  const validAssets = new Set(assetLabels);

  const perProspect: DemoGuidanceForProspect[] = [];
  for (const profile of profiles) {
    const got = byEmail.get(profile.email.toLowerCase());
    if (!got) continue;
    const leadAsset = String(got.leadAsset || "").trim();
    perProspect.push({
      email: profile.email,
      name: profile.profile?.name || profile.email.split("@")[0],
      disc: discDisplay(profile.disc),
      confidence: profile.disc?.confidence || "low",
      decisionRole: profile.influence?.decisionRole || "",
      openWith: String(got.openWith || "").trim(),
      iceBreakers: (got.iceBreakers || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 2),
      pacing: String(got.pacing || "").trim(),
      objections: (got.objections || [])
        .filter((o) => o?.objection && o?.counter)
        .map((o) => ({ objection: String(o.objection).trim(), counter: String(o.counter).trim() }))
        .slice(0, 3),
      avoid: (got.avoid || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 2),
      nextStep: String(got.nextStep || "").trim(),
      // Drop an invented asset rather than rendering a dead recommendation.
      ...(validAssets.has(leadAsset) ? { leadAsset } : {}),
      evidence: (profile.disc?.evidence || []).slice(0, 4),
    });
  }

  if (!perProspect.length) return null;

  // The room read only means anything with a genuine mix of known types.
  const mixed = knownPrimaries(profiles).size >= 2;
  const room =
    mixed && raw.room?.read && raw.room?.sequence
      ? { read: String(raw.room.read).trim(), sequence: String(raw.room.sequence).trim() }
      : undefined;

  const useCases = shapeUseCases(raw.useCases, useCaseAnchors);

  return {
    perProspect,
    ...(room ? { room } : {}),
    ...(useCases.length ? { useCases } : {}),
    generatedAt: Date.now(),
  };
}

/**
 * Guidance is generated in parallel with synthesis, so it is offered the whole asset
 * catalog while the real per-account subset is still being computed. Once the prep
 * exists, drop any recommendation that didn't make the cut — better no recommendation
 * than one pointing at an asset the SE cannot see.
 */
export function pruneLeadAssets(guidance: DemoGuidance, actualLabels: string[]): DemoGuidance {
  const valid = new Set(actualLabels);
  return {
    ...guidance,
    perProspect: guidance.perProspect.map((p) =>
      p.leadAsset && !valid.has(p.leadAsset) ? { ...p, leadAsset: undefined } : p,
    ),
  };
}
