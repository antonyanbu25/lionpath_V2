/**
 * Pass 6 — Product gaps + what landed (spec §8, ADR-006).
 *
 * Negative signal → productGaps collection (draft rows).
 * Positive signal → whatWorks collection (case-study pipeline).
 *
 * Never invent a gap. Empty arrays when nothing surfaced.
 * arrTouched is joined from PostCall.arrSnapshot — never asked of the model.
 */

import { embedVerbatim } from "../embeddings";
import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";
import type { PostCallTranscriptCacheBundle } from "../providers/gemini-cache";
import type { ProductGapDraft } from "../domain-model/product-gap";
import type { WhatWorksDraft } from "../domain-model/what-works";
import {
  CROSS_CUTTING_TAGS,
  DEAL_IMPACTS,
  GAP_DISPOSITIONS,
  GAP_TYPES,
  PRODUCT_AREAS,
  PRODUCT_SUB_AREAS,
  PRODUCT_TAXONOMY_VERSION,
  normalizeCrossCuttingTags,
  normalizeProductArea,
  normalizeSubArea,
  type DealImpact,
  type GapDisposition,
  type GapType,
  type ProductArea,
} from "../domain-model/product-taxonomy";
import { parseTranscript, trimTranscript } from "../transcript";
import { transcriptCacheHandle } from "./transcript-cache-context";

export type Env = ProviderEnv;

export interface ArrSnapshotInput {
  arrEstimatePoint?: number | null;
}

export interface PostCallGapsInput {
  transcript: string;
  callId?: string | null;
  dealId?: string | null;
  accountId?: string | null;
  companyName?: string;
  meetingTitle?: string;
  callType?: string;
  /** Frozen ARR at analysis time — arrTouched is derived from this, never from the model. */
  arrSnapshot?: ArrSnapshotInput | null;
  additionalContext?: string;
  userId?: string;
  transcriptCaches?: PostCallTranscriptCacheBundle;
}

export interface PostCallGapsResult {
  taxonomyVersion: string;
  productGaps: ProductGapDraft[];
  whatWorks: WhatWorksDraft[];
}

/** Optional nested object — omit from required; Gemini 3 rejects nullable+required combo. */
const COMPETITOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "saidBetter"],
  properties: {
    name: { type: "string" },
    saidBetter: { type: "boolean" },
  },
};

const GAP_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["productArea", "subArea", "verbatim", "disposition", "dealImpact", "gapType"],
  properties: {
    productArea: { type: "string", enum: [...PRODUCT_AREAS] },
    subArea: { type: "string" },
    crossCuttingTags: {
      type: "array",
      items: { type: "string", enum: [...CROSS_CUTTING_TAGS] },
    },
    verbatim: { type: "string" },
    headline: { type: "string" },
    atS: { type: "number", nullable: true },
    disposition: { type: "string", enum: [...GAP_DISPOSITIONS] },
    dealImpact: { type: "string", enum: [...DEAL_IMPACTS] },
    gapType: { type: "string", enum: [...GAP_TYPES] },
    competitorNamed: COMPETITOR_SCHEMA,
  },
};

const WHAT_WORKS_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["productArea", "verbatim", "referenceCandidate"],
  properties: {
    productArea: { type: "string", enum: [...PRODUCT_AREAS] },
    verbatim: { type: "string" },
    headline: { type: "string" },
    atS: { type: "number", nullable: true },
    referenceCandidate: { type: "boolean" },
  },
};

/** Pass 6 Gemini response schema — exported for schema regression tests. */
export const GAPS_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["productGaps", "whatWorks"],
  properties: {
    // Do not set maxItems here — gemini-3.1-flash-lite rejects responseSchema with
    // maxItems on arrays (400 INVALID_ARGUMENT). Cap counts in normalize*Output instead.
    productGaps: { type: "array", items: GAP_ITEM_SCHEMA },
    whatWorks: { type: "array", items: WHAT_WORKS_ITEM_SCHEMA },
  },
};

