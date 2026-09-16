/**
 * Scorecard reevaluation (v2.2 hatchet → v2.4 rescoring) — a second LLM pass that re-scores
 * every applicable QIP sub-parameter (0, 1, or 2) and every qualityCoach dimension (1–5)
 * against the transcript. It may raise or lower the first pass; it does not only attack
 * top marks. One LLM call covers both scores. generate.ts calls this on every call.
 * Skips the LLM only when nothing is scorable (every QIP line evidenceUnavailable / omitted,
 * and no qualityCoach dimensions). Recompute uses the same scoreCall / computeOverallScore
 * paths as the rest of scoring — this file never hand-rolls a second scoring implementation.
 */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";
import {
  computeThemeGrade,
  computeOverallScore,
  overallLabelFromScore,
  scoreCall,
  LEADERSHIP_CAP_THRESHOLD,
  type ScoreCallResult,
} from "../quality-score";
import type { QipProfile } from "../rubric-profiles";
import { formatTimestampedTranscript, parseTranscriptCues } from "../transcript";
import { trimWords } from "../word-limits";
import type { ScorecardDraft, ScorecardLineDraft } from "./scorecard";
import type { PostCallAnalysis } from "../postcall-schema";
import { applyDiscoveryIncidentApplicability } from "./discovery-incident-applicability";

export type Env = ProviderEnv;

export { LEADERSHIP_CAP_THRESHOLD };

export type QualityCoachDraft = PostCallAnalysis["qualityCoach"];

export interface VerifierJustification {
  /** "qip" candidates carry themeKey/subParamIndex; "qualityCoach" candidates carry dimensionIndex. */
  kind: "qip" | "qualityCoach";
  themeKey?: string;
  subParamIndex?: number;
  dimensionIndex?: number;
  /** True when the second pass kept the first-pass score. */
  confirmed: boolean;
  /** Score after reevaluation. */
  newScore: number;
  /** One-line reason — why this score, citing transcript evidence or the lack of it. */
  justification: string;
}

export interface ScorecardVerifyResult {
  /** Scorecard with reevaluated scores and grades/overall/categoryScores recomputed. Unset when no scorecard was passed in. */
  scorecard?: ScorecardDraft;
  /** qualityCoach with reevaluated dimensions and overallScore/overallLabel recomputed. Unset when no qualityCoach was passed in. */
  qualityCoach?: QualityCoachDraft;
  /** True when every candidate received a verdict — the second pass completed. Score changes do not fail this. */
  verified: boolean;
  justifications: VerifierJustification[];
}

interface QipCandidate {
  id: string;
  kind: "qip";
  themeKey: string;
  subParamIndex: number;
  currentScore: 0 | 1 | 2;
}

interface QualityCoachCandidate {
  id: string;
  kind: "qualityCoach";
  dimensionIndex: number;
  dimensionName: string;
  currentScore: number;
}

type Candidate = QipCandidate | QualityCoachCandidate;

const REMOTE_ERROR_RETRY_DELAY_MS = 1500;

function isRemoteError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("timeout") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed") ||
    msg.includes("remote_error") ||
    msg.includes("gemini api")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectQipCandidates(lines: ScorecardLineDraft[]): QipCandidate[] {
  const out: QipCandidate[] = [];
  for (const line of lines) {
    if (line.evidenceUnavailable || line.modelOmitted) continue;
    line.subParameters.forEach((sp, i) => {
      out.push({
        id: `qip::${line.themeKey}::${i}`,
        kind: "qip",
        themeKey: line.themeKey,
        subParamIndex: i,
        currentScore: sp.score,
      });
    });
  }
  return out;
}

function collectQualityCoachCandidates(qc: QualityCoachDraft | undefined): QualityCoachCandidate[] {
  if (!qc?.dimensions?.length) return [];
  return qc.dimensions.map((d, i) => ({
    id: `qc::${i}`,
    kind: "qualityCoach" as const,
    dimensionIndex: i,
    dimensionName: d.name,
    currentScore: d.score,
  }));
}

