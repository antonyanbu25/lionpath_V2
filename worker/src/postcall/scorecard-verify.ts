/**
 * Adversarial verifier (v2.2, extended v2.3) — a second LLM pass that role-plays a skeptical
 * SE director, re-examining every top-scored item (QIP sub-parameters scored 2, qualityCoach
 * dimensions scored 5) against the transcript and either confirming it or downgrading it — in
 * a single LLM call covering both scores, never two separate calls for the same call.
 * generate.ts calls this on every call (not gated on the leadership-shareable bar) so a
 * falsely-inflated top score gets challenged regardless of the call's overall — this file's
 * own vacuous fast-path (see collectQipCandidates / collectQualityCoachCandidates) is what
 * keeps that cheap: no LLM call happens when there's nothing scored top-marks to audit. The
 * deterministic recompute afterwards reuses the exact same scoreCall / computeOverallScore
 * paths as the rest of scoring (worker/src/quality-score.ts) — this file never hand-rolls a
 * second scoring implementation.
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

export type Env = ProviderEnv;

export { LEADERSHIP_CAP_THRESHOLD };

export type QualityCoachDraft = PostCallAnalysis["qualityCoach"];

export interface VerifierJustification {
  /** "qip" candidates carry themeKey/subParamIndex; "qualityCoach" candidates carry dimensionIndex. */
  kind: "qip" | "qualityCoach";
  themeKey?: string;
  subParamIndex?: number;
  dimensionIndex?: number;
  confirmed: boolean;
  /** Score after the verifier's verdict — unchanged when confirmed. */
  newScore: number;
  /** One-line reason — confirmation evidence, or why it did not hold up. */
  justification: string;
}

export interface ScorecardVerifyResult {
  /** Scorecard with any verifier downgrades applied and grades/overall/categoryScores recomputed. Unset when no scorecard was passed in. */
  scorecard?: ScorecardDraft;
  /** qualityCoach with any verifier downgrades applied and overallScore/overallLabel recomputed. Unset when no qualityCoach was passed in. */
  qualityCoach?: QualityCoachDraft;
  /** True only when every candidate (QIP score-2, qualityCoach score-5) was confirmed — no downgrades. */
  verified: boolean;
  justifications: VerifierJustification[];
}

interface QipCandidate {
  id: string;
  kind: "qip";
  themeKey: string;
  subParamIndex: number;
}

interface QualityCoachCandidate {
  id: string;
  kind: "qualityCoach";
  dimensionIndex: number;
  dimensionName: string;
}

type Candidate = QipCandidate | QualityCoachCandidate;

function collectQipCandidates(lines: ScorecardLineDraft[]): QipCandidate[] {
  const out: QipCandidate[] = [];
  for (const line of lines) {
    line.subParameters.forEach((sp, i) => {
      if (sp.score === 2) {
        out.push({ id: `qip::${line.themeKey}::${i}`, kind: "qip", themeKey: line.themeKey, subParamIndex: i });
      }
    });
  }
  return out;
}

function collectQualityCoachCandidates(qc: QualityCoachDraft | undefined): QualityCoachCandidate[] {
  if (!qc?.dimensions?.length) return [];
  const out: QualityCoachCandidate[] = [];
  qc.dimensions.forEach((d, i) => {
    if (d.score === 5) {
      out.push({ id: `qc::${i}`, kind: "qualityCoach", dimensionIndex: i, dimensionName: d.name });
    }
  });
  return out;
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
          required: ["confirmed", "reason"],
          properties: {
            // For a "qip::" item: set themeKey + subParamIndex, leave dimensionIndex null.
            // For a "qc::" item: set dimensionIndex, leave themeKey/subParamIndex null.
            themeKey: themeKeyEnum.length ? { type: "string", enum: themeKeyEnum, nullable: true } : { type: "string", nullable: true },
            subParamIndex: { type: "integer", minimum: 0, maximum: 4, nullable: true },
            dimensionIndex: { type: "integer", minimum: 0, maximum: 10, nullable: true },
            confirmed: { type: "boolean" },
            newScore: { type: "integer", nullable: true },
            reason: { type: "string" },
          },
        },
      },
    },
  };
}

