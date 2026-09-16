/**
 * Scorecard golden-set pass (v2.5) — third LLM pass after first score + verifier.
 * Recalibrates QIP sub-parameters to how SE directors actually score, using a
 * growing golden set of human-scored calls. Applies to every call; the seed
 * examples are calibration, not a lookup. Quality-coach is left to the verifier.
 */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";
import { computeThemeGrade, scoreCall, type ScoreCallResult } from "../quality-score";
import type { CallType, QipProfile, SeMotion } from "../rubric-profiles";
import { formatTimestampedTranscript } from "../transcript";
import { trimWords } from "../word-limits";
import type { ScorecardDraft, ScorecardLineDraft } from "./scorecard";
import type { VerifierJustification } from "./scorecard-verify";
import { formatGoldenCalibrationPrompt, goldenPassEnabled } from "./golden-set";
import { applyDiscoveryIncidentApplicability } from "./discovery-incident-applicability";

export type Env = ProviderEnv & { SCORECARD_GOLDEN_PASS?: string };

export type GoldenJustification = VerifierJustification;

export interface ScorecardCalibrateResult {
  scorecard?: ScorecardDraft;
  /** True when every QIP candidate received a verdict (or nothing was scorable). */
  calibrated: boolean;
  justifications: GoldenJustification[];
}

interface QipCandidate {
  id: string;
  kind: "qip";
  themeKey: string;
  subParamIndex: number;
  currentScore: 0 | 1 | 2;
}

const CALIBRATE_TRANSCRIPT_MAX_WORDS = 5500;
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

function calibrateSchema(candidates: QipCandidate[]): Record<string, unknown> {
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
          required: ["themeKey", "subParamIndex", "confirmed", "newScore", "reason"],
          properties: {
            themeKey: themeKeyEnum.length
              ? { type: "string", enum: themeKeyEnum }
              : { type: "string" },
            subParamIndex: { type: "integer", minimum: 0, maximum: 4 },
            confirmed: { type: "boolean" },
            newScore: { type: "integer", minimum: 0, maximum: 2 },
            reason: { type: "string" },
          },
        },
      },
    },
  };
}

function systemPrompt(seMotion?: SeMotion | string | null, callType?: CallType | string | null): string {
  return `You are an SE director doing a third scoring pass on a QIP scorecard. Pass 1 scored
the transcript. Pass 2 (verifier) re-checked evidence. Your job is to recalibrate to how
humans on this team actually score — not to rubber-stamp, and not to copy the golden-set
numbers onto this call.

Each item is a QIP sub-parameter currently scored 0, 1, or 2. Echo themeKey + subParamIndex.
Assign newScore 0 (absent / not done), 1 (adequate / typical), or 2 (excellent).

How humans score (mandatory):
- Polarize. A theme that did not happen is five 0s, not five 1s.
- A theme done well is mostly 2s (grade 8–10), not five 1s (grade 5).
- 2 still requires clear, verbatim, timestamped evidence it was done well.
- Never fabricate. Match THIS transcript.

${formatGoldenCalibrationPrompt({ seMotion, callType })}

RULES:
1. Return exactly one verdict per listed item.
2. Set confirmed true when you keep the current score, false when you change it.
3. Respond with JSON only: { verdicts: [...] }.`;
}

function subParamLabel(profile: QipProfile | undefined, themeKey: string, index: number): string {
  const theme = profile?.themes.find((t) => t.key === themeKey);
  const label = theme?.subParameters[index];
  return label?.trim() || `sub-parameter ${index + 1}`;
}

function userPrompt(
  candidates: QipCandidate[],
  lines: ScorecardLineDraft[],
  transcript: string,
  profile?: QipProfile | null,
): string {
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
        .join("\n") || "  (no evidence recorded)";
    const label = subParamLabel(profile ?? undefined, c.themeKey, c.subParamIndex);
    return `${c.id} — ${c.themeKey} SP${c.subParamIndex + 1} "${label}", currently scored ${c.currentScore}/2. Cited evidence:\n${evidenceText}`;
  });

  return [
    "Recalibrate every item below to the human golden-set bar. Raise, lower, or keep.",
    "",
    ...blocks,
    "",
    "=== TIMESTAMPED TRANSCRIPT ===",
    formatTimestampedTranscript(transcript, CALIBRATE_TRANSCRIPT_MAX_WORDS),
    "=== END TRANSCRIPT ===",
  ].join("\n");
}