function verifySchema(candidates: Candidate[]): Record<string, unknown> {
  const themeKeyEnum = [...new Set(candidates.filter((c): c is QipCandidate => c.kind === "qip").map((c) => c.themeKey))];
  return {
    type: "object",
    additionalProperties: false,
    required: ["verdicts"],
    properties: {
      verdicts: {
        type: "array",
        minItems: candidates.length,
        maxItems: candidates.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["confirmed", "newScore", "reason"],
          properties: {
            // For a "qip::" item: set themeKey + subParamIndex, leave dimensionIndex null.
            // For a "qc::" item: set dimensionIndex, leave themeKey/subParamIndex null.
            themeKey: themeKeyEnum.length ? { type: "string", enum: themeKeyEnum, nullable: true } : { type: "string", nullable: true },
            subParamIndex: { type: "integer", minimum: 0, maximum: 4, nullable: true },
            dimensionIndex: { type: "integer", minimum: 0, maximum: 10, nullable: true },
            confirmed: { type: "boolean" },
            newScore: { type: "integer" },
            reason: { type: "string" },
          },
        },
      },
    },
  };
}

function systemPrompt(): string {
  return `You are an SE director re-scoring a post-call scorecard against the transcript. Your job is
to assign the score each item actually earns — not to rubber-stamp the first pass, and not to
only attack high scores. You may raise or lower any item.

Two kinds of items may appear, identified by their label prefix:
- "qip::<theme>::<index>" — a QIP sub-parameter currently scored 0, 1, or 2. Echo back its
  theme key as "themeKey" and its index as "subParamIndex"; leave "dimensionIndex" null.
  Assign newScore 0 (absent / not done), 1 (adequate / typical), or 2 (excellent).
- "qc::<index>" — a quality-coach dimension currently scored 1–5. Echo back its index as
  "dimensionIndex"; leave "themeKey" and "subParamIndex" null. Assign newScore 1–5.

For EACH item listed, re-read the transcript (not just the cited quote) and assign the score
the evidence supports. Set confirmed true when you keep the current score, false when you
change it. Always set newScore to the score you are assigning.

QIP calibration:
- 2 requires clear, verbatim, timestamped evidence it was done well — not merely that it happened.
- 1 is the typical call: evidence something happened, without excellence.
- 0 when it is absent or the transcript contradicts the first-pass claim.
- A first-pass 0 or 1 that the transcript actually supports as excellent MUST be raised to 2.
- A first-pass 2 that the transcript does not support as excellent MUST be lowered to 1 or 0.

RULES (mandatory):
1. Never fabricate. Match the transcript.
2. Do not default to lowering high scores, and do not default to keeping them.
3. Return exactly one verdict for every item listed — no omissions, no extras, matched by
   themeKey+subParamIndex or dimensionIndex as described above.
4. Respond with JSON only: { verdicts: [...] }.`;
}

const VERIFIER_TRANSCRIPT_MAX_WORDS = 5500;
/** Context padding around each cited evidence moment — enough to judge the surrounding exchange. */
const VERIFIER_WINDOW_PAD_SECONDS = 90;

function collectEvidenceTimestamps(candidates: Candidate[], lines: ScorecardLineDraft[]): number[] {
  const lineByKey = new Map(lines.map((l) => [l.themeKey, l]));
  const out: number[] = [];
  for (const c of candidates) {
    if (c.kind !== "qip") continue; // qualityCoach evidence is a plain string with no timestamp
    const line = lineByKey.get(c.themeKey);
    const sp = line?.subParameters[c.subParamIndex];
    for (const e of sp?.evidence || []) {
      if (typeof e.atS === "number" && Number.isFinite(e.atS)) out.push(e.atS);
    }
  }
  return out;
}

function formatVerifierClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatCueLine(cue: { startS: number; speaker?: string | null; text: string }): string {
  const text = cue.speaker ? `${cue.speaker}: ${cue.text}` : cue.text;
  return `[${formatVerifierClock(cue.startS)}] ${text}`;
}

/**
 * Build the transcript excerpt handed to the reevaluator. Cited evidence timestamps are
 * windowed first so early/mid-call moments are not dropped on long calls; leftover budget
 * then fills the rest of the call so a 0 or 1 with no citation can still be raised from
 * moments the first pass never quoted. Falls back to a flat tail when there is nothing to
 * window around (qualityCoach-only, or a transcript with no parseable cues).
 */