function systemPrompt(): string {
  return `You are a skeptical SE director auditing a post-call scorecard that provisionally scored above
${LEADERSHIP_CAP_THRESHOLD}/10 — high enough to be shared with leadership as-is. Your only job is to
stress-test every top-scored item listed below and decide whether it truly earns that score.

Two kinds of items may appear, identified by their label prefix:
- "qip::<theme>::<index>" — a QIP sub-parameter currently scored 2 (excellent) out of 0/1/2. Echo
  back its theme key as "themeKey" and its index as "subParamIndex"; leave "dimensionIndex" null.
- "qc::<index>" — a quality-coach dimension currently scored 5 (excellent) out of 1-5. Echo back
  its index as "dimensionIndex"; leave "themeKey" and "subParamIndex" null.

For EACH item listed, re-examine its cited evidence against the full transcript and either:
- CONFIRM it (confirmed: true, reason: one-line justification citing the specific evidence that
  earns the top score), or
- DOWNGRADE it (confirmed: false, newScore: for "qip::" items use 0 or 1; for "qc::" items use an
  integer 1-4; reason: one-line explanation of why it does not hold up to scrutiny).

RULES (mandatory):
1. Never fabricate or soften — only confirm the top score when the transcript itself contains
   clear, verbatim, timestamped evidence of excellent execution.
2. Be skeptical by default: shallow discovery, a generic/rehearsed-sounding demo, or the SE
   dominating talk-time over the customer are all grounds for downgrading, even when the
   original evidence quote looks plausible on its own.
3. Thin or generic evidence does not earn the top score — downgrade it.
4. Return exactly one verdict for every item listed — no omissions, no extras, matched by
   themeKey+subParamIndex or dimensionIndex as described above.
5. Respond with JSON only: { verdicts: [...] }.`;
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

/**
 * Build the transcript excerpt handed to the verifier, windowed around the cited evidence
 * timestamps rather than a flat last-N-words tail. A flat tail biases the verifier toward
 * downgrading early/mid-call sub-parameters for "missing context" on any call long enough to
 * push their evidence outside the window, when the real issue may be nothing more than call
 * length. Falls back to the flat tail when there's nothing to window around (qualityCoach-only
 * verification, whose evidence carries no timestamp, or a transcript with no parseable cues).
 */
function buildVerifierTranscript(transcript: string, evidenceTimestamps: number[]): string {
  if (!evidenceTimestamps.length) {
    return formatTimestampedTranscript(transcript, VERIFIER_TRANSCRIPT_MAX_WORDS);
  }
  const cues = parseTranscriptCues(transcript);
  if (!cues.length) {
    return formatTimestampedTranscript(transcript, VERIFIER_TRANSCRIPT_MAX_WORDS);
  }

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
  let wordBudget = VERIFIER_TRANSCRIPT_MAX_WORDS;
  for (let i = 0; i < merged.length && wordBudget > 0; i++) {
    const [start, end] = merged[i];
    const windowCues = cues.filter((c) => c.startS >= start && c.startS <= end);
    if (!windowCues.length) continue;
    if (out.length) out.push("[... omitted — outside any cited evidence window ...]");
    for (const cue of windowCues) {
      const text = cue.speaker ? `${cue.speaker}: ${cue.text}` : cue.text;
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      if (wordCount > wordBudget) break;
      wordBudget -= wordCount;
      out.push(`[${formatVerifierClock(cue.startS)}] ${text}`);
    }
  }

  return out.length ? out.join("\n") : formatTimestampedTranscript(transcript, VERIFIER_TRANSCRIPT_MAX_WORDS);
}

function userPrompt(
  candidates: Candidate[],
  lines: ScorecardLineDraft[],
  qc: QualityCoachDraft | undefined,
  transcript: string,
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
          .join("\n") || "  (no evidence recorded — this alone is grounds to downgrade)";
      return `${c.id} — ${c.themeKey} SP${c.subParamIndex + 1}, scored 2. Cited evidence:\n${evidenceText}`;
    }
    const dim = qc?.dimensions?.[c.dimensionIndex];
    const evidenceText = dim?.evidence?.trim()
      ? `  - "${dim.evidence.trim()}"`
      : "  (no evidence recorded — this alone is grounds to downgrade)";
    return `${c.id} — quality-coach dimension "${c.dimensionName}", scored 5. Cited evidence:\n${evidenceText}`;
  });

  return [
    "Audit these provisional top-scored items against the transcript below.",
    "",
    ...blocks,
    "",
    "=== TIMESTAMPED TRANSCRIPT ===",
    buildVerifierTranscript(transcript, collectEvidenceTimestamps(candidates, lines)),
    "=== END TRANSCRIPT ===",
  ].join("\n");
}

