/**
 * Pure calibration stats — no LLM, no I/O. Used by calibrate.mjs and unit tests.
 */

import { typeComposite, type CallType } from "../src/quality-score.ts";
import { RUBRIC_PROFILES, type RubricProfileSeed } from "../src/rubric-profiles.ts";
import { anchorsJsonForTheme, isThemeAnchored } from "../src/rubric-anchors.ts";

export interface ParsedHumanScore {
  score: number | null;
  applicable: boolean;
}

/** Parse a hand-scored cell — NA variants, 1–5 anchors, or 0–100. */
export function parseHumanScore(raw: unknown): ParsedHumanScore {
  if (raw == null) return { score: null, applicable: false };
  const text = String(raw).trim();
  if (!text) return { score: null, applicable: false };

  const lower = text.toLowerCase();
  if (
    ["na", "n/a", "n.a.", "-", "—", "none", "skip", "not applicable", "n.a"].includes(lower)
  ) {
    return { score: null, applicable: false };
  }

  const n = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(n)) return { score: null, applicable: false };

  // Integer 1–5 → anchor scale (QIP §4)
  if (Number.isInteger(n) && n >= 1 && n <= 5) {
    return { score: n * 20, applicable: true };
  }

  if (n >= 0 && n <= 100) {
    return { score: Math.round(n), applicable: true };
  }

  return { score: null, applicable: false };
}

export interface TrainingCall {
  callId: string;
  callType: CallType;
  transcript: string;
  /** themeKey → raw hand score (number, string, or null for NA) */
  humanScores: Record<string, unknown>;
  deckLink?: string | null;
  videoAvailable?: boolean;
  briefContext?: string | null;
  companyName?: string | null;
  meetingTitle?: string | null;
  /** Optional pre-computed model lines for --compare-only / fixtures */
  modelLines?: Array<{
    themeKey: string;
    score: number;
    applicable: boolean;
    evidence?: Array<{ quote?: string; atS?: number | null }>;
  }>;
  humanComposite?: number | null;
}

export interface ThemeComparison {
  callId: string;
  callType: CallType;
  themeKey: string;
  humanScore: number;
  modelScore: number;
  signedError: number;
  absError: number;
  anchored: boolean;
  evidenceQuote: string | null;
}

export interface ErrorStats {
  meanSigned: number;
  meanAbs: number;
  stddevSigned: number;
  n: number;
}

export function profileFor(callType: CallType): RubricProfileSeed {
  const profile = RUBRIC_PROFILES.find((p) => p.callType === callType);
  if (!profile) {
    throw new Error(`Unknown call type: ${callType}`);
  }
  return profile;
}

export function isThemeAnchoredForProfile(themeKey: string, callType: CallType): boolean {
  return isThemeAnchored(anchorsJsonForTheme(themeKey, callType));
}

export function buildThemeComparisons(
  call: TrainingCall,
  modelLines: Array<{
    themeKey: string;
    score: number;
    applicable: boolean;
    evidence?: Array<{ quote?: string; atS?: number | null }>;
  }>,
): ThemeComparison[] {
  const profile = profileFor(call.callType);
  const modelByKey = new Map(modelLines.map((l) => [l.themeKey, l]));
  const out: ThemeComparison[] = [];

  for (const theme of profile.themes) {
    const human = parseHumanScore(call.humanScores[theme.themeKey]);
    if (!human.applicable || human.score == null) continue;

    const model = modelByKey.get(theme.themeKey);
    if (!model || !model.applicable) continue;

    const signedError = model.score - human.score;
    const quote = model.evidence?.[0]?.quote?.trim() || null;

    out.push({
      callId: call.callId,
      callType: call.callType,
      themeKey: theme.themeKey,
      humanScore: human.score,
      modelScore: model.score,
      signedError,
      absError: Math.abs(signedError),
      anchored: isThemeAnchoredForProfile(theme.themeKey, call.callType),
      evidenceQuote: quote,
    });
  }

  return out;
}

export function computeErrorStats(comparisons: ThemeComparison[]): ErrorStats {
  if (!comparisons.length) {
    return { meanSigned: 0, meanAbs: 0, stddevSigned: 0, n: 0 };
  }
  const signed = comparisons.map((c) => c.signedError);
  const n = signed.length;
  const meanSigned = signed.reduce((a, b) => a + b, 0) / n;
  const meanAbs = comparisons.reduce((a, c) => a + c.absError, 0) / n;
  const variance =
    n > 1
      ? signed.reduce((a, b) => a + (b - meanSigned) ** 2, 0) / (n - 1)
      : 0;
  return {
    meanSigned: round1(meanSigned),
    meanAbs: round1(meanAbs),
    stddevSigned: round1(Math.sqrt(variance)),
    n,
  };
}

export function humanTypeComposite(call: TrainingCall): number | null {
  const profile = profileFor(call.callType);
  const lines = profile.themes.map((t) => {
    const human = parseHumanScore(call.humanScores[t.themeKey]);
    return {
      themeKey: t.themeKey,
      score: human.score ?? 0,
      maxScore: 100,
      applicable: human.applicable && human.score != null,
      weight: t.weight,
    };
  });
  const result = typeComposite(
    [{ callType: call.callType, rubricVersion: profile.version, lines }],
    call.callType,
    { includeIneligible: true },
  );
  return result.score;
}

export function modelTypeComposite(
  callType: CallType,
  modelLines: Array<{
    themeKey: string;
    score: number;
    applicable: boolean;
    weight?: number;
  }>,
): number | null {
  const profile = profileFor(callType);
  const weightByKey = new Map(profile.themes.map((t) => [t.themeKey, t.weight]));
  const lines = modelLines.map((l) => ({
    themeKey: l.themeKey,
    score: l.score,
    maxScore: 100,
    applicable: l.applicable,
    weight: l.weight ?? weightByKey.get(l.themeKey) ?? 0,
  }));
  const result = typeComposite(
    [{ callType, rubricVersion: profile.version, lines }],
    callType,
    { includeIneligible: true },
  );
  return result.score;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const list = map.get(k) || [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

export interface ProfileAggregate {
  callType: CallType;
  themeStats: Map<string, ErrorStats>;
  compositeStats: ErrorStats;
}

export function aggregateByProfile(comparisons: ThemeComparison[]): Map<CallType, ProfileAggregate> {
  const byProfile = groupBy(comparisons, (c) => c.callType);
  const out = new Map<CallType, ProfileAggregate>();

  for (const [callType, rows] of byProfile) {
    const byTheme = groupBy(rows, (c) => c.themeKey);
    const themeStats = new Map<string, ErrorStats>();
    for (const [themeKey, themeRows] of byTheme) {
      themeStats.set(themeKey, computeErrorStats(themeRows));
    }
    out.set(callType as CallType, {
      callType: callType as CallType,
      themeStats,
      compositeStats: { meanSigned: 0, meanAbs: 0, stddevSigned: 0, n: 0 },
    });
  }
  return out;
}

export function signedErrorInterpretation(meanSigned: number): string {
  if (meanSigned > 2) return "generous (scores higher than humans)";
  if (meanSigned < -2) return "harsh (scores lower than humans)";
  return "near neutral";
}

export function formatStatsRow(label: string, stats: ErrorStats): string {
  if (stats.n === 0) return `| ${label} | — | — | — | 0 |`;
  return `| ${label} | ${stats.meanSigned} (${signedErrorInterpretation(stats.meanSigned)}) | ${stats.meanAbs} | ${stats.stddevSigned} | ${stats.n} |`;
}