function buildVerifierTranscript(transcript: string, evidenceTimestamps: number[]): string {
  const fallback = () => formatTimestampedTranscript(transcript, VERIFIER_TRANSCRIPT_MAX_WORDS);
  if (!evidenceTimestamps.length) return fallback();
  const cues = parseTranscriptCues(transcript);
  if (!cues.length) return fallback();

  const windows = evidenceTimestamps
    .map((t): [number, number] => [Math.max(0, t - VERIFIER_WINDOW_PAD_SECONDS), t + VERIFIER_WINDOW_PAD_SECONDS])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1]) {
      last[1] = Math.max(last[1], w[1]);
    } else {
      merged.push([w[0], w[1]]);
    }
  }

  const out: string[] = [];
  const included = new Set<number>();
  let wordBudget = VERIFIER_TRANSCRIPT_MAX_WORDS;
  const takeCue = (cue: (typeof cues)[number]): boolean => {
    if (included.has(cue.startS)) return true;
    const line = formatCueLine(cue);
    const wordCount = line.split(/\s+/).filter(Boolean).length;
    if (wordCount > wordBudget) return false;
    wordBudget -= wordCount;
    included.add(cue.startS);
    out.push(line);
    return true;
  };

  for (let i = 0; i < merged.length && wordBudget > 0; i++) {
    const [start, end] = merged[i];
    const windowCues = cues.filter((c) => c.startS >= start && c.startS <= end);
    if (!windowCues.length) continue;
    if (out.length) out.push("[... omitted — outside any cited evidence window ...]");
    for (const cue of windowCues) {
      if (!takeCue(cue)) break;
    }
  }

  const remainder = cues.filter((c) => !included.has(c.startS));
  if (wordBudget > 0 && remainder.length) {
    out.push("[... remainder of call ...]");
    for (const cue of remainder) {
      if (!takeCue(cue)) break;
    }
  }

  return out.length ? out.join("\n") : fallback();
}

function subParamLabel(profile: QipProfile | undefined, themeKey: string, index: number): string {
  const theme = profile?.themes.find((t) => t.key === themeKey);
  const label = theme?.subParameters[index];
  return label?.trim() || `sub-parameter ${index + 1}`;
}

function userPrompt(
  candidates: Candidate[],
  lines: ScorecardLineDraft[],
  qc: QualityCoachDraft | undefined,
  transcript: string,
  profile?: QipProfile | null,
): string {
  const lineByKey = new Map(lines.map((l) => [l.themeKey, l]));
  const blocks = candidates.map((c) => {
    if (c.kind === "qip") {
      const line = lineByKey.get(c.themeKey);
      const sp = line?.subParameters[c.subParamIndex];
      const evidenceText =
        (sp?.evidence || [])
          .map(
            (e) =>
              `  - ${e.source || "transcript"}${e.atS != null ? ` @${Math.round(e.atS)}s` : ""}: "${e.quote}"`,
          )
          .join("\n") || "  (no evidence recorded)";
      const label = subParamLabel(profile ?? undefined, c.themeKey, c.subParamIndex);
      return `${c.id} — ${c.themeKey} SP${c.subParamIndex + 1} "${label}", currently scored ${c.currentScore}/2. Cited evidence:\n${evidenceText}`;
    }
    const dim = qc?.dimensions?.[c.dimensionIndex];
    const evidenceText = dim?.evidence?.trim() ? `  - "${dim.evidence.trim()}"` : "  (no evidence recorded)";
    return `${c.id} — quality-coach dimension "${c.dimensionName}", currently scored ${c.currentScore}/5. Cited evidence:\n${evidenceText}`;
  });

  return [
    "Re-score every item below against the transcript. Raise, lower, or keep — match the evidence.",
    "",
    ...blocks,
    "",
    "=== TIMESTAMPED TRANSCRIPT ===",
    buildVerifierTranscript(transcript, collectEvidenceTimestamps(candidates, lines)),
    "=== END TRANSCRIPT ===",
  ].join("\n");
}

/** 0, 1, or 2 from the model; anything else is unset (caller keeps the first-pass score). */
function coerceQipNewScore(raw: unknown): 0 | 1 | 2 | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.round(raw);
  return n === 0 || n === 1 || n === 2 ? (n as 0 | 1 | 2) : null;
}

/** 1–5 from the model; anything else is unset (caller keeps the first-pass score). */
function coerceQualityCoachNewScore(raw: unknown): 1 | 2 | 3 | 4 | 5 | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.round(raw);
  return n >= 1 && n <= 5 ? (n as 1 | 2 | 3 | 4 | 5) : null;
}

