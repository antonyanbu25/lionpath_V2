/**
 * Pass 3 — QIP scorecard scoring against the confirmed call type's profile.
 * Writes to scorecard collections (via web persist), not the analysis blob.
 */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";
import {
  anchorsJsonForTheme,
  applyUnanchoredConfidenceCap,
  formatAnchorBlockForPrompt,
  isThemeAnchored,
  UNANCHORED_CONFIDENCE_CAP,
} from "../rubric-anchors";
import {
  analysisConfidenceForVideo,
  RUBRIC_PROFILES,
  RUBRIC_VERSION,
  rubricIdFor,
  VIDEO_DEPENDENT_THEME_KEYS,
  VIDEO_THEME_NA_REASON,
  type CallType,
  type RubricProfileSeed,
} from "../rubric-profiles";
import { typeComposite } from "../quality-score";
import { THEME_LIBRARY, themeLabel } from "../theme-library";
import { formatTimestampedTranscript } from "../transcript";
import { trimWords } from "../word-limits";
import type { ScorecardEvidence } from "../domain-model/scorecard";
import type { VideoFactsDraft } from "../domain-model/video-facts";

export type Env = ProviderEnv;

export { UNANCHORED_CONFIDENCE_CAP };

export const SLIDE_DECK_NA_REASON = "No deck shared on this call.";
export const NO_TIMESTAMP_EVIDENCE_REASON =
  "Applicable score lacks timestamped transcript evidence.";
export const MODEL_OMITTED_THEME_REASON =
  "Model omitted this theme from the scorecard response — not scored.";
/** Confidence cap for lines the model failed to return (§6 — incomplete response). */
export const MODEL_OMITTED_CONFIDENCE = 0.25;

export interface ScorecardLineDraft {
  themeKey: string;
  score: number;
  maxScore: number;
  applicable: boolean;
  notApplicableReason?: string | null;
  confidence: number | null;
  evidence: ScorecardEvidence[];
  coachingNote: string | null;
  weight: number;
}

export interface ScorecardDraft {
  rubricId: string;
  callType: CallType;
  rubricVersion: string;
  provisional: boolean;
  rawScore: number;
  denominator: number;
  confidence: number;
  lines: ScorecardLineDraft[];
}

export interface PostCallScorecardInput {
  transcript: string;
  callType: CallType;
  videoAvailable: boolean;
  /** Optional deck URL — absence forces slide_deck not applicable. */
  deckLink?: string | null;
  /** Pre-call brief text for research_agenda diff (optional). */
  briefContext?: string | null;
  companyName?: string;
  meetingTitle?: string;
  /** Pass 2 draft — when status=ready, video themes may be scored with facts. */
  videoFacts?: VideoFactsDraft | null;
}

export interface PostCallScorecardResult {
  scorecard: ScorecardDraft;
  analysisConfidence: number;
  provisional: boolean;
}

function profileFor(callType: CallType): RubricProfileSeed {
  const profile = RUBRIC_PROFILES.find((p) => p.callType === callType);
  if (!profile) {
    throw Object.assign(new Error(`Unknown call type: ${callType}`), { status: 400 });
  }
  return profile;
}

function isVideoTheme(themeKey: string): boolean {
  return (VIDEO_DEPENDENT_THEME_KEYS as readonly string[]).includes(themeKey);
}

function scorecardJsonSchema(themeKeys: string[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["lines", "analysisConfidence"],
    properties: {
      analysisConfidence: { type: "number", minimum: 0, maximum: 1 },
      // Do not set minItems/maxItems on lines — Gemini 400s when array bounds combine
      // with this nested per-line schema (~16 themes). Line count is enforced in
      // normalizeScorecardLines() from the profile, not the response schema.
      lines: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["themeKey", "score", "applicable", "confidence", "evidence", "coachingNote"],
          properties: {
            themeKey: { type: "string", enum: themeKeys },
            score: { type: "number", minimum: 0, maximum: 100 },
            applicable: { type: "boolean" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            notApplicableReason: { type: "string", nullable: true },
            evidence: {
              type: "array",
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["quote"],
                properties: {
                  atS: { type: "number", nullable: true },
                  quote: { type: "string" },
                  source: {
                    type: "string",
                    enum: ["transcript", "video", "brief", "artifact"],
                    nullable: true,
                  },
                },
              },
            },
            coachingNote: { type: "string" },
          },
        },
      },
    },
  };
}