/** Explicit finite 0 means 0; anything else (including explicit null) is the conservative default. */
function coerceQipNewScore(raw: unknown): 0 | 1 {
  return typeof raw === "number" && Number.isFinite(raw) && raw === 0 ? 0 : 1;
}

/** Model may suggest 1-4; anything else (including explicit null) is the conservative default of 4. */
function coerceQualityCoachNewScore(raw: unknown): 1 | 2 | 3 | 4 {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : NaN;
  return (n >= 1 && n <= 4 ? n : 4) as 1 | 2 | 3 | 4;
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
      if (!verdict) {
        verified = false;
        justifications.push({
          kind: "qip",
          themeKey: line.themeKey,
          subParamIndex: i,
          confirmed: false,
          newScore: 1,
          justification: "Verifier returned no verdict for this sub-parameter — downgraded conservatively.",
        });
        return { ...sp, score: 1 as const };
      }
      const confirmed = verdict.confirmed === true;
      const reason = trimWords(String(verdict.reason ?? ""), 30);
      if (confirmed) {
        justifications.push({
          kind: "qip",
          themeKey: line.themeKey,
          subParamIndex: i,
          confirmed: true,
          newScore: 2,
          justification: reason,
        });
        return sp;
      }
      verified = false;
      const newScore = coerceQipNewScore(verdict.newScore);
      justifications.push({
        kind: "qip",
        themeKey: line.themeKey,
        subParamIndex: i,
        confirmed: false,
        newScore,
        justification: reason,
      });
      return { ...sp, score: newScore };
    });
    const grade = line.evidenceUnavailable ? 0 : computeThemeGrade(subParameters);
    return { ...line, subParameters, grade };
  });

  const scored = scoreCall(
    profile,
    updatedLines.map((l) => ({
      themeKey: l.themeKey,
      subParameters: l.subParameters.map((sp) => ({ score: sp.score })),
      evidenceUnavailable: l.evidenceUnavailable || !!l.modelOmitted,
      modelOmitted: !!l.modelOmitted,
    })),
  );

  const recomputedLines = updatedLines.map((line) => {
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
    if (!verdict) {
      verified = false;
      justifications.push({
        kind: "qualityCoach",
        dimensionIndex: i,
        confirmed: false,
        newScore: 4,
        justification: "Verifier returned no verdict for this dimension — downgraded conservatively.",
      });
      return { ...dim, score: 4 };
    }
    const confirmed = verdict.confirmed === true;
    const reason = trimWords(String(verdict.reason ?? ""), 30);
    if (confirmed) {
      justifications.push({ kind: "qualityCoach", dimensionIndex: i, confirmed: true, newScore: 5, justification: reason });
      return dim;
    }
    verified = false;
    const newScore = coerceQualityCoachNewScore(verdict.newScore);
    justifications.push({ kind: "qualityCoach", dimensionIndex: i, confirmed: false, newScore, justification: reason });
    return { ...dim, score: newScore };
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
 * whichever of `scorecard` / `qualityCoach` is present regardless of their overall; this
 * function's own candidate collection (score-2 sub-parameters / score-5 dimensions) is what
 * decides whether there's anything to audit, and skips the LLM call entirely when there
 * isn't. Both may be passed together so a single LLM call audits both scores at once.
 * Returns the same shapes back with verifier downgrades folded in, plus one `verified` flag
 * covering everything that was audited (true — including vacuously, when nothing scored top
 * marks — only if every candidate across both scores was confirmed).
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
    // Nothing scored at the top to challenge — vacuously verified.
    return {
      scorecard: opts.scorecard ?? undefined,
      qualityCoach: opts.qualityCoach ?? undefined,
      verified: true,
      justifications: [],
    };
  }

  const provider = getPostCallProvider(env);
  const result = await provider.generate({
    maxTokens: 4000,
    system: systemPrompt(),
    user: userPrompt(candidates, opts.scorecard?.lines || [], opts.qualityCoach ?? undefined, opts.transcript),
    effort: env.POSTCALL_EFFORT || env.EFFORT || "medium",
    research: false,
    thinkingBudget: 0,
    temperature: 0,
    jsonSchema: verifySchema(candidates),
    step: "postcall-scorecard-verify",
    passName: "scorecard-verify",
    userId: opts.userId,
    callId: opts.callId,
  });

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
