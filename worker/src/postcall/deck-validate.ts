/**
 * Deck PDF relevance gate (v2.3).
 *
 * Two-step validation:
 *   1. A cheap LLM pass (`runDeckValidation`) checks whether the uploaded PDF looks like a
 *      real slide deck that is relevant to this particular call. Skipped entirely when no
 *      `deckContent` is present (the happy-path adds zero cost).
 *   2. `resolveDeckVerdict` combines the LLM result with client-side shape hints and Pass 2
 *      video evidence to produce the authoritative three-state verdict used by scorecard.ts.
 *
 * Anti-gaming guarantee: `deck_rejected` and `deck_absent` are scoring-equivalent — a junk
 * upload must never score better than uploading nothing (enforced in scorecard.ts `userPrompt`
 * by omitting the deck block entirely when the verdict is not `deck_valid`).
 */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";
import type { VideoFactsDraft } from "../domain-model/video-facts";
import type { PostCallDeckContent } from "./types";

export type Env = ProviderEnv;

// ---------------------------------------------------------------------------
// LLM schema + types
// ---------------------------------------------------------------------------

const DECK_VALIDATE_SCHEMA = {
  type: "object",
  required: ["isSlideDeck", "relevanceToCall", "reason", "confidence"],
  properties: {
    isSlideDeck: { type: "boolean" },
    relevanceToCall: { type: "string", enum: ["high", "partial", "none"] },
    reason: { type: "string", maxLength: 200 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

export interface DeckValidationResult {
  isSlideDeck: boolean;
  relevanceToCall: "high" | "partial" | "none";
  reason: string;
  confidence: number;
}

export type DeckVerdict = "deck_valid" | "deck_rejected" | "deck_absent";

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function systemPrompt(): string {
  return `You assess whether an uploaded PDF is a genuine slide deck relevant to a specific sales call.

Rules:
- isSlideDeck=true when the content is structured as presentation slides (short text blocks, section headers, bullet points, sparse prose). False for reports, contracts, LinkedIn profiles, invoices, research papers or any dense-text document.
- relevanceToCall: "high" = deck clearly matches the company and call topics; "partial" = possibly the right account but inconclusive or partial topic overlap; "none" = no discernible connection to the call (wrong company, generic filler, or unrelated subject matter).
- reason: max 20 words, plain factual description of the signal you used.
- confidence 0..1 — low when the deck text is sparse or the call transcript sample is very short.

When isSlideDeck is false, set relevanceToCall to "none".

Respond with JSON only matching the provided schema.`;
}

function userPrompt(
  deckContent: PostCallDeckContent,
  callContext: { companyName?: string; meetingTitle?: string; transcriptSample: string },
): string {
  // Take up to the first 12 slides for the validation pass.
  const slidesToCheck = deckContent.slides.slice(0, 12);
  const deckText = slidesToCheck
    .map((s) => `--- Slide ${s.page} ---\n${s.text || "(no extractable text)"}`)
    .join("\n");

  const lines = [
    "Assess this uploaded PDF against the call context.",
    "",
    `Company: ${callContext.companyName || "(unknown)"}`,
    `Meeting title: ${callContext.meetingTitle || "(unknown)"}`,
    `PDF file: ${deckContent.fileName} (${deckContent.pageCount} pages)`,
  ];

  if (deckContent.shape) {
    const { landscapePct, medianWordsPerPage } = deckContent.shape;
    lines.push(
      `Page geometry: ${Math.round(landscapePct * 100)}% landscape, median ${Math.round(medianWordsPerPage)} words/page`,
    );
  }
  if (deckContent.deckShapeVerdict) {
    lines.push(`Client-side shape verdict: ${deckContent.deckShapeVerdict}`);
  }

  lines.push(
    "",
    "=== PDF CONTENT (first 12 slides) ===",
    deckText,
    "=== END PDF CONTENT ===",
    "",
    "=== CALL TRANSCRIPT SAMPLE ===",
    callContext.transcriptSample || "(none)",
    "=== END TRANSCRIPT SAMPLE ===",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Normaliser
// ---------------------------------------------------------------------------

function normalizeDeckValidation(raw: {
  isSlideDeck?: unknown;
  relevanceToCall?: unknown;
  reason?: unknown;
  confidence?: unknown;
}): DeckValidationResult {
  const isSlideDeck = raw.isSlideDeck === true;
  const relevanceToCall =
    raw.relevanceToCall === "high" || raw.relevanceToCall === "partial"
      ? (raw.relevanceToCall as "high" | "partial")
      : "none";
  const reason = typeof raw.reason === "string" ? raw.reason.slice(0, 200) : "no reason provided";
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  return { isSlideDeck, relevanceToCall: isSlideDeck ? relevanceToCall : "none", reason, confidence };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the LLM relevance check on the uploaded deck.
 * Returns `null` when `deckContent` is absent — callers must guard before calling.
 * Temperature 0, JSON schema, same provider pattern as `classify.ts`.
 */
export async function runDeckValidation(
  env: Env,
  deckContent: PostCallDeckContent,
  callContext: { companyName?: string; meetingTitle?: string; transcriptSample: string },
  ids?: { userId?: string; callId?: string },
): Promise<DeckValidationResult> {
  const provider = getPostCallProvider(env);
  const result = await provider.generate({
    maxTokens: 400,
    system: systemPrompt(),
    user: userPrompt(deckContent, callContext),
    effort: env.POSTCALL_EFFORT || env.EFFORT || "low",
    research: false,
    thinkingBudget: 0,
    temperature: 0,
    jsonSchema: DECK_VALIDATE_SCHEMA as unknown as Record<string, unknown>,
    passName: "deck-validate",
    userId: ids?.userId,
    callId: ids?.callId,
  });

  return normalizeDeckValidation(extractJson(result.text));
}

/**
 * Resolve the authoritative three-state deck verdict.
 *
 * `deck_valid`    — deck accepted for scoring.
 * `deck_rejected` — a PDF was uploaded but it failed the shape/relevance gate.
 * `deck_absent`   — nothing uploaded and no video slide evidence.
 *
 * Video evidence (Pass 2 slide segments or shareOnPct ≥ 25%) is authoritative and
 * overrides a `deck_rejected` verdict: the deck being scored via screen-share is
 * independent of the quality of any uploaded PDF.
 */
export function resolveDeckVerdict(opts: {
  deckContent: PostCallDeckContent | null | undefined;
  validation: DeckValidationResult | null | undefined;
  videoFacts: VideoFactsDraft | null | undefined;
}): { verdict: DeckVerdict; rejectionReason?: string } {
  const { deckContent, validation, videoFacts } = opts;

  // Pass 2 video evidence is always authoritative — screen-share proves deck presence
  // regardless of the uploaded PDF quality.
  if (videoFacts && videoFacts.status === "ready") {
    const slideSegs = (videoFacts.segments || []).filter((s) => s.segmentType === "slides");
    const sharePct = videoFacts.shareOnPct;
    if (slideSegs.length > 0 || (sharePct != null && sharePct >= 25)) {
      return { verdict: "deck_valid" };
    }
  }

  // No PDF uploaded — nothing to validate.
  if (!deckContent?.slides?.some((s) => s.text?.trim())) {
    return { verdict: "deck_absent" };
  }

  // PDF uploaded — apply the LLM validation result.
  if (!validation) {
    // Validation skipped or errored — treat uploaded PDF as valid (graceful degradation).
    return { verdict: "deck_valid" };
  }

  if (validation.isSlideDeck && validation.relevanceToCall !== "none") {
    return { verdict: "deck_valid" };
  }

  const reason = validation.reason || "Not a relevant slide deck for this call.";
  return { verdict: "deck_rejected", rejectionReason: reason };
}