/** Build system prompt for ONE confirmed profile — never send all eight. */
export function buildScorecardSystemPrompt(profile: RubricProfileSeed): string {
  const themeBlocks = profile.themes.map((t) => {
    const def = THEME_LIBRARY[t.themeKey];
    const anchors = anchorsJsonForTheme(t.themeKey, profile.callType);
    const anchorBlock = formatAnchorBlockForPrompt(anchors);

    return [
      `### ${t.themeKey} (weight ${t.weight}) — ${themeLabel(t.themeKey)}`,
      def?.definition || "",
      `Source preference: ${def?.source || "transcript"}`,
      anchorBlock,
    ].join("\n");
  });

  return `You are an SE quality scorer. Score ONLY the themes listed for this confirmed call type.
Do not choose a call type. Do not score themes outside this profile.

Call type: ${profile.callType}
Rubric version: ${profile.version}
Profile total: ${profile.totalPoints}
Shadow/provisional profile: ${profile.provisional ? "yes — scores store but display provisional" : "no — live"}

RULES (mandatory):
1. Each line: score 0..100, applicable, confidence 0..1, evidence[], coachingNote.
2. Evidence must be VERBATIM from the transcript WITH a timestamp (atS in seconds). A score without a timestamped quote is one the SE wins the argument about.
3. coachingNote: max 20 words, one specific action the SE should take next time.
4. APPLICABILITY IS EVIDENCE-DRIVEN, NOT LABEL-DRIVEN. The profile lists themes in scope; evidence decides which count.
   - No deck shared → slide_deck applicable:false regardless of call type.
   - No video → camera_on, cde_build, call_flow, customer_engagement applicable:false. NEVER infer camera_on from transcript.
5. Non-applicable lines: score 0, set notApplicableReason, empty evidence ok, short coachingNote optional.
6. Emit analysisConfidence 0..1 for the whole call — a 78 where many points came from low-confidence inference is different from a 78 on clean signals.
7. Respond with JSON only matching the schema (one line per theme below — every themeKey exactly once).

THEMES FOR THIS PROFILE:
${themeBlocks.join("\n\n")}`;
}

function videoFactsReady(facts: VideoFactsDraft | null | undefined): boolean {
  return !!facts && facts.status === "ready";
}

