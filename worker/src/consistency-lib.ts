/**
 * Pure self-consistency stats — no LLM, no I/O.
 * Used by self-consistency.mjs and unit tests.
 */

import { typeComposite } from "./quality-score";
import type { CallType } from "./rubric-profiles";

export interface EvidenceSnapshot {
  atS: number | null;
  quote: string;
}

export interface LineSnapshot {
  themeKey: string;
  score: number;
  applicable: boolean;
  weight: number;
  evidence: EvidenceSnapshot[];
}

export interface RunSnapshot {
  callId: string;
  callType: CallType;
  runIndex: number;
  lines: LineSnapshot[];
  compositeScore: number | null;
  applicableWeight: number;
}

export interface CallThemeRunMetrics {
  callId: string;
  callType: CallType;
  themeKey: string;
  scores: number[];
  applicable: boolean[];
  scoreSd: number;
  scoreRange: number;
  applicabilityFlipRate: number;
  evidenceStability: number | null;
}

export interface CallRunMetrics {
  callId: string;
  callType: CallType;
  compositeScores: number[];
  applicableWeights: number[];
  compositeSd: number;
  denominatorFlipRate: number;
  nSuccessfulRuns: number;
}

export interface ThemeAggregateMetrics {
  themeKey: string;
  callTypes: CallType[];
  nObservations: number;
  /** Total successful run snapshots contributing to this theme. */
  nSuccessfulRuns: number;
  meanScoreSd: number;
  maxScoreSd: number;
  meanRange: number;
  applicabilityFlipRate: number;
  meanEvidenceStability: number | null;
  /** Higher = less stable — used for anchor-priority ranking. */
  instabilityScore: number;
}

export const THRESHOLDS = {
  themeScoreSd: { acceptable: 8, needsAnchor: 15 },
  applicabilityFlipRate: 0.1,
  compositeSd: 5,
} as const;

/** Minimum distinct transcripts with ≥1 successful run before the harness exits 0. */
export const MIN_TRANSCRIPTS_FOR_REPORT = 3;

/** Minimum successful scoring runs before a theme or composite threshold verdict. */
export const MIN_RUNS_FOR_VERDICT = 3;

