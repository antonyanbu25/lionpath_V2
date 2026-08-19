/**
 * Adversarial verifier (v2.2) — a second LLM pass, gated on the provisional scorecard's
 * overall being above the leadership-shareable bar. Role-plays a skeptical SE director who
 * re-examines every sub-parameter currently scored 2 against the transcript and either
 * confirms it or downgrades it. The deterministic recompute afterwards reuses the exact same
 * scoreCall path as the rest of QIP scoring (worker/src/quality-score.ts) — this file never
 * hand-rolls a second scoring implementation.
 */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";
import {
  computeThemeGrade,
  scoreCall,
  LEADERSHIP_CAP_THRESHOLD,
  type ScoreCallResult,
} from "../quality-score";
import type { QipProfile } from "../rubric-profiles";
import { formatTimestampedTranscript } from "../transcript";
import { trimWords } from "../word-limits";
import type { ScorecardDraft, ScorecardLineDraft } from "./scorecard";

export type Env = ProviderEnv;

export { LEADERSHIP_CAP_THRESHOLD };

export interface VerifierJustification {
  themeKey: string;
  subParamIndex: number;
  confirmed: boolean;
  /** Score after the verifier's verdict — unchanged (2) when confirmed. */
  newScore: 0 | 1 | 2;
  /** One-line reason — confirmation evidence, or why it did not hold up. */
  justification: string;
}

export interface ScorecardVerifyResult {
  /** Scorecard with any verifier downgrades applied and grades/overall/categoryScores recomputed. */
  scorecard: ScorecardDraft;
  /** True only when every candidate sub-parameter (score === 2) was confirmed — no downgrades. */
  verified: boolean;
  justifications: VerifierJustification[];
}

interface Candidate {
  themeKey: string;
  subParamIndex: number;
}

function collectScoreTwoCandidates(lines: ScorecardLineDraft[]): Candidate[] {
  const out: Candidate[] = [];
  for (const line of lines) {
    line.subParameters.forEach((sp, i) => {
      if (sp.score === 2) out.push({ themeKey: line.themeKey, subParamIndex: i });
    });
  }
  return out;
}

function verifySchema(candidates: Candidate[]): Record<string, unknown> {
  const themeKeyEnum = [...new Set(candidates.map((c) => c.themeKey))];
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
          required: ["themeKey", "subParamIndex", "confirmed", "reason"],
          properties: {
            themeKey: { type: "string", enum: themeKeyEnum },
            subParamIndex: { type: "integer", minimum: 0, maximum: 4 },
            confirmed: { type: "boolean" },
            newScore: { type: "integer", enum: [0, 1], nullable: true },
            reason: { type: "string" },
          },
        },
      },
    },
  };
}

function systemPrompt(): string {
  return `You are a skeptical SE director auditing a QIP scorecard that provisionally scored above
${LEADERSHIP_CAP_THRESHOLD}/10 — high enough to be shared with leadership as-is. Your only job is to
stress-test every sub-parameter currently scored 2 (excellent) below and decide whether it truly
earns that score.

For EACH sub-parameter listed, re-examine its cited evidence against the full transcript and either:
- CONFIRM it (confirmed: true, reason: one-line justification citing the specific evidence that
  earns the 2), or
- DOWNGRADE it (confirmed: false, newScore 0 or 1, reason: one-line explanation of why it does not
  hold up to scrutiny).

RULES (mandatory):
1. Never fabricate or soften — only confirm a 2 when the transcript itself contains clear,
   verbatim, timestamped evidence of excellent execution.
2. Be skeptical by default: shallow discovery, a generic/rehearsed-sounding demo, or the SE
   dominating talk-time over the customer are all grounds for downgrading, even when the
   original evidence quote looks plausible on its own.
3. Thin or generic evidence does not earn a 2 — downgrade it.
4. Return exactly one verdict for every sub-parameter listed — no omissions, no extras.
5. Respond with JSON only: { verdicts: [...] }.`;
}

