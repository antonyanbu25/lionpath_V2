/**
 * Pass 3 — QIP scorecard scoring against the confirmed call type's profile (v2.1).
 * Model scores five sub-parameters per theme (0/1/2); theme grade computed in code.
 */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";
import {
  analysisConfidenceForVideo,
  profileFor,
  QIP_PROFILES,
  RUBRIC_VERSION,
  rubricIdFor,
  VIDEO_THEME_NA_REASON,
  type CallType,
  type QipProfile,
  type QipTheme,
} from "../rubric-profiles";
import { computeThemeGrade, scoreCall, type SubParameterScore } from "../quality-score";
import { themeLabel } from "../theme-library";
import { formatTimestampedTranscript } from "../transcript";
import { trimWords } from "../word-limits";
import type { DealRiskFlag, ScorecardEvidence, SubParameterLine } from "../domain-model/scorecard";
import type { VideoFactsDraft } from "../domain-model/video-facts";

export type Env = ProviderEnv;

export const SLIDE_DECK_NA_REASON = "No deck shared on this call.";
export const NO_TIMESTAMP_EVIDENCE_REASON =
  "Applicable score lacks timestamped transcript evidence.";
import {
  MODEL_OMITTED_THEME_REASON,
  MODEL_OMITTED_CONFIDENCE,
  themeNotEvidencedReason,
} from "./qip-scorecard-shared.js";

export { MODEL_OMITTED_THEME_REASON, MODEL_OMITTED_CONFIDENCE };

export interface ScorecardLineDraft {
  themeKey: string;
  subParameters: SubParameterLine[];
  grade: number;
  credit: 1 | 2 | 3;
  category: string;
  evidenceUnavailable: boolean;
  modelOmitted?: boolean;
  confidence: number | null;
  coachingNote: string | null;
}

export interface ScorecardDraft {
  rubricId: string;
  callType: CallType;
  rubricVersion: string;
  provisional: boolean;
  overall: number;
  totalCredits: number;
  includedCredits: number;
  categoryScores: Record<string, number>;
  confidence: number;
  lines: ScorecardLineDraft[];
  dealRiskFlags: DealRiskFlag[];
}

export interface PostCallScorecardInput {
  transcript: string;
  callType: CallType;
  videoAvailable: boolean;
  deckLink?: string | null;
  briefContext?: string | null;
  companyName?: string;
  meetingTitle?: string;
  videoFacts?: VideoFactsDraft | null;
}

export interface PostCallScorecardResult {
  scorecard: ScorecardDraft;
  analysisConfidence: number;
  provisional: boolean;
}

function isVideoTheme(theme: QipTheme): boolean {
  return !!theme.requiresVideo;
}

function scorecardJsonSchema(themeKeys: string[]): Record<string, unknown> {
  const subParamSchema = {
    type: "object",
    additionalProperties: false,
    required: ["score"],
    properties: {
      score: { type: "integer", enum: [0, 1, 2] },
      evidence: {
        type: "array",
        maxItems: 2,
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
    },
  };

  return {
    type: "object",
    additionalProperties: false,
    required: ["lines", "analysisConfidence", "dealRiskFlags"],
    properties: {
      analysisConfidence: { type: "number", minimum: 0, maximum: 1 },
      dealRiskFlags: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["category", "description"],
          properties: {
            category: {
              type: "string",
              enum: [
                "claim_to_verify",
                "commitment_outside_remit",
                "missing_stakeholder",
                "process_gap",
                "legal_compliance",
              ],
            },
            description: { type: "string" },
            atS: { type: "number", nullable: true },
            quote: { type: "string", nullable: true },
            severity: { type: "string", nullable: true },
          },
        },
      },
      lines: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["themeKey", "subParameters", "confidence", "coachingNote"],
          properties: {
            themeKey: { type: "string", enum: themeKeys },
            subParameters: {
              type: "array",
              minItems: 5,
              maxItems: 5,
              items: subParamSchema,
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            coachingNote: { type: "string" },
          },
        },
      },
    },
  };
}