function userPrompt(input: PostCallScorecardInput, profile: RubricProfileSeed): string {
  const factsReady = videoFactsReady(input.videoFacts);
  const lines = [
    `Score this ${profile.callType} call against the profile above.`,
    "",
    `Video stream available: ${input.videoAvailable ? "yes" : "NO"}`,
    `Pass 2 video facts ready: ${factsReady ? "yes" : "NO — mark video-dependent themes not applicable unless stream+facts both ready"}`,
    `Deck link provided: ${input.deckLink?.trim() ? "yes" : "NO — slide_deck not applicable if in profile"}`,
  ];
  if (factsReady && input.videoFacts) {
    const vf = input.videoFacts;
    lines.push(
      "",
      "=== PASS 2 VIDEO FACTS (authoritative for camera_on + cde_build; use for call_flow / engagement) ===",
      `visual_analysis_consent: ${vf.visualAnalysisConsent ? "yes" : "no"}`,
      `camera_on_pct: ${vf.cameraOnPct == null ? "unknown" : `${vf.cameraOnPct}%`}`,
      `share_on_pct: ${vf.shareOnPct == null ? "unknown" : `${vf.shareOnPct}%`}`,
      `cde_customized: ${vf.cdeCustomized == null ? "unknown" : vf.cdeCustomized ? "yes" : "no"}`,
      `cde_evidence: ${vf.cdeEvidence || "none"}`,
      `duration_sec: ${vf.durationSec ?? "unknown"}`,
      `stream_kind: ${vf.streamKind || "unknown"}`,
      `segments: ${JSON.stringify(vf.segments.slice(0, 40))}`,
      `keyframe_count: ${vf.keyframeRefs.length}`,
    );
    if (vf.cameraOnPct != null) {
      lines.push(
        `For camera_on: score ≈ camera_on_pct (${vf.cameraOnPct}). Do not invent a different camera percentage.`,
      );
    }
    if (vf.cdeCustomized != null) {
      lines.push(
        `For cde_build: treat cde_customized=${vf.cdeCustomized} as the vision ground truth; evidence: ${vf.cdeEvidence || "n/a"}.`,
      );
    }
  }
  if (input.companyName) lines.push(`Company: ${input.companyName}`);
  if (input.meetingTitle) lines.push(`Meeting title: ${input.meetingTitle}`);
  if (input.briefContext?.trim()) {
    lines.push("", "=== PRE-CALL BRIEF (answer key for research_agenda) ===", input.briefContext.trim());
  }
  lines.push(
    "",
    "=== TIMESTAMPED TRANSCRIPT ===",
    formatTimestampedTranscript(input.transcript, 5500),
    "=== END TRANSCRIPT ===",
  );
  return lines.join("\n");
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function normalizeEvidence(raw: unknown[]): ScorecardEvidence[] {
  const out: ScorecardEvidence[] = [];
  for (const item of raw || []) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const quote = String(e.quote ?? "").trim();
    if (!quote) continue;
    const atS = typeof e.atS === "number" && Number.isFinite(e.atS) ? e.atS : null;
    out.push({
      atS,
      quote: trimWords(quote, 40),
      source: (e.source as ScorecardEvidence["source"]) || "transcript",
    });
    if (out.length >= 3) break;
  }
  return out;
}

function hasTimestampedEvidence(evidence: ScorecardEvidence[]): boolean {
  return evidence.some((e) => e.atS != null && Number.isFinite(e.atS) && e.quote);
}

export interface NormalizeScorecardOptions {
  profile: RubricProfileSeed;
  videoAvailable: boolean;
  deckPresent: boolean;
  modelLines: Array<Record<string, unknown>>;
  modelAnalysisConfidence?: number;
  videoFacts?: VideoFactsDraft | null;
}