function taxonomyPromptBlock(): string {
  const lines: string[] = ["Axis 1 — productArea (single-select, fixed list):"];
  for (const area of PRODUCT_AREAS) {
    if (area === "other") {
      lines.push("- other → subArea: other (only when nothing fits)");
      continue;
    }
    const subs = PRODUCT_SUB_AREAS[area].filter((s) => s !== "other").join(", ");
    lines.push(`- ${area} → subArea one of: ${subs} (or other within that area)`);
  }
  lines.push("", `Axis 2 — crossCuttingTags (multi-select, optional): ${CROSS_CUTTING_TAGS.join(", ")}`);
  return lines.join("\n");
}

function systemPrompt(): string {
  return `You extract product signal from a Solution Engineering customer call transcript.

Emit JSON only: { productGaps, whatWorks }.

PRODUCT GAPS — negative signal. Only when the customer explicitly asked for, needed, or rejected
a capability we could not show, deflect credibly, or the SE did not know we already have.

Each productGap:
- productArea + subArea: fixed taxonomy only (no free text). Use other/other when nothing fits.
- crossCuttingTags: zero or more orthogonal tags (data_residency, security_compliance, etc.)
- verbatim: customer's own words — short direct quote, always retained, prefer their phrasing
- headline: 2–5 word Title Case label for UI chips (e.g. "AI value unproven", "Easy to configure")
- atS: seconds from call start when said ([mm:ss] prefixes in transcript), or null
- disposition: hard_blocker | workaround_offered | roadmap_deflection | se_didnt_know
  se_didnt_know = customer wanted something we already ship but the SE did not know / mis-demoed.
  This routes to enablement, not product — use it when transcript evidence supports it.
- dealImpact: blocker | friction | nice_to_have
- gapType: real_gap (product missing/wrong packaging) | enablement_gap (product already does it)
  When disposition is se_didnt_know, gapType MUST be enablement_gap.
- competitorNamed: { name, saidBetter } when a competitor was named as doing it better; else null

WHAT WORKS — positive signal. First-class, not an afterthought.
Each whatWorks row:
- productArea: fixed taxonomy
- verbatim: customer praise or confirmed value in their words
- headline: 2–5 word Title Case label for win pills (e.g. "Complimentary onboarding")
- atS: seconds from call start when said, or null
- referenceCandidate: true when they volunteered reference/case-study potential or strong advocacy

${taxonomyPromptBlock()}

Rules (strict):
- Never invent gaps or wins. Empty arrays when nothing surfaced.
- Customer-stated gaps count — including when the customer needed a capability, the SE offered a
  workaround, and the customer accepted it (e.g. missing native Flutter / mobile SDK → webview).
  That is still a real_gap with disposition workaround_offered.
- If Additional SE context or call notes explicitly name a missing product capability discussed on
  the call (SDK, integration, channel, packaging), emit it — do not drop it because the quote is
  paraphrased in notes rather than a perfect transcript snippet.
- Prefer customer phrasing for every verbatim when available.
- Do not include ARR, deal size, or pricing totals — those are joined server-side.
- Do not emit embedding fields.`;
}

function userPrompt(
  input: PostCallGapsInput,
  parsed: ReturnType<typeof parseTranscript>,
  omitTranscript = false,
): string {
  const lines = [
    "Extract product gaps and what landed from this call.",
    "",
    `Word count: ${parsed.wordCount}`,
  ];
  if (input.companyName) lines.push(`Company: ${input.companyName}`);
  if (input.meetingTitle) lines.push(`Meeting: ${input.meetingTitle}`);
  if (input.callType) lines.push(`Call type: ${input.callType}`);
  if (input.additionalContext?.trim()) {
    lines.push("", "Additional SE context:", input.additionalContext.trim());
  }
  if (!omitTranscript) {
    lines.push("", "=== TRANSCRIPT ===", trimTranscript(parsed.text, 6000, "tail"), "=== END TRANSCRIPT ===");
  }
  return lines.join("\n");
}