/** Build system prompt for ONE confirmed profile. */
export function buildScorecardSystemPrompt(profile: QipProfile): string {
  const themeBlocks = profile.themes.map((t) => {
    const spList = t.subParameters.map((sp, i) => `  SP${i + 1}: ${sp}`).join("\n");
    return [
      `### ${t.key} (credit ${t.credit}, ${t.category}) — ${themeLabel(t.key)}`,
      t.requiresVideo ? "Requires video evidence — mark evidence_unavailable if no recording." : "",
      "Sub-parameters (score each 0/1/2 independently):",
      spList,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `You are an SE quality scorer for QIP v2.1. Score ONLY the themes listed for this confirmed call type.
Do not choose a call type. Do not score themes outside this profile.

Call type: ${profile.key}
Rubric version: ${profile.version}
Profile total credits: ${profile.totalCredits}
Shadow/provisional profile: ${profile.provisional ? "yes" : "no"}

RULES (mandatory):
1. Each theme: exactly five subParameters, each score 0|1|2 with optional evidence[].
   - 0 = absent / not done
   - 1 = partial / attempted but weak
   - 2 = done well with clear evidence
2. Do NOT output a theme grade — the system sums sub-parameters (0–10).
3. Evidence must be VERBATIM from the transcript WITH timestamp (atS in seconds) when from transcript.
4. coachingNote: max 20 words, one specific action for next time.
5. APPLICABILITY:
   - Theme not evidenced on call → score all five sub-parameters 0 (stays in denominator).
   - requires_video theme with no video → set all sub-parameters to 0 AND we will mark evidence_unavailable.
   - No deck shared → slide_deck: all sub-parameters 0.
6. dealRiskFlags: separate array for one-off incidents (§6) — factual claims to verify, commitments outside remit, missing stakeholders, process gaps, legal/compliance statements. Does NOT affect the QIP number.
7. Emit analysisConfidence 0..1 for the whole call.
8. Respond with JSON only — one line per theme below, every themeKey exactly once.

THEMES FOR THIS PROFILE:
${themeBlocks.join("\n\n")}`;
}

function videoFactsReady(facts: VideoFactsDraft | null | undefined): boolean {
  return !!facts && facts.status === "ready";
}

function slideSegmentsFromFacts(facts: VideoFactsDraft | null | undefined) {
  return (facts?.segments || []).filter((s) => s.segmentType === "slides");
}

function slideTimeOnDeckSec(facts: VideoFactsDraft | null | undefined): number {
  return slideSegmentsFromFacts(facts).reduce(
    (sum, s) => sum + Math.max(0, s.endS - s.startS),
    0,
  );
}

export function deckPresentForScorecard(
  deckLink: string | null | undefined,
  videoFacts: VideoFactsDraft | null | undefined,
): boolean {
  if (deckLink?.trim()) return true;
  if (!videoFactsReady(videoFacts)) return false;
  if (slideSegmentsFromFacts(videoFacts).length > 0) return true;
  const sharePct = videoFacts!.shareOnPct;
  if (sharePct != null && sharePct >= 25) return true;
  return false;
}

function userPrompt(input: PostCallScorecardInput, profile: QipProfile): string {
  const factsReady = videoFactsReady(input.videoFacts);
  const deckPresent = deckPresentForScorecard(input.deckLink, input.videoFacts);
  const lines = [
    `Score this ${profile.key} call against the profile above.`,
    "",
    `Video stream available: ${input.videoAvailable ? "yes" : "NO"}`,
    `Pass 2 video facts ready: ${factsReady ? "yes" : "NO"}`,
    `Deck present (link OR video slides/share): ${deckPresent ? "yes" : "NO — slide_deck scores 0 if in profile"}`,
    `Deck link provided: ${input.deckLink?.trim() ? "yes" : "no"}`,
  ];
  if (factsReady && input.videoFacts) {
    const vf = input.videoFacts;
    const slideSecs = slideTimeOnDeckSec(vf);
    lines.push(
      "",
      "=== PASS 2 VIDEO FACTS ===",
      `visual_analysis_consent: ${vf.visualAnalysisConsent ? "yes" : "no"}`,
      `camera_on_pct: ${vf.cameraOnPct == null ? "unknown" : `${vf.cameraOnPct}%`}`,
      `share_on_pct: ${vf.shareOnPct == null ? "unknown" : `${vf.shareOnPct}%`}`,
      `cde_customized: ${vf.cdeCustomized == null ? "unknown" : vf.cdeCustomized ? "yes" : "no"}`,
      `cde_evidence: ${vf.cdeEvidence || "none"}`,
      `slide_time_on_deck_sec: ${slideSecs > 0 ? slideSecs : "none detected"}`,
    );
    const slideSegs = slideSegmentsFromFacts(vf);
    if (slideSegs.length) {
      lines.push(
        "video_slide_segments:",
        ...slideSegs.map(
          (s) =>
            `  ${Math.round(s.startS)}s–${Math.round(s.endS)}s (${Math.round(s.endS - s.startS)}s) — ${s.label || "slides"}`,
        ),
      );
    }
    const otherSegs = (vf.segments || []).filter((s) => s.segmentType !== "slides");
    if (otherSegs.length) {
      lines.push(
        "video_other_segments:",
        ...otherSegs.slice(0, 8).map(
          (s) =>
            `  ${Math.round(s.startS)}s–${Math.round(s.endS)}s ${s.segmentType} — ${s.label || ""}`.trim(),
        ),
      );
    }
  }
  if (input.companyName) lines.push(`Company: ${input.companyName}`);
  if (input.meetingTitle) lines.push(`Meeting title: ${input.meetingTitle}`);
  if (input.briefContext?.trim()) {
    lines.push("", "=== PRE-CALL BRIEF (answer key for research) ===", input.briefContext.trim());
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

function clampSubScore(n: unknown): 0 | 1 | 2 {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.max(0, Math.min(2, v)) as 0 | 1 | 2;
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
    if (out.length >= 2) break;
  }
  return out;
}

function normalizeSubParameters(raw: unknown): SubParameterLine[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: SubParameterLine[] = [];
  for (let i = 0; i < 5; i += 1) {
    const item = arr[i];
    if (!item || typeof item !== "object") {
      out.push({ score: 0, evidence: [] });
      continue;
    }
    const row = item as Record<string, unknown>;
    out.push({
      score: clampSubScore(row.score),
      evidence: normalizeEvidence(Array.isArray(row.evidence) ? row.evidence : []),
    });
  }
  return out;
}

function hasTimestampedEvidence(subParameters: SubParameterLine[]): boolean {
  return subParameters.some((sp) =>
    sp.evidence.some((e) => e.atS != null && Number.isFinite(e.atS) && e.quote),
  );
}

/** Map camera_on_pct (0–100) to five sub-parameter scores totalling 0–10. */
function cameraSubParametersFromPct(pct: number): SubParameterLine[] {
  const grade = Math.round(Math.max(0, Math.min(100, pct)) / 10);
  const base = Math.floor(grade / 5);
  const extra = grade % 5;
  return Array.from({ length: 5 }, (_, i) => ({
    score: clampSubScore(base + (i < extra ? 1 : 0)),
    evidence: [],
  }));
}

/** Map CDE customized boolean to sub-parameter pattern. */
function cdeSubParametersFromVision(customized: boolean): SubParameterLine[] {
  const grade = customized ? 8 : 3;
  const base = Math.floor(grade / 5);
  const extra = grade % 5;
  return Array.from({ length: 5 }, (_, i) => ({
    score: clampSubScore(base + (i < extra ? 1 : 0)),
    evidence: [],
  }));
}

export interface NormalizeScorecardOptions {
  profile: QipProfile;
  videoAvailable: boolean;
  deckPresent: boolean;
  modelLines: Array<Record<string, unknown>>;
  modelDealRiskFlags?: DealRiskFlag[];
  modelAnalysisConfidence?: number;
  videoFacts?: VideoFactsDraft | null;
}

/** Deterministic post-process — video/deck rules, grade computation, confidence. */
export function normalizeScorecardLines(opts: NormalizeScorecardOptions): {
  lines: ScorecardLineDraft[];
  dealRiskFlags: DealRiskFlag[];
  analysisConfidence: number;
} {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of opts.modelLines || []) {
    const key = String(row.themeKey || "");
    if (key) byKey.set(key, row);
  }

  const factsReady = videoFactsReady(opts.videoFacts);
  const canScoreVideo = !!opts.videoAvailable && factsReady;
  const lines: ScorecardLineDraft[] = [];

  for (const theme of opts.profile.themes) {
    const modelProvided = byKey.has(theme.key);
    const raw = byKey.get(theme.key) || {};
    let subParameters = normalizeSubParameters(raw.subParameters);
    let confidence =
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? clamp01(raw.confidence)
        : 0.5;
    let coachingNote = trimWords(String(raw.coachingNote ?? ""), 20) || null;
    let evidenceUnavailable = false;
    let modelOmitted = false;

    if (isVideoTheme(theme) && !canScoreVideo) {
      subParameters = Array.from({ length: 5 }, () => ({ score: 0 as const, evidence: [] }));
      evidenceUnavailable = true;
      confidence = 1;
      coachingNote = null;
    }

    if (theme.key === "slide_deck" && !opts.deckPresent) {
      subParameters = Array.from({ length: 5 }, () => ({ score: 0 as const, evidence: [] }));
      confidence = Math.min(confidence, 0.45);
      coachingNote = null;
    }

    if (theme.key === "camera_on" && canScoreVideo) {
      if (!opts.videoFacts?.visualAnalysisConsent || opts.videoFacts.cameraOnPct == null) {
        subParameters = Array.from({ length: 5 }, () => ({ score: 0 as const, evidence: [] }));
        evidenceUnavailable = true;
        confidence = 1;
        coachingNote = null;
      } else {
        subParameters = cameraSubParametersFromPct(opts.videoFacts.cameraOnPct);
        confidence = Math.max(confidence, 0.75);
        const quote = `Recording showed camera on ${Math.round(opts.videoFacts.cameraOnPct)}% across keyframes.`;
        subParameters[0] = {
          ...subParameters[0],
          evidence: [{ atS: 0, quote, source: "video" }],
        };
      }
    }

    if (theme.key === "cde_build" && canScoreVideo && opts.videoFacts?.cdeCustomized != null) {
      subParameters = cdeSubParametersFromVision(opts.videoFacts.cdeCustomized);
      confidence = Math.max(confidence, 0.7);
      const quote =
        opts.videoFacts.cdeEvidence ||
        (opts.videoFacts.cdeCustomized
          ? "Video analysis: CDE appears customer-customized."
          : "Video analysis: CDE looks like stock/seed data.");
      subParameters[0] = {
        ...subParameters[0],
        evidence: [{ atS: 0, quote: trimWords(quote, 40), source: "video" }],
      };
    }

    if (!evidenceUnavailable && !hasTimestampedEvidence(subParameters)) {
      confidence = Math.min(confidence, 0.35);
      if (!coachingNote) coachingNote = trimWords(NO_TIMESTAMP_EVIDENCE_REASON, 20);
    }

    if (!modelProvided) {
      subParameters = Array.from({ length: 5 }, () => ({ score: 0 as const, evidence: [] }));
      if (evidenceUnavailable) {
        modelOmitted = true;
        confidence = MODEL_OMITTED_CONFIDENCE;
        if (!coachingNote) coachingNote = MODEL_OMITTED_THEME_REASON;
      } else {
        confidence = 0.35;
        coachingNote = trimWords(themeNotEvidencedReason(theme.key), 20);
      }
    }

    const grade = evidenceUnavailable ? 0 : computeThemeGrade(subParameters);

    lines.push({
      themeKey: theme.key,
      subParameters,
      grade,
      credit: theme.credit,
      category: theme.category,
      evidenceUnavailable,
      modelOmitted,
      confidence,
      coachingNote,
    });
  }

  const themeInputs = lines.map((l) => ({
    themeKey: l.themeKey,
    subParameters: l.subParameters.map((sp) => ({ score: sp.score })) as SubParameterScore[],
    evidenceUnavailable: l.evidenceUnavailable || !!l.modelOmitted,
    modelOmitted: !!l.modelOmitted,
  }));

  const scored = scoreCall(opts.profile, themeInputs);

  let lineConfSum = 0;
  let lineCredit = 0;
  for (const line of lines) {
    if (line.evidenceUnavailable || line.confidence == null) continue;
    lineConfSum += line.confidence * line.credit;
    lineCredit += line.credit;
  }
  const lineMean = lineCredit > 0 ? lineConfSum / lineCredit : 0.4;
  const modelConf =
    typeof opts.modelAnalysisConfidence === "number"
      ? clamp01(opts.modelAnalysisConfidence)
      : lineMean;
  const videoBand = analysisConfidenceForVideo(opts.videoAvailable);
  let analysisConfidence = clamp01(Math.min(modelConf, lineMean) * 0.7 + videoBand * 0.3);

  const excludedCount = lines.filter((l) => l.evidenceUnavailable).length;
  if (excludedCount > 0) {
    analysisConfidence = clamp01(analysisConfidence * (1 - excludedCount * 0.05));
  }

  const omittedCount = opts.profile.themes.filter((t) => !byKey.has(t.key)).length;
  if (omittedCount > 0) {
    analysisConfidence = clamp01(analysisConfidence * (1 - omittedCount / opts.profile.themes.length));
  }

  const dealRiskFlags = (opts.modelDealRiskFlags || []).map((f) => ({
    category: f.category,
    description: trimWords(String(f.description ?? ""), 60),
    atS: f.atS ?? null,
    quote: f.quote ? trimWords(String(f.quote), 40) : null,
    severity: f.severity ?? null,
  }));

  // Attach computed grades from scoreCall
  for (const line of lines) {
    const t = scored.themes.find((x) => x.themeKey === line.themeKey);
    if (t) line.grade = t.grade;
  }

  return { lines, dealRiskFlags, analysisConfidence };
}

export function buildScorecardDraft(
  profile: QipProfile,
  lines: ScorecardLineDraft[],
  analysisConfidence: number,
  dealRiskFlags: DealRiskFlag[] = [],
): ScorecardDraft {
  const scored = scoreCall(
    profile,
    lines.map((l) => ({
      themeKey: l.themeKey,
      subParameters: l.subParameters.map((sp) => ({ score: sp.score })),
      evidenceUnavailable: l.evidenceUnavailable || !!l.modelOmitted,
      modelOmitted: !!l.modelOmitted,
    })),
  );

  return {
    rubricId: rubricIdFor(profile.key, profile.version),
    callType: profile.key,
    rubricVersion: profile.version || RUBRIC_VERSION,
    provisional: !!profile.provisional,
    overall: scored.overall,
    totalCredits: scored.totalCredits,
    includedCredits: scored.includedCredits,
    categoryScores: scored.categoryScores,
    confidence: analysisConfidence,
    lines,
    dealRiskFlags,
  };
}

export async function runPostCallScorecard(
  env: Env,
  input: PostCallScorecardInput,
): Promise<PostCallScorecardResult> {
  const transcript = input.transcript?.trim();
  if (!transcript) throw new Error("transcript is required for scorecard.");

  const profile = profileFor(input.callType);
  const themeKeys = profile.themes.map((t) => t.key);
  const deckPresent = deckPresentForScorecard(input.deckLink, input.videoFacts);

  const provider = getPostCallProvider(env);
  const result = await provider.generate({
    maxTokens: 12000,
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
    dealRiskFlags?: DealRiskFlag[];
    analysisConfidence?: number;
  }>(result.text);

  const { lines, dealRiskFlags, analysisConfidence } = normalizeScorecardLines({
    profile,
    videoAvailable: !!input.videoAvailable,
    deckPresent,
    modelLines: parsed.lines || [],
    modelDealRiskFlags: parsed.dealRiskFlags || [],
    modelAnalysisConfidence: parsed.analysisConfidence,
    videoFacts: input.videoFacts,
  });

  const scorecard = buildScorecardDraft(profile, lines, analysisConfidence, dealRiskFlags);
  return {
    scorecard,
    analysisConfidence,
    provisional: scorecard.provisional,
  };
}

/** @deprecated use QIP_PROFILES */
export { QIP_PROFILES as RUBRIC_PROFILES };

/** @deprecated v2.1 — video themes use requiresVideo on profile themes */
export const VIDEO_THEME_NA_REASON_EXPORT = VIDEO_THEME_NA_REASON;