/** Deterministic post-process of model lines — applies hard NA rules and confidence caps. */
export function normalizeScorecardLines(opts: NormalizeScorecardOptions): {
  lines: ScorecardLineDraft[];
  analysisConfidence: number;
} {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of opts.modelLines || []) {
    const key = String(row.themeKey || "");
    if (key) byKey.set(key, row);
  }

  const lines: ScorecardLineDraft[] = [];

  for (const theme of opts.profile.themes) {
    const modelProvided = byKey.has(theme.themeKey);
    const raw = byKey.get(theme.themeKey) || {};
    const anchors = anchorsJsonForTheme(theme.themeKey, opts.profile.callType);
    let applicable = raw.applicable !== false;
    let score = typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : 0;
    score = Math.max(0, Math.min(100, Math.round(score)));
    let confidence =
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? clamp01(raw.confidence)
        : 0.5;
    let notApplicableReason =
      typeof raw.notApplicableReason === "string" ? raw.notApplicableReason.trim() : "";
    let evidence = normalizeEvidence(Array.isArray(raw.evidence) ? raw.evidence : []);
    let coachingNote = trimWords(String(raw.coachingNote ?? ""), 20) || null;

    // Hard rules — evidence/source driven. Streams alone are not enough; need Pass 2 facts.
    const factsReady = videoFactsReady(opts.videoFacts);
    const canScoreVideo = !!opts.videoAvailable && factsReady;

    if (isVideoTheme(theme.themeKey) && !canScoreVideo) {
      applicable = false;
      score = 0;
      evidence = [];
      notApplicableReason = opts.videoAvailable
        ? "Video stream found but Pass 2 facts not ready (VPS ffmpeg / video-pass)."
        : VIDEO_THEME_NA_REASON;
      confidence = 1;
      coachingNote = null;
    }

    if (theme.themeKey === "slide_deck" && !opts.deckPresent) {
      applicable = false;
      score = 0;
      evidence = [];
      notApplicableReason = SLIDE_DECK_NA_REASON;
      confidence = 1;
      coachingNote = null;
    }

    if (theme.themeKey === "camera_on" && !canScoreVideo) {
      // Belt-and-suspenders — never infer from transcript (§6.5)
      applicable = false;
      score = 0;
      evidence = [];
      notApplicableReason = opts.videoAvailable
        ? "Video stream found but Pass 2 facts not ready (VPS ffmpeg / video-pass)."
        : VIDEO_THEME_NA_REASON;
      confidence = 1;
    }

    // Authoritative camera_on from Pass 2 vision sampling (requires consent)
    if (theme.themeKey === "camera_on" && canScoreVideo) {
      if (!opts.videoFacts?.visualAnalysisConsent || opts.videoFacts.cameraOnPct == null) {
        applicable = false;
        score = 0;
        evidence = [];
        notApplicableReason = !opts.videoFacts?.visualAnalysisConsent
          ? "Visual analysis consent not granted — camera_on not scored (spec §12.8)."
          : "Pass 2 ran but camera_on_pct unavailable.";
        confidence = 1;
        coachingNote = null;
      } else {
        applicable = true;
        score = Math.max(0, Math.min(100, Math.round(opts.videoFacts.cameraOnPct)));
        notApplicableReason = "";
        confidence = Math.max(confidence, 0.75);
        if (!evidence.length) {
          evidence = [
            {
              atS: 0,
              quote: `Pass 2 sampled camera-on ${score}% across keyframes.`,
              source: "video",
            },
          ];
        }
      }
    }

    // Authoritative cde_build from Pass 2 vision (screen content — allowed without face consent)
    if (theme.themeKey === "cde_build" && canScoreVideo && opts.videoFacts?.cdeCustomized != null) {
      applicable = true;
      score = opts.videoFacts.cdeCustomized ? 85 : 35;
      notApplicableReason = "";
      confidence = Math.max(confidence, 0.7);
      const quote =
        opts.videoFacts.cdeEvidence ||
        (opts.videoFacts.cdeCustomized
          ? "Pass 2 vision: CDE appears customer-customized."
          : "Pass 2 vision: CDE looks like stock/seed data.");
      if (!evidence.length) {
        evidence = [{ atS: 0, quote: trimWords(quote, 40), source: "video" }];
      }
    }

    if (!applicable) {
      score = 0;
      if (!notApplicableReason) notApplicableReason = "Not evidenced on this call.";
    } else {
      notApplicableReason = "";
      if (!isThemeAnchored(anchors)) {
        confidence = applyUnanchoredConfidenceCap(confidence);
      }
      if (!hasTimestampedEvidence(evidence)) {
        confidence = Math.min(confidence, 0.35);
        if (!coachingNote) {
          coachingNote = trimWords(NO_TIMESTAMP_EVIDENCE_REASON, 20);
        }
      }
      if (theme.themeKey === "slide_deck") {
        // Proxies only — flag low confidence (spec §6.5)
        confidence = Math.min(confidence, 0.45);
      }
    }

    // Model returned fewer lines than the profile — never treat omission as applicable score 0.
    if (!modelProvided) {
      const hardNaReason =
        notApplicableReason &&
        notApplicableReason !== "Not evidenced on this call." &&
        notApplicableReason !== MODEL_OMITTED_THEME_REASON;
      if (!hardNaReason) {
        applicable = false;
        score = 0;
        evidence = [];
        notApplicableReason = MODEL_OMITTED_THEME_REASON;
        confidence = MODEL_OMITTED_CONFIDENCE;
        coachingNote = null;
      } else {
        confidence = Math.min(confidence, MODEL_OMITTED_CONFIDENCE);
      }
    }

    lines.push({
      themeKey: theme.themeKey,
      score,
      maxScore: 100,
      applicable,
      notApplicableReason: notApplicableReason || null,
      confidence,
      evidence,
      coachingNote,
      weight: theme.weight,
    });
  }

  // Call-level confidence: model hint blended with applicable-line weighted mean + video band
  let lineConfSum = 0;
  let lineWeight = 0;
  for (const line of lines) {
    if (!line.applicable || line.confidence == null) continue;
    lineConfSum += line.confidence * line.weight;
    lineWeight += line.weight;
  }
  const lineMean = lineWeight > 0 ? lineConfSum / lineWeight : 0.4;
  const modelConf =
    typeof opts.modelAnalysisConfidence === "number"
      ? clamp01(opts.modelAnalysisConfidence)
      : lineMean;
  const videoBand = analysisConfidenceForVideo(opts.videoAvailable);
  let analysisConfidence = clamp01(Math.min(modelConf, lineMean) * 0.7 + videoBand * 0.3);

  const omittedCount = opts.profile.themes.filter((t) => !byKey.has(t.themeKey)).length;
  if (omittedCount > 0) {
    const completeness = 1 - omittedCount / opts.profile.themes.length;
    analysisConfidence = clamp01(analysisConfidence * completeness);
  }

  return { lines, analysisConfidence };
}