function normalizeDisposition(raw: unknown): GapDisposition {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if ((GAP_DISPOSITIONS as readonly string[]).includes(v)) return v as GapDisposition;
  if (v.includes("didnt") || v.includes("did_not") || v.includes("didn't")) return "se_didnt_know";
  if (v.includes("blocker")) return "hard_blocker";
  if (v.includes("workaround")) return "workaround_offered";
  if (v.includes("roadmap")) return "roadmap_deflection";
  return "workaround_offered";
}

function normalizeDealImpact(raw: unknown): DealImpact {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if ((DEAL_IMPACTS as readonly string[]).includes(v)) return v as DealImpact;
  if (v.includes("block")) return "blocker";
  if (v.includes("nice")) return "nice_to_have";
  return "friction";
}

function normalizeGapType(raw: unknown, disposition: GapDisposition): GapType {
  if (disposition === "se_didnt_know") return "enablement_gap";
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (v === "enablement_gap" || v.includes("enablement")) return "enablement_gap";
  return "real_gap";
}

function normalizeCompetitorNamed(raw: unknown): ProductGapDraft["competitorNamed"] {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = String(r.name || "").trim();
  if (!name) return null;
  return { name: name.slice(0, 80), saidBetter: !!r.saidBetter };
}

function trimVerbatim(raw: unknown, maxWords = 60): string {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ");
}

function trimHeadline(raw: unknown, maxWords = 6): string {
  const text = String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return "";
  const words = text.split(/\s+/);
  return words.slice(0, maxWords).join(" ");
}

function normalizeAtS(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  return Math.round(raw);
}