export function stddev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function normalizeQuote(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Primary evidence signature for stability comparison across runs. */
export function primaryEvidenceSignature(line: LineSnapshot): string {
  const ev = line.evidence?.[0];
  if (!ev?.quote?.trim()) return "none";
  const bucket = ev.atS != null && Number.isFinite(ev.atS) ? Math.round(ev.atS / 30) : "na";
  return `${bucket}:${normalizeQuote(ev.quote).slice(0, 60)}`;
}

/** Fraction of values that differ from the mode (for weights or booleans). */
export function modeDisagreementRate(values: number[] | boolean[]): number {
  if (values.length <= 1) return 0;
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = String(v);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let modeKey = "";
  let modeCount = 0;
  for (const [k, c] of counts) {
    if (c > modeCount) {
      modeKey = k;
      modeCount = c;
    }
  }
  const disagreements = values.filter((v) => String(v) !== modeKey).length;
  return disagreements / values.length;
}

/** Fraction of runs whose applicable flag differs from the mode. */
export function applicabilityFlipRate(flags: boolean[]): number {
  return modeDisagreementRate(flags);
}

/** Share of runs sharing the most common primary-evidence signature (applicable runs only). */
export function evidenceStabilityForRuns(lines: LineSnapshot[]): number | null {
  const applicable = lines.filter((l) => l.applicable);
  if (applicable.length <= 1) return applicable.length === 1 ? 1 : null;
  const sigs = applicable.map(primaryEvidenceSignature);
  const counts = new Map<string, number>();
  for (const s of sigs) counts.set(s, (counts.get(s) || 0) + 1);
  const max = Math.max(...counts.values());
  return max / applicable.length;
}

export function analyzeCallThemeRuns(
  runs: RunSnapshot[],
  callId: string,
  themeKey: string,
): CallThemeRunMetrics | null {
  const callRuns = runs.filter((r) => r.callId === callId);
  if (!callRuns.length) return null;

  const lines: LineSnapshot[] = [];
  for (const run of callRuns) {
    const line = run.lines.find((l) => l.themeKey === themeKey);
    if (line) lines.push(line);
  }
  if (!lines.length) return null;

  const scores = lines.map((l) => l.score);
  const applicable = lines.map((l) => l.applicable);

  return {
    callId,
    callType: callRuns[0].callType,
    themeKey,
    scores,
    applicable,
    scoreSd: round1(stddev(scores)),
    scoreRange: round1(Math.max(...scores) - Math.min(...scores)),
    applicabilityFlipRate: round1(applicabilityFlipRate(applicable)),
    evidenceStability:
      evidenceStabilityForRuns(lines) == null
        ? null
        : round1(evidenceStabilityForRuns(lines)!),
  };
}

export function analyzeCallRuns(runs: RunSnapshot[], callId: string): CallRunMetrics | null {
  const callRuns = runs.filter((r) => r.callId === callId);
  if (!callRuns.length) return null;

  const compositeScores = callRuns.map((r) => r.compositeScore ?? 0);
  const applicableWeights = callRuns.map((r) => r.applicableWeight);

  return {
    callId,
    callType: callRuns[0].callType,
    compositeScores,
    applicableWeights,
    compositeSd: round1(stddev(compositeScores)),
    denominatorFlipRate: round1(modeDisagreementRate(applicableWeights)),
    nSuccessfulRuns: callRuns.length,
  };
}

export function aggregateThemeMetrics(
  runs: RunSnapshot[],
  callIds: string[],
): ThemeAggregateMetrics[] {
  const themeKeys = new Set<string>();
  for (const run of runs) {
    for (const line of run.lines) themeKeys.add(line.themeKey);
  }

  const aggregates: ThemeAggregateMetrics[] = [];

  for (const themeKey of themeKeys) {
    const perCall: CallThemeRunMetrics[] = [];
    let nSuccessfulRuns = 0;
    for (const callId of callIds) {
      const m = analyzeCallThemeRuns(runs, callId, themeKey);
      if (m) {
        perCall.push(m);
        nSuccessfulRuns += m.scores.length;
      }
    }
    if (!perCall.length) continue;

    const callTypes = [...new Set(perCall.map((p) => p.callType))];
    const meanScoreSd = perCall.reduce((a, p) => a + p.scoreSd, 0) / perCall.length;
    const maxScoreSd = Math.max(...perCall.map((p) => p.scoreSd));
    const meanRange = perCall.reduce((a, p) => a + p.scoreRange, 0) / perCall.length;
    const applicabilityFlipRate =
      perCall.reduce((a, p) => a + p.applicabilityFlipRate, 0) / perCall.length;

    const evidenceValues = perCall
      .map((p) => p.evidenceStability)
      .filter((v): v is number => v != null);
    const meanEvidenceStability =
      evidenceValues.length > 0
        ? evidenceValues.reduce((a, b) => a + b, 0) / evidenceValues.length
        : null;

    const evidenceWander = meanEvidenceStability == null ? 0.5 : 1 - meanEvidenceStability;
    const instabilityScore = round1(
      meanScoreSd + applicabilityFlipRate * 100 + evidenceWander * 20,
    );

    aggregates.push({
      themeKey,
      callTypes,
      nObservations: perCall.length,
      nSuccessfulRuns,
      meanScoreSd: round1(meanScoreSd),
      maxScoreSd: round1(maxScoreSd),
      meanRange: round1(meanRange),
      applicabilityFlipRate: round1(applicabilityFlipRate),
      meanEvidenceStability:
        meanEvidenceStability == null ? null : round1(meanEvidenceStability),
      instabilityScore,
    });
  }

  aggregates.sort((a, b) => b.instabilityScore - a.instabilityScore);
  return aggregates;
}

export function themeScoreVerdict(meanSd: number, nSuccessfulRuns: number): string {
  if (nSuccessfulRuns < MIN_RUNS_FOR_VERDICT) return "insufficient_data";
  if (meanSd <= THRESHOLDS.themeScoreSd.acceptable) return "acceptable";
  if (meanSd <= THRESHOLDS.themeScoreSd.needsAnchor) return "needs anchor before trusted";
  return "do not display until anchored";
}

export function compositeVerdict(sd: number, nSuccessfulRuns: number): string {
  if (nSuccessfulRuns < MIN_RUNS_FOR_VERDICT) return "insufficient_data";
  return sd <= THRESHOLDS.compositeSd ? "acceptable for display" : "composite too unstable";
}

export function snapshotFromScorecardResult(
  callId: string,
  callType: CallType,
  runIndex: number,
  scorecard: {
    rawScore: number;
    lines: Array<{
      themeKey: string;
      score: number;
      applicable: boolean;
      weight: number;
      evidence?: Array<{ atS?: number | null; quote?: string }>;
    }>;
  },
  rubricVersion: string,
): RunSnapshot {
  const lines: LineSnapshot[] = scorecard.lines.map((l) => ({
    themeKey: l.themeKey,
    score: l.score,
    applicable: l.applicable,
    weight: l.weight,
    evidence: (l.evidence || []).map((e) => ({
      atS: e.atS ?? null,
      quote: String(e.quote ?? ""),
    })),
  }));

  const composite = typeComposite(
    [{ callType, rubricVersion, lines: scorecard.lines.map((l) => ({ ...l, maxScore: 100 })) }],
    callType,
    { includeIneligible: true },
  );

  return {
    callId,
    callType,
    runIndex,
    lines,
    compositeScore: composite.score,
    applicableWeight: composite.applicableWeight,
  };
}

export function formatConsistencyReport(opts: {
  generatedAt: string;
  runsPerCall: number;
  transcriptsAttempted: number;
  transcriptsSucceeded: number;
  transcriptsFailed: number;
  runsAttempted: number;
  runsSucceeded: number;
  runsFailed: number;
  profileNote: string;
  temperatureNote: string;
  themeMetrics: ThemeAggregateMetrics[];
  callMetrics: CallRunMetrics[];
  errors?: Array<{ callId: string; runIndex: number; error: string }>;
}): string {
  const lines: string[] = [
    "# QIP self-consistency report",
    "",
    `Generated: ${opts.generatedAt}`,
    "",
    "## Run configuration",
    "",
    `- Transcripts attempted: **${opts.transcriptsAttempted}**`,
    `- Transcripts succeeded: **${opts.transcriptsSucceeded}**`,
    `- Transcripts failed: **${opts.transcriptsFailed}**`,
    `- Runs attempted: **${opts.runsAttempted}** · succeeded: **${opts.runsSucceeded}** · failed: **${opts.runsFailed}**`,
    `- Runs per transcript: **${opts.runsPerCall}**`,
    `- ${opts.profileNote}`,
    `- ${opts.temperatureNote}`,
    "",
    "## Thresholds (informational — not enforced)",
    "",
    "| Metric | Threshold |",
    "|---|---|",
    `| Theme score SD | ≤ ${THRESHOLDS.themeScoreSd.acceptable} acceptable · ${THRESHOLDS.themeScoreSd.acceptable + 1}–${THRESHOLDS.themeScoreSd.needsAnchor} needs anchor · > ${THRESHOLDS.themeScoreSd.needsAnchor} do not display |`,
    `| Applicability flip rate | > ${THRESHOLDS.applicabilityFlipRate * 100}% → fix prompt |`,
    `| Composite SD | ≤ ${THRESHOLDS.compositeSd} acceptable for display |`,
    `| Minimum data | ≥ ${MIN_TRANSCRIPTS_FOR_REPORT} transcripts · ≥ ${MIN_RUNS_FOR_VERDICT} runs per theme/composite verdict |`,
    "",
    "## Anchor priority list (themes ranked by instability — worst first)",
    "",
    "Write anchors for the themes at the top of this list first. Derived from repeatability evidence, not guesswork.",
    "",
    "| Rank | Theme | Profiles | Runs | Mean SD | Max SD | Mean range | Flip rate | Evidence stability | Instability | Verdict |",
    "|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|",
  ];

  opts.themeMetrics.forEach((t, i) => {
    const flipFlag =
      t.nSuccessfulRuns >= MIN_RUNS_FOR_VERDICT &&
      t.applicabilityFlipRate > THRESHOLDS.applicabilityFlipRate
        ? " ⚠"
        : "";
    const ev =
      t.meanEvidenceStability == null ? "—" : `${(t.meanEvidenceStability * 100).toFixed(0)}%`;
    lines.push(
      `| ${i + 1} | \`${t.themeKey}\` | ${t.callTypes.join(", ")} | ${t.nSuccessfulRuns} | ${t.meanScoreSd} | ${t.maxScoreSd} | ${t.meanRange} | ${(t.applicabilityFlipRate * 100).toFixed(0)}%${flipFlag} | ${ev} | ${t.instabilityScore} | ${themeScoreVerdict(t.meanScoreSd, t.nSuccessfulRuns)} |`,
    );
  });

  lines.push("", "## Per-call composite stability", "", "| Call | Type | Runs | Composite SD | Denominator flip rate | Verdict |", "|---|---|---:|---:|---:|---|");

  for (const c of opts.callMetrics) {
    lines.push(
      `| ${c.callId} | ${c.callType} | ${c.nSuccessfulRuns} | ${c.compositeSd} | ${(c.denominatorFlipRate * 100).toFixed(0)}% | ${compositeVerdict(c.compositeSd, c.nSuccessfulRuns)} |`,
    );
  }

  const verdictReadyThemes = opts.themeMetrics.filter(
    (t) => t.nSuccessfulRuns >= MIN_RUNS_FOR_VERDICT,
  );
  const worstThemes = verdictReadyThemes.filter(
    (t) =>
      t.meanScoreSd > THRESHOLDS.themeScoreSd.acceptable ||
      t.applicabilityFlipRate > THRESHOLDS.applicabilityFlipRate,
  );

  lines.push("", "## Summary", "");
  if (opts.transcriptsSucceeded < MIN_TRANSCRIPTS_FOR_REPORT) {
    lines.push(
      `**INSUFFICIENT DATA:** ${opts.transcriptsSucceeded} transcript(s) scored successfully, ${MIN_TRANSCRIPTS_FOR_REPORT} required. Threshold verdicts withheld.`,
    );
  } else if (!verdictReadyThemes.length) {
    lines.push(
      `No theme has ≥ ${MIN_RUNS_FOR_VERDICT} successful runs — all theme verdicts are \`insufficient_data\`.`,
    );
  } else if (!worstThemes.length) {
    lines.push(
      "All themes with sufficient runs meet score-SD and applicability-flip thresholds on this sample. Re-run after prompt or anchor changes.",
    );
  } else {
    lines.push(
      `**${worstThemes.length}** theme(s) exceed at least one threshold. Prioritize anchors for: ${worstThemes
        .slice(0, 6)
        .map((t) => `\`${t.themeKey}\``)
        .join(", ")}.`,
    );
  }

  if (opts.errors?.length) {
    lines.push("", "## API failures", "");
    for (const e of opts.errors) {
      lines.push(`- \`${e.callId}\` run ${e.runIndex}: ${e.error}`);
    }
  }

  return lines.join("\n");
}