function coerceQipNewScore(raw: unknown): 0 | 1 | 2 | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.round(raw);
  return n === 0 || n === 1 || n === 2 ? (n as 0 | 1 | 2) : null;
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

function recomputeQip(
  profile: QipProfile,
  scorecard: ScorecardDraft,
  verdictByKey: Map<string, Record<string, unknown>>,
  candidates: QipCandidate[],
): { lines: ScorecardLineDraft[]; justifications: GoldenJustification[]; calibrated: boolean; scored: ScoreCallResult } {
  const candidateKeys = new Set(candidates.map((c) => c.id));
  const justifications: GoldenJustification[] = [];
  let calibrated = true;

  const updatedLines = scorecard.lines.map((line) => {
    const subParameters = line.subParameters.map((sp, i) => {
      const key = `qip::${line.themeKey}::${i}`;
      if (!candidateKeys.has(key)) return sp;
      const verdict = verdictByKey.get(key);
      const resolved = resolveQipScore(sp.score, verdict);
      if (resolved.missing) {
        calibrated = false;
        justifications.push({
          kind: "qip",
          themeKey: line.themeKey,
          subParamIndex: i,
          confirmed: false,
          newScore: sp.score,
          justification: "Golden-set pass returned no verdict for this sub-parameter — prior score kept.",
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

  return { lines: recomputedLines, justifications, calibrated, scored };
}

/**
 * generate.ts calls this on every call after the verifier, when SCORECARD_GOLDEN_PASS
 * is on (default). Skips the LLM when nothing is scorable or the scorecard is already
 * golden-calibrated. Fail-soft is the caller's job — this throws on provider errors.
 */
export async function calibrateScorecardToGoldenSet(
  env: Env,
  opts: {
    profile?: QipProfile | null;
    scorecard?: ScorecardDraft | null;
    transcript: string;
    seMotion?: SeMotion | string | null;
    callType?: CallType | string | null;
    userId?: string;
    callId?: string;
  },
): Promise<ScorecardCalibrateResult> {
  if (!goldenPassEnabled(env)) {
    return {
      scorecard: opts.scorecard ?? undefined,
      calibrated: false,
      justifications: [],
    };
  }

  if (opts.scorecard?.goldenCalibrated) {
    return {
      scorecard: opts.scorecard,
      calibrated: true,
      justifications: opts.scorecard.goldenJustifications || [],
    };
  }

  const candidates = opts.scorecard ? collectQipCandidates(opts.scorecard.lines) : [];
  if (!opts.scorecard || !opts.profile || !candidates.length) {
    return {
      scorecard: opts.scorecard ?? undefined,
      calibrated: true,
      justifications: [],
    };
  }

  const provider = getPostCallProvider(env);
  const request = {
    maxTokens: 8000,
    system: systemPrompt(opts.seMotion ?? opts.scorecard.seMotion, opts.callType ?? opts.scorecard.callType),
    user: userPrompt(candidates, opts.scorecard.lines, opts.transcript, opts.profile),
    effort: env.POSTCALL_EFFORT || env.EFFORT || "medium",
    research: false,
    thinkingBudget: 0,
    temperature: 0,
    jsonSchema: calibrateSchema(candidates),
    step: "postcall-scorecard-calibrate",
    passName: "scorecard-calibrate",
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
        scorecard: { ...opts.scorecard, verificationSkipped: true },
        calibrated: false,
        justifications: [],
      };
    }
  }

  const parsed = extractJson<{ verdicts?: Array<Record<string, unknown>> }>(result.text);
  const verdictByKey = new Map<string, Record<string, unknown>>();
  for (const v of parsed.verdicts || []) {
    verdictByKey.set(`qip::${v.themeKey}::${v.subParamIndex}`, v);
  }

  const r = recomputeQip(opts.profile, opts.scorecard, verdictByKey, candidates);
  return {
    scorecard: {
      ...opts.scorecard,
      lines: r.lines,
      overall: r.scored.overall,
      includedCredits: r.scored.includedCredits,
      categoryScores: r.scored.categoryScores,
    },
    calibrated: r.calibrated,
    justifications: r.justifications,
  };
}