function resolveQipScore(
  original: 0 | 1 | 2,
  verdict: Record<string, unknown> | undefined,
): { score: 0 | 1 | 2; confirmed: boolean; missing: boolean } {
  if (!verdict) return { score: original, confirmed: false, missing: true };
  const assigned = coerceQipNewScore(verdict.newScore);
  if (assigned != null) return { score: assigned, confirmed: assigned === original, missing: false };
  if (verdict.confirmed === true) return { score: original, confirmed: true, missing: false };
  return { score: original, confirmed: true, missing: false };
}

function resolveQualityCoachScore(
  original: number,
  verdict: Record<string, unknown> | undefined,
): { score: number; confirmed: boolean; missing: boolean } {
  if (!verdict) return { score: original, confirmed: false, missing: true };
  const assigned = coerceQualityCoachNewScore(verdict.newScore);
  if (assigned != null) return { score: assigned, confirmed: assigned === original, missing: false };
  if (verdict.confirmed === true) return { score: original, confirmed: true, missing: false };
  return { score: original, confirmed: true, missing: false };
}

function recomputeQip(
  profile: QipProfile,
  scorecard: ScorecardDraft,
  verdictByKey: Map<string, Record<string, unknown>>,
  candidates: QipCandidate[],
): { lines: ScorecardLineDraft[]; justifications: VerifierJustification[]; verified: boolean; scored: ScoreCallResult } {
  const candidateKeys = new Set(candidates.map((c) => c.id));
  const justifications: VerifierJustification[] = [];
  let verified = true;

  const updatedLines = scorecard.lines.map((line) => {
    const subParameters = line.subParameters.map((sp, i) => {
      const key = `qip::${line.themeKey}::${i}`;
      if (!candidateKeys.has(key)) return sp;
      const verdict = verdictByKey.get(key);
      const resolved = resolveQipScore(sp.score, verdict);
      if (resolved.missing) {
        verified = false;
        justifications.push({
          kind: "qip",
          themeKey: line.themeKey,
          subParamIndex: i,
          confirmed: false,
          newScore: sp.score,
          justification: "Verifier returned no verdict for this sub-parameter — first-pass score kept.",
        });
        return sp;
      }
      const reason = trimWords(String(verdict?.reason ?? ""), 30);
      justifications.push({
        kind: "qip",
        themeKey: line.themeKey,
        subParamIndex: i,
        confirmed: resolved.confirmed,
        newScore: resolved.score,
        justification: reason,
      });
      return resolved.score === sp.score ? sp : { ...sp, score: resolved.score };
    });
    const grade = line.evidenceUnavailable ? 0 : computeThemeGrade(subParameters);
    return { ...line, subParameters, grade };
  });

  const applicableLines = applyDiscoveryIncidentApplicability(profile, updatedLines);

  const scored = scoreCall(
    profile,
    applicableLines.map((l) => ({
      themeKey: l.themeKey,
      subParameters: l.subParameters.map((sp) => ({ score: sp.score })),
      evidenceUnavailable: l.evidenceUnavailable || !!l.modelOmitted,
      modelOmitted: !!l.modelOmitted,
    })),
  );

  const recomputedLines = applicableLines.map((line) => {
    const t = scored.themes.find((x) => x.themeKey === line.themeKey);
    return t ? { ...line, grade: t.grade } : line;
  });

  return { lines: recomputedLines, justifications, verified, scored };
}

function recomputeQualityCoach(
  qc: QualityCoachDraft,
  verdictByKey: Map<string, Record<string, unknown>>,
  candidates: QualityCoachCandidate[],
): { qualityCoach: QualityCoachDraft; justifications: VerifierJustification[]; verified: boolean } {
  const candidateKeys = new Set(candidates.map((c) => c.id));
  const justifications: VerifierJustification[] = [];
  let verified = true;

  const dimensions = qc.dimensions.map((dim, i) => {
    const key = `qc::${i}`;
    if (!candidateKeys.has(key)) return dim;
    const verdict = verdictByKey.get(key);
    const resolved = resolveQualityCoachScore(dim.score, verdict);
    if (resolved.missing) {
      verified = false;
      justifications.push({
        kind: "qualityCoach",
        dimensionIndex: i,
        confirmed: false,
        newScore: dim.score,
        justification: "Verifier returned no verdict for this dimension — first-pass score kept.",
      });
      return dim;
    }
    const reason = trimWords(String(verdict?.reason ?? ""), 30);
    justifications.push({
      kind: "qualityCoach",
      dimensionIndex: i,
      confirmed: resolved.confirmed,
      newScore: resolved.score,
      justification: reason,
    });
    return resolved.score === dim.score ? dim : { ...dim, score: resolved.score };
  });

  const overallScore = computeOverallScore(dimensions) ?? qc.overallScore;
  return {
    qualityCoach: { ...qc, dimensions, overallScore, overallLabel: overallLabelFromScore(overallScore) },
    justifications,
    verified,
  };
}