function userPrompt(candidates: Candidate[], lines: ScorecardLineDraft[], transcript: string): string {
  const lineByKey = new Map(lines.map((l) => [l.themeKey, l]));
  const blocks = candidates.map((c) => {
    const line = lineByKey.get(c.themeKey);
    const sp = line?.subParameters[c.subParamIndex];
    const evidenceText =
      (sp?.evidence || [])
        .map(
          (e) =>
            `  - ${e.source || "transcript"}${e.atS != null ? ` @${Math.round(e.atS)}s` : ""}: "${e.quote}"`,
        )
        .join("\n") || "  (no evidence recorded — this alone is grounds to downgrade)";
    return `${c.themeKey} SP${c.subParamIndex + 1} — scored 2. Cited evidence:\n${evidenceText}`;
  });

  return [
    "Audit these provisional score-2 sub-parameters against the transcript below.",
    "",
    ...blocks,
    "",
    "=== TIMESTAMPED TRANSCRIPT ===",
    formatTimestampedTranscript(transcript, 5500),
    "=== END TRANSCRIPT ===",
  ].join("\n");
}

/**
 * Deterministically recompute the scorecard from the verifier's verdicts by reusing
 * quality-score.ts's scoreCall — this never hand-rolls a second scoring implementation.
 */
function recomputeScorecard(
  profile: QipProfile,
  scorecard: ScorecardDraft,
  verdictByKey: Map<string, Record<string, unknown>>,
  candidates: Candidate[],
): {
  lines: ScorecardLineDraft[];
  justifications: VerifierJustification[];
  verified: boolean;
  scored: ScoreCallResult;
} {
  const candidateKeys = new Set(candidates.map((c) => `${c.themeKey}::${c.subParamIndex}`));
  const justifications: VerifierJustification[] = [];
  let verified = true;

  const updatedLines = scorecard.lines.map((line) => {
    const subParameters = line.subParameters.map((sp, i) => {
      const key = `${line.themeKey}::${i}`;
      if (!candidateKeys.has(key)) return sp;
      const verdict = verdictByKey.get(key);
      if (!verdict) {
        // Model omitted a verdict for a candidate we asked about — fail safe, downgrade.
        verified = false;
        justifications.push({
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
          themeKey: line.themeKey,
          subParamIndex: i,
          confirmed: true,
          newScore: 2,
          justification: reason,
        });
        return sp;
      }
      verified = false;
      const rawNew = Number(verdict.newScore);
      const newScore = (rawNew === 0 ? 0 : 1) as 0 | 1;
      justifications.push({
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

/**
 * Runs only when the caller has already determined the provisional overall exceeds
 * LEADERSHIP_CAP_THRESHOLD. Returns the scorecard with verifier downgrades folded in
 * (overall/categoryScores/grades recomputed via scoreCall) plus whether every score-2
 * sub-parameter was confirmed.
 */
export async function verifyScorecardForLeadershipCap(
  env: Env,
  opts: {
    profile: QipProfile;
    scorecard: ScorecardDraft;
    transcript: string;
    userId?: string;
    callId?: string;
  },
): Promise<ScorecardVerifyResult> {
  const candidates = collectScoreTwoCandidates(opts.scorecard.lines);
  if (!candidates.length) {
    // Nothing scored 2 to challenge — vacuously verified.
    return { scorecard: opts.scorecard, verified: true, justifications: [] };
  }

  const provider = getPostCallProvider(env);
  const result = await provider.generate({
    maxTokens: 4000,
    system: systemPrompt(),
    user: userPrompt(candidates, opts.scorecard.lines, opts.transcript),
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
    verdictByKey.set(`${v.themeKey}::${v.subParamIndex}`, v);
  }

  const { lines, justifications, verified, scored } = recomputeScorecard(
    opts.profile,
    opts.scorecard,
    verdictByKey,
    candidates,
  );

  const updatedScorecard: ScorecardDraft = {
    ...opts.scorecard,
    lines,
    overall: scored.overall,
    includedCredits: scored.includedCredits,
    categoryScores: scored.categoryScores,
  };

  return { scorecard: updatedScorecard, verified, justifications };
}