export function buildScorecardDraft(
  profile: RubricProfileSeed,
  lines: ScorecardLineDraft[],
  analysisConfidence: number,
): ScorecardDraft {
  const composite = typeComposite(
    [{ callType: profile.callType, rubricVersion: profile.version, lines }],
    profile.callType,
    { includeIneligible: true },
  );
  const denom = composite.applicableWeight > 0 ? 100 : 0;
  const rawScore = composite.score ?? 0;

  return {
    rubricId: rubricIdFor(profile.callType, profile.version),
    callType: profile.callType,
    rubricVersion: profile.version || RUBRIC_VERSION,
    provisional: !!profile.provisional,
    rawScore,
    denominator: denom,
    confidence: analysisConfidence,
    lines,
  };
}

export async function runPostCallScorecard(
  env: Env,
  input: PostCallScorecardInput,
): Promise<PostCallScorecardResult> {
  const transcript = input.transcript?.trim();
  if (!transcript) throw new Error("transcript is required for scorecard.");

  const profile = profileFor(input.callType);
  const themeKeys = profile.themes.map((t) => t.themeKey);
  const deckPresent = !!input.deckLink?.trim();

  const provider = getPostCallProvider(env);
  const result = await provider.generate({
    maxTokens: 8000,
    system: buildScorecardSystemPrompt(profile),
    user: userPrompt(input, profile),
    effort: env.POSTCALL_EFFORT || env.EFFORT || "medium",
    research: false,
    thinkingBudget: 0,
    jsonSchema: scorecardJsonSchema(themeKeys),
    step: "postcall-scorecard",
  });

  const parsed = extractJson<{
    lines?: Array<Record<string, unknown>>;
    analysisConfidence?: number;
  }>(result.text);

  const { lines, analysisConfidence } = normalizeScorecardLines({
    profile,
    videoAvailable: !!input.videoAvailable,
    deckPresent,
    modelLines: parsed.lines || [],
    modelAnalysisConfidence: parsed.analysisConfidence,
    videoFacts: input.videoFacts,
  });

  const scorecard = buildScorecardDraft(profile, lines, analysisConfidence);
  return {
    scorecard,
    analysisConfidence,
    provisional: scorecard.provisional,
  };
}