function headlineFromVerbatim(verbatim: string, subArea: string): string {
  const fromSub = trimHeadline(subArea.replace(/_/g, " "), 5);
  if (fromSub && fromSub.toLowerCase() !== "other") return fromSub;
  const words = verbatim.replace(/["""]/g, "").split(/\s+/).slice(0, 5);
  return words.join(" ");
}

function resolveArrTouched(arrSnapshot: ArrSnapshotInput | null | undefined): number | null {
  const point = arrSnapshot?.arrEstimatePoint;
  if (point == null || Number.isNaN(Number(point))) return null;
  return Math.round(Number(point));
}

interface RawGapRow {
  productArea?: unknown;
  subArea?: unknown;
  crossCuttingTags?: unknown;
  verbatim?: unknown;
  headline?: unknown;
  atS?: unknown;
  disposition?: unknown;
  dealImpact?: unknown;
  gapType?: unknown;
  competitorNamed?: unknown;
}

interface RawWhatWorksRow {
  productArea?: unknown;
  verbatim?: unknown;
  headline?: unknown;
  atS?: unknown;
  referenceCandidate?: unknown;
}

/** Exported for unit tests (no LLM). */
export function normalizeProductGapsOutput(
  raw: unknown,
  arrSnapshot?: ArrSnapshotInput | null,
): ProductGapDraft[] {
  if (!Array.isArray(raw)) return [];
  const arrTouched = resolveArrTouched(arrSnapshot);
  const out: ProductGapDraft[] = [];

  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as RawGapRow;
    const verbatim = trimVerbatim(r.verbatim);
    if (!verbatim) continue;

    const productArea = normalizeProductArea(r.productArea);
    const subArea = normalizeSubArea(productArea, r.subArea);
    const disposition = normalizeDisposition(r.disposition);
    const gapType = normalizeGapType(r.gapType, disposition);

    out.push({
      productArea,
      subArea,
      crossCuttingTags: normalizeCrossCuttingTags(r.crossCuttingTags),
      verbatim,
      headline: trimHeadline(r.headline) || headlineFromVerbatim(verbatim, subArea),
      atS: normalizeAtS(r.atS),
      disposition,
      dealImpact: normalizeDealImpact(r.dealImpact),
      gapType,
      competitorNamed: normalizeCompetitorNamed(r.competitorNamed),
      arrTouched,
      embedding: [],
      taxonomyVersion: PRODUCT_TAXONOMY_VERSION,
      status: "draft",
    });
    if (out.length >= 12) break;
  }
  return out;
}

/** Exported for unit tests (no LLM). */
export function normalizeWhatWorksOutput(raw: unknown): WhatWorksDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: WhatWorksDraft[] = [];

  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as RawWhatWorksRow;
    const verbatim = trimVerbatim(r.verbatim);
    if (!verbatim) continue;

    out.push({
      productArea: normalizeProductArea(r.productArea),
      verbatim,
      headline: trimHeadline(r.headline) || headlineFromVerbatim(verbatim, normalizeProductArea(r.productArea)),
      atS: normalizeAtS(r.atS),
      referenceCandidate: !!r.referenceCandidate,
      taxonomyVersion: PRODUCT_TAXONOMY_VERSION,
    });
    if (out.length >= 8) break;
  }
  return out;
}

async function attachEmbeddings(env: Env, gaps: ProductGapDraft[]): Promise<ProductGapDraft[]> {
  if (!gaps.length) return gaps;
  return Promise.all(
    gaps.map(async (gap) => {
      const embedding = await embedVerbatim(env, gap.verbatim);
      return { ...gap, embedding };
    }),
  );
}

function isGeminiInvalidSchemaError(err: unknown): boolean {
  const msg = (err as Error)?.message || "";
  return msg.includes("Gemini API 400") && /INVALID_ARGUMENT|invalid argument/i.test(msg);
}

async function generateGapsJson(
  env: Env,
  provider: ReturnType<typeof getPostCallProvider>,
  input: PostCallGapsInput,
  parsed: ReturnType<typeof parseTranscript>,
  transcriptCache: ReturnType<typeof transcriptCacheHandle>,
  effort: string,
) {
  const base = {
    maxTokens: 4000,
    system: systemPrompt(),
    user: userPrompt(input, parsed, !!transcriptCache),
    effort,
    research: false as const,
    thinkingBudget: 0,
    passName: "gaps",
    userId: input.userId,
    callId: input.callId ?? undefined,
    cachedContent: transcriptCache,
  };

  try {
    return await provider.generate({
      ...base,
      jsonSchema: GAPS_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    });
  } catch (err) {
    if (!isGeminiInvalidSchemaError(err)) throw err;
    console.warn("[gaps] responseSchema rejected; retrying jsonMimeOnly:", (err as Error).message);
    return provider.generate({ ...base, jsonMimeOnly: true });
  }
}

export async function runPostCallGaps(env: Env, input: PostCallGapsInput): Promise<PostCallGapsResult> {
  const transcript = input.transcript?.trim();
  if (!transcript) {
    throw Object.assign(new Error("transcript is required."), { status: 400 });
  }

  const parsed = parseTranscript(transcript);
  const provider = getPostCallProvider(env);
  const effort = env.POSTCALL_EFFORT || env.EFFORT || "low";
  const transcriptCache = transcriptCacheHandle(input.transcriptCaches, "tail6000");

  const result = await generateGapsJson(env, provider, input, parsed, transcriptCache, effort);

  const parsedJson = extractJson<{ productGaps?: unknown; whatWorks?: unknown }>(result.text);
  const productGaps = await attachEmbeddings(
    env,
    normalizeProductGapsOutput(parsedJson.productGaps, input.arrSnapshot),
  );
  const whatWorks = normalizeWhatWorksOutput(parsedJson.whatWorks);

  return {
    taxonomyVersion: PRODUCT_TAXONOMY_VERSION,
    productGaps,
    whatWorks,
  };
}

export type { ProductGapDraft, WhatWorksDraft, ProductArea, GapDisposition, GapType, DealImpact };