/**
 * generate.ts calls this on every call — not gated on LEADERSHIP_CAP_THRESHOLD — so pass
 * whichever of `scorecard` / `qualityCoach` is present. Candidate collection is every
 * scorable sub-parameter / dimension (not only 2s and 5s). Skips the LLM when there is
 * nothing to rescore. Both may be passed together so a single LLM call reevaluates both.
 * `verified` is true when every candidate got a verdict (including vacuously, when nothing
 * was scorable) — a raised or lowered score does not fail it.
 */
export async function verifyScorecardForLeadershipCap(
  env: Env,
  opts: {
    profile?: QipProfile | null;
    scorecard?: ScorecardDraft | null;
    qualityCoach?: QualityCoachDraft | null;
    transcript: string;
    userId?: string;
    callId?: string;
  },
): Promise<ScorecardVerifyResult> {
  const qipCandidates = opts.scorecard ? collectQipCandidates(opts.scorecard.lines) : [];
  const qcCandidates = opts.qualityCoach ? collectQualityCoachCandidates(opts.qualityCoach) : [];
  const candidates: Candidate[] = [...qipCandidates, ...qcCandidates];

  if (!candidates.length) {
    return {
      scorecard: opts.scorecard ?? undefined,
      qualityCoach: opts.qualityCoach ?? undefined,
      verified: true,
      justifications: [],
    };
  }

  const provider = getPostCallProvider(env);
  const request = {
    maxTokens: 8000,
    system: systemPrompt(),
    user: userPrompt(
      candidates,
      opts.scorecard?.lines || [],
      opts.qualityCoach ?? undefined,
      opts.transcript,
      opts.profile,
    ),
    effort: env.POSTCALL_EFFORT || env.EFFORT || "medium",
    research: false,
    thinkingBudget: 0,
    temperature: 0,
    jsonSchema: verifySchema(candidates),
    step: "postcall-scorecard-verify",
    passName: "scorecard-verify",
    userId: opts.userId,
    callId: opts.callId,
  };

  let result;
  try {
    result = await provider.generate(request);
  } catch (err) {
    if (!isRemoteError(err)) throw err;
    await sleep(REMOTE_ERROR_RETRY_DELAY_MS);
    try {
      result = await provider.generate({ ...request, retryAttempt: 1 });
    } catch (retryErr) {
      if (!isRemoteError(retryErr)) throw retryErr;
      return {
        scorecard: opts.scorecard ? { ...opts.scorecard, verificationSkipped: true } : undefined,
        qualityCoach: opts.qualityCoach ?? undefined,
        verified: false,
        justifications: [],
      };
    }
  }

  const parsed = extractJson<{ verdicts?: Array<Record<string, unknown>> }>(result.text);
  const verdictByKey = new Map<string, Record<string, unknown>>();
  for (const v of parsed.verdicts || []) {
    const key =
      v.dimensionIndex != null
        ? `qc::${v.dimensionIndex}`
        : `qip::${v.themeKey}::${v.subParamIndex}`;
    verdictByKey.set(key, v);
  }

  let verified = true;
  const justifications: VerifierJustification[] = [];
  let updatedScorecard: ScorecardDraft | undefined = opts.scorecard ?? undefined;
  let updatedQualityCoach: QualityCoachDraft | undefined = opts.qualityCoach ?? undefined;

  if (opts.scorecard && opts.profile && qipCandidates.length) {
    const r = recomputeQip(opts.profile, opts.scorecard, verdictByKey, qipCandidates);
    justifications.push(...r.justifications);
    verified = verified && r.verified;
    updatedScorecard = {
      ...opts.scorecard,
      lines: r.lines,
      overall: r.scored.overall,
      includedCredits: r.scored.includedCredits,
      categoryScores: r.scored.categoryScores,
    };
  }

  if (opts.qualityCoach && qcCandidates.length) {
    const r = recomputeQualityCoach(opts.qualityCoach, verdictByKey, qcCandidates);
    justifications.push(...r.justifications);
    verified = verified && r.verified;
    updatedQualityCoach = r.qualityCoach;
  }

  return { scorecard: updatedScorecard, qualityCoach: updatedQualityCoach, verified, justifications };
}
