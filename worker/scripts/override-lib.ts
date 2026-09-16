/**
 * Pure score-override and ARR-assumption override stats — no I/O.
 * Input to Phase 5 calibration; cross-references latest 4.1′ consistency run.
 */

import {
  aggregateThemeMetrics,
  THRESHOLDS,
  type RunSnapshot,
  type ThemeAggregateMetrics,
} from "../src/consistency-lib.ts";
import type { ScoreOverride } from "../src/domain-model/scorecard.ts";

export interface ScorecardLineRef {
  id: string;
  themeKey: string;
  applicable: boolean;
  ownerId: string;
}

export interface ArrOverrideRow {
  id: string;
  dealId: string;
  field: string;
  action: string;
  original: unknown;
  override: unknown;
  userId: string;
  reason?: string;
  ownerId: string;
  createdAt: number;
}

export interface UserRef {
  id: string;
  email?: string | null;
  displayName?: string | null;
}

export interface OverrideReportInput {
  scoreOverrides: ScoreOverride[];
  scorecardLines: ScorecardLineRef[];
  arrOverrides: ArrOverrideRow[];
  users?: UserRef[];
}

export interface ReasonGroup {
  label: string;
  count: number;
}

export interface ThemeOverrideStats {
  themeKey: string;
  overrideCount: number;
  scoredCount: number;
  overrideRate: number;
  meanSignedDelta: number;
  deltaVariance: number;
  deltaStddev: number;
  reasonGroups: ReasonGroup[];
}

export interface SeOverrideStats {
  userId: string;
  label: string;
  overrideCount: number;
  scoredLineCount: number;
  overrideRate: number;
  shareOfAllOverrides: number;
}

export interface ArrAssumptionOverrideStats {
  field: string;
  overrideCount: number;
  opportunityCount: number;
  overrideRate: number;
  meanSignedDelta: number;
  deltaVariance: number;
  deltaStddev: number;
  reasonGroups: ReasonGroup[];
}

export type OverrideFixKind = "anchor_priority" | "prompt_offset" | "monitor";

export interface ThemeCrossRef {
  themeKey: string;
  override: ThemeOverrideStats;
  consistency: ThemeAggregateMetrics | null;
  fixKind: OverrideFixKind;
  notes: string;
}

export interface OverrideReportData {
  generatedAt: string;
  scoreOverrideCount: number;
  arrOverrideCount: number;
  scoredLineCount: number;
  themeStats: ThemeOverrideStats[];
  seStats: SeOverrideStats[];
  arrStats: ArrAssumptionOverrideStats[];
  crossRef: ThemeCrossRef[];
  consistencyRunId: string | null;
  consistencyRunGeneratedAt: string | null;
}

export const OVERRIDE_THRESHOLDS = {
  /** Override rate above this counts as "frequently overridden". */
  frequentOverrideRate: 0.05,
  /** Minimum overrides before rate-based flags apply. */
  minOverridesForRate: 2,
  /** |meanSignedDelta| above this with low variance → prompt offset candidate. */
  consistentBiasDelta: 5,
  /** Delta stddev at or below this → consistent bias (fixable). */
  consistentBiasMaxStddev: 12,
  /** One SE overriding more than this share of their scored lines → trust / misunderstanding flag. */
  seHighOverrideRate: 0.35,
} as const;

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function signedDeltaInterpretation(meanSigned: number): string {
  if (meanSigned > 2) return "model harsh (SEs raise scores)";
  if (meanSigned < -2) return "model generous (SEs lower scores)";
  return "near neutral";
}

export function normalizeReason(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Group override reasons by normalized exact text (case-insensitive). */
export function groupReasons(reasons: string[]): ReasonGroup[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const raw of reasons) {
    const label = normalizeReason(raw);
    if (!label) continue;
    const key = label.toLowerCase();
    const prev = counts.get(key);
    if (prev) prev.count += 1;
    else counts.set(key, { label, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map(({ label, count }) => ({ label, count }));
}

function variance(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
}

function stddev(values: number[]): number {
  return Math.sqrt(variance(values));
}

export function countScoredLinesByTheme(lines: ScorecardLineRef[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (!line.applicable) continue;
    counts.set(line.themeKey, (counts.get(line.themeKey) || 0) + 1);
  }
  return counts;
}

export function countScoredLinesByOwner(lines: ScorecardLineRef[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (!line.applicable) continue;
    counts.set(line.ownerId, (counts.get(line.ownerId) || 0) + 1);
  }
  return counts;
}

export function buildLineThemeMap(
  lines: ScorecardLineRef[],
): Map<string, { themeKey: string; ownerId: string }> {
  return new Map(lines.map((l) => [l.id, { themeKey: l.themeKey, ownerId: l.ownerId }]));
}

export function aggregateThemeOverrides(
  overrides: ScoreOverride[],
  lines: ScorecardLineRef[],
): ThemeOverrideStats[] {
  const scoredByTheme = countScoredLinesByTheme(lines);
  const lineMeta = buildLineThemeMap(lines);
  const byTheme = new Map<string, { deltas: number[]; reasons: string[] }>();

  for (const ov of overrides) {
    const meta = lineMeta.get(ov.scorecardLineId);
    const themeKey = meta?.themeKey;
    if (!themeKey) continue;
    const delta = ov.override - ov.original;
    const bucket = byTheme.get(themeKey) || { deltas: [], reasons: [] };
    bucket.deltas.push(delta);
    if (ov.reason?.trim()) bucket.reasons.push(ov.reason);
    byTheme.set(themeKey, bucket);
  }

  const themes = new Set([...scoredByTheme.keys(), ...byTheme.keys()]);
  const stats: ThemeOverrideStats[] = [];

  for (const themeKey of themes) {
    const scoredCount = scoredByTheme.get(themeKey) || 0;
    const bucket = byTheme.get(themeKey) || { deltas: [], reasons: [] };
    const overrideCount = bucket.deltas.length;
    const meanSignedDelta =
      overrideCount > 0 ? bucket.deltas.reduce((a, b) => a + b, 0) / overrideCount : 0;
    const deltaVariance = variance(bucket.deltas);
    stats.push({
      themeKey,
      overrideCount,
      scoredCount,
      overrideRate: scoredCount > 0 ? overrideCount / scoredCount : 0,
      meanSignedDelta: round1(meanSignedDelta),
      deltaVariance: round1(deltaVariance),
      deltaStddev: round1(stddev(bucket.deltas)),
      reasonGroups: groupReasons(bucket.reasons),
    });
  }

  stats.sort(
    (a, b) =>
      b.overrideRate - a.overrideRate ||
      b.overrideCount - a.overrideCount ||
      a.themeKey.localeCompare(b.themeKey),
  );
  return stats;
}

export function aggregateSeOverrides(
  overrides: ScoreOverride[],
  lines: ScorecardLineRef[],
  users: UserRef[] = [],
): SeOverrideStats[] {
  const scoredByOwner = countScoredLinesByOwner(lines);
  const lineMeta = buildLineThemeMap(lines);
  const userLabel = new Map(users.map((u) => [u.id, u.email || u.displayName || u.id]));

  const byUser = new Map<string, number>();
  for (const ov of overrides) {
    const meta = lineMeta.get(ov.scorecardLineId);
    const ownerId = meta?.ownerId || ov.userId;
    byUser.set(ownerId, (byUser.get(ownerId) || 0) + 1);
  }

  const totalOverrides = overrides.length;
  const owners = new Set([...scoredByOwner.keys(), ...byUser.keys()]);
  const stats: SeOverrideStats[] = [];

  for (const userId of owners) {
    const overrideCount = byUser.get(userId) || 0;
    const scoredLineCount = scoredByOwner.get(userId) || 0;
    stats.push({
      userId,
      label: userLabel.get(userId) || userId,
      overrideCount,
      scoredLineCount,
      overrideRate: scoredLineCount > 0 ? overrideCount / scoredLineCount : 0,
      shareOfAllOverrides: totalOverrides > 0 ? overrideCount / totalOverrides : 0,
    });
  }

  stats.sort(
    (a, b) =>
      b.overrideRate - a.overrideRate ||
      b.overrideCount - a.overrideCount ||
      a.label.localeCompare(b.label),
  );
  return stats;
}

function numericOverrideDelta(original: unknown, override: unknown): number | null {
  const a = Number(original);
  const b = Number(override);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return b - a;
}

export function aggregateArrAssumptionOverrides(
  arrOverrides: ArrOverrideRow[],
  /** Fields to include; defaults to assumption keys worth calibrating. */
  fields: string[] = [
    "aiSessionRate",
    "peakToAverageRatio",
    "conversationsPerTicket",
    "sessionDirectOverride",
  ],
): ArrAssumptionOverrideStats[] {
  const fieldSet = new Set(fields);
  const byField = new Map<string, { deltas: number[]; reasons: string[]; deals: Set<string> }>();

  for (const row of arrOverrides) {
    if (!fieldSet.has(row.field)) continue;
    if (row.action === "confirm_assumptions") continue;
    const delta = numericOverrideDelta(row.original, row.override);
    if (delta == null) continue;
    const bucket = byField.get(row.field) || { deltas: [], reasons: [], deals: new Set() };
    bucket.deltas.push(delta);
    if (row.reason?.trim()) bucket.reasons.push(row.reason);
    bucket.deals.add(row.dealId);
    byField.set(row.field, bucket);
  }

  const stats: ArrAssumptionOverrideStats[] = [];
  for (const field of fields) {
    const bucket = byField.get(field) || { deltas: [], reasons: [], deals: new Set() };
    const overrideCount = bucket.deltas.length;
    const opportunityCount = bucket.deals.size;
    const meanSignedDelta =
      overrideCount > 0 ? bucket.deltas.reduce((a, b) => a + b, 0) / overrideCount : 0;
    const deltaVariance = variance(bucket.deltas);
    stats.push({
      field,
      overrideCount,
      opportunityCount,
      overrideRate: opportunityCount > 0 ? overrideCount / opportunityCount : 0,
      meanSignedDelta: field === "aiSessionRate" ? round3(meanSignedDelta) : round1(meanSignedDelta),
      deltaVariance: field === "aiSessionRate" ? round3(deltaVariance) : round1(deltaVariance),
      deltaStddev: field === "aiSessionRate" ? round3(stddev(bucket.deltas)) : round1(stddev(bucket.deltas)),
      reasonGroups: groupReasons(bucket.reasons),
    });
  }

  return stats.filter((s) => s.overrideCount > 0 || s.field === "aiSessionRate");
}

export function isThemeUnstable(metrics: ThemeAggregateMetrics | null): boolean {
  if (!metrics) return false;
  return (
    metrics.meanScoreSd > THRESHOLDS.themeScoreSd.acceptable ||
    metrics.applicabilityFlipRate > THRESHOLDS.applicabilityFlipRate
  );
}

export function isFrequentlyOverridden(stats: ThemeOverrideStats): boolean {
  return (
    stats.overrideCount >= OVERRIDE_THRESHOLDS.minOverridesForRate &&
    stats.overrideRate >= OVERRIDE_THRESHOLDS.frequentOverrideRate
  );
}

export function isConsistentDirectionalBias(stats: ThemeOverrideStats): boolean {
  return (
    stats.overrideCount >= OVERRIDE_THRESHOLDS.minOverridesForRate &&
    Math.abs(stats.meanSignedDelta) >= OVERRIDE_THRESHOLDS.consistentBiasDelta &&
    stats.deltaStddev <= OVERRIDE_THRESHOLDS.consistentBiasMaxStddev
  );
}

export function classifyThemeFix(
  override: ThemeOverrideStats,
  consistency: ThemeAggregateMetrics | null,
): { fixKind: OverrideFixKind; notes: string } {
  const unstable = isThemeUnstable(consistency);
  const frequent = isFrequentlyOverridden(override);
  const directional = isConsistentDirectionalBias(override);

  if (unstable && frequent) {
    return {
      fixKind: "anchor_priority",
      notes:
        "Unstable in 4.1′ and frequently overridden — write anchors first; overrides confirm the rubric is not repeatable.",
    };
  }
  if (!unstable && directional) {
    return {
      fixKind: "prompt_offset",
      notes: `Stable in 4.1′ but ${signedDeltaInterpretation(override.meanSignedDelta)} with low delta scatter — tune prompt/scoring bias, not anchors.`,
    };
  }
  if (frequent && !unstable) {
    return {
      fixKind: "monitor",
      notes: "Frequently overridden but model is repeatable — watch for emerging directional bias.",
    };
  }
  if (unstable && !frequent) {
    return {
      fixKind: "monitor",
      notes: "Unstable in 4.1′ with few human overrides so far — anchor work still indicated by consistency alone.",
    };
  }
  return { fixKind: "monitor", notes: "Low override volume and/or acceptable consistency." };
}

export function crossReferenceThemes(
  themeStats: ThemeOverrideStats[],
  consistencyMetrics: ThemeAggregateMetrics[],
): ThemeCrossRef[] {
  const consistencyByKey = new Map(consistencyMetrics.map((m) => [m.themeKey, m]));
  const refs: ThemeCrossRef[] = themeStats
    .filter((t) => t.overrideCount > 0 || consistencyByKey.has(t.themeKey))
    .map((override) => {
      const consistency = consistencyByKey.get(override.themeKey) ?? null;
      const { fixKind, notes } = classifyThemeFix(override, consistency);
      return { themeKey: override.themeKey, override, consistency, fixKind, notes };
    });

  const rank = (k: OverrideFixKind) =>
    k === "anchor_priority" ? 0 : k === "prompt_offset" ? 1 : 2;
  refs.sort(
    (a, b) =>
      rank(a.fixKind) - rank(b.fixKind) ||
      b.override.overrideRate - a.override.overrideRate ||
      (b.consistency?.instabilityScore ?? 0) - (a.consistency?.instabilityScore ?? 0),
  );
  return refs;
}

/** Build RunSnapshot rows from a 4.1′ runs.json artifact. */
export function snapshotsFromConsistencyRuns(
  rawResults: Array<{
    callId?: string;
    callType?: string;
    runIndex?: number;
    compositeScore?: number | null;
    applicableWeight?: number;
    lines?: Array<{
      themeKey: string;
      score: number;
      applicable: boolean;
      weight: number;
      evidence?: Array<{ atS?: number | null; quote?: string }>;
    }>;
    error?: string;
  }>,
): RunSnapshot[] {
  const out: RunSnapshot[] = [];
  for (const row of rawResults) {
    if (row.error || !row.callId || !row.callType || row.runIndex == null || !row.lines) continue;
    out.push({
      callId: row.callId,
      callType: row.callType as RunSnapshot["callType"],
      runIndex: row.runIndex,
      compositeScore: row.compositeScore ?? null,
      applicableWeight: row.applicableWeight ?? 0,
      lines: row.lines.map((l) => ({
        themeKey: l.themeKey,
        score: l.score,
        applicable: l.applicable,
        weight: l.weight,
        evidence: (l.evidence || []).map((e) => ({
          atS: e.atS ?? null,
          quote: String(e.quote ?? ""),
        })),
      })),
    });
  }
  return out;
}

export function buildOverrideReportData(
  input: OverrideReportInput,
  opts: {
    generatedAt?: string;
    consistencyMetrics?: ThemeAggregateMetrics[];
    consistencyRunId?: string | null;
    consistencyRunGeneratedAt?: string | null;
  } = {},
): OverrideReportData {
  const themeStats = aggregateThemeOverrides(input.scoreOverrides, input.scorecardLines);
  const seStats = aggregateSeOverrides(
    input.scoreOverrides,
    input.scorecardLines,
    input.users || [],
  );
  const arrStats = aggregateArrAssumptionOverrides(input.arrOverrides);
  const crossRef = crossReferenceThemes(themeStats, opts.consistencyMetrics || []);

  return {
    generatedAt: opts.generatedAt || new Date().toISOString(),
    scoreOverrideCount: input.scoreOverrides.length,
    arrOverrideCount: input.arrOverrides.length,
    scoredLineCount: input.scorecardLines.filter((l) => l.applicable).length,
    themeStats,
    seStats,
    arrStats,
    crossRef,
    consistencyRunId: opts.consistencyRunId ?? null,
    consistencyRunGeneratedAt: opts.consistencyRunGeneratedAt ?? null,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fixKindLabel(kind: OverrideFixKind): string {
  if (kind === "anchor_priority") return "anchor (highest priority)";
  if (kind === "prompt_offset") return "prompt calibration offset";
  return "monitor";
}

export function formatOverrideReport(data: OverrideReportData): string {
  const lines: string[] = [
    "# Score override calibration report",
    "",
    `Generated: ${data.generatedAt}`,
    "",
    "Human overrides are labelled calibration data: a specific theme on a specific call, with a reason.",
    "This report accumulates from launch day and feeds Phase 5 calibration.",
    "",
    "## Volume",
    "",
    `- Score overrides logged: **${data.scoreOverrideCount}**`,
    `- Applicable scorecard lines in corpus: **${data.scoredLineCount}**`,
    `- ARR assumption overrides logged: **${data.arrOverrideCount}**`,
    `- Latest 4.1′ consistency run: **${data.consistencyRunId ?? "none found"}**${
      data.consistencyRunGeneratedAt ? ` (${data.consistencyRunGeneratedAt})` : ""
    }`,
    "",
    "## Per theme",
    "",
    "Override rate = overrides ÷ times the theme was scored (applicable lines).",
    "Signed delta = override − original (positive → model harsh; negative → model generous).",
    "",
    "| Theme | Overrides | Scored | Rate | Mean Δ | Var(Δ) | SD(Δ) | Bias | Top reasons |",
    "|---|---:|---:|---:|---:|---:|---:|---|---|",
  ];

  for (const t of data.themeStats) {
    const reasons =
      t.reasonGroups
        .slice(0, 2)
        .map((g) => `${g.label} (${g.count})`)
        .join("; ") || "—";
    lines.push(
      `| \`${t.themeKey}\` | ${t.overrideCount} | ${t.scoredCount} | ${pct(t.overrideRate)} | ${t.meanSignedDelta} | ${t.deltaVariance} | ${t.deltaStddev} | ${signedDeltaInterpretation(t.meanSignedDelta)} | ${reasons} |`,
    );
  }

  if (data.themeStats.some((t) => t.reasonGroups.length)) {
    lines.push("", "### Override reasons by theme", "");
    for (const t of data.themeStats.filter((x) => x.overrideCount > 0)) {
      lines.push(`**${t.themeKey}**`);
      for (const g of t.reasonGroups.slice(0, 8)) {
        lines.push(`- (${g.count}) ${g.label}`);
      }
      lines.push("");
    }
  }

  lines.push(
    "## Cross-reference with 4.1′ consistency",
    "",
    "Themes that are **both** unstable and frequently overridden → anchor work first.",
    "Themes that are **stable** but consistently overridden in one direction → prompt offset, not anchors.",
    "",
    "| Theme | Fix | Override rate | Mean Δ | 4.1′ mean SD | 4.1′ flip | Instability | Notes |",
    "|---|---|---:|---:|---:|---:|---:|---|",
  );

  for (const row of data.crossRef.filter(
    (r) => r.override.overrideCount > 0 || r.consistency,
  )) {
    const c = row.consistency;
    lines.push(
      `| \`${row.themeKey}\` | ${fixKindLabel(row.fixKind)} | ${pct(row.override.overrideRate)} | ${row.override.meanSignedDelta} | ${c ? c.meanScoreSd : "—"} | ${c ? pct(c.applicabilityFlipRate) : "—"} | ${c ? c.instabilityScore : "—"} | ${row.notes} |`,
    );
  }

  const anchorPriority = data.crossRef.filter((r) => r.fixKind === "anchor_priority");
  const promptOffsets = data.crossRef.filter((r) => r.fixKind === "prompt_offset");
  lines.push("", "### Priority summary", "");
  if (anchorPriority.length) {
    lines.push(
      `**Anchor priority (${anchorPriority.length}):** ${anchorPriority.map((r) => `\`${r.themeKey}\``).join(", ")}`,
    );
  } else {
    lines.push("**Anchor priority:** none yet (need both instability and frequent overrides).");
  }
  if (promptOffsets.length) {
    lines.push(
      `**Prompt offset candidates (${promptOffsets.length}):** ${promptOffsets.map((r) => `\`${r.themeKey}\``).join(", ")}`,
    );
  } else {
    lines.push("**Prompt offset candidates:** none with stable 4.1′ + directional override bias yet.");
  }

  lines.push(
    "",
    "## Per SE",
    "",
    "Override rate = overrides on that SE's applicable lines. High rate on one person → trust or misunderstanding;",
    "everyone overriding one theme → rubric problem (see per-theme). Do not conflate.",
    "",
    "| SE | Overrides | Scored lines | Rate | Share of all overrides | Flag |",
    "|---|---:|---:|---:|---:|---|",
  );

  for (const se of data.seStats) {
    const flag =
      se.overrideRate >= OVERRIDE_THRESHOLDS.seHighOverrideRate && se.scoredLineCount >= 5
        ? "high personal override rate"
        : se.shareOfAllOverrides >= 0.5 && data.seStats.length > 1
          ? "majority of team overrides"
          : "";
    lines.push(
      `| ${se.label} | ${se.overrideCount} | ${se.scoredLineCount} | ${pct(se.overrideRate)} | ${pct(se.shareOfAllOverrides)} | ${flag || "—"} |`,
    );
  }

  const hotThemes = data.themeStats.filter(
    (t) =>
      t.overrideCount >= 3 &&
      t.overrideRate >= OVERRIDE_THRESHOLDS.frequentOverrideRate &&
      data.seStats.filter((s) => s.overrideCount > 0).length >= 2,
  );
  if (hotThemes.length) {
    lines.push(
      "",
      `Themes with broad team pushback (≥3 overrides, ≥${pct(OVERRIDE_THRESHOLDS.frequentOverrideRate)} rate, multiple SEs): ${hotThemes.map((t) => `\`${t.themeKey}\``).join(", ")}`,
    );
  }

  lines.push(
    "",
    "## ARR assumption overrides",
    "",
    "`ai_session_rate` defaults to **0.5** (unvalidated; ~45% of ARR on AI-attached deals).",
    "Consistent SE pushes on `aiSessionRate` mean the book default is wrong — this section is the signal.",
    "",
    "| Field | Overrides | Deals touched | Rate | Mean Δ | Var(Δ) | SD(Δ) | Bias | Top reasons |",
    "|---|---:|---:|---:|---:|---:|---:|---|---|",
  );

  for (const a of data.arrStats) {
    const bias =
      a.field === "aiSessionRate"
        ? a.meanSignedDelta > 0.02
          ? "SEs raise vs 0.5 default"
          : a.meanSignedDelta < -0.02
            ? "SEs lower vs default"
            : "near default"
        : signedDeltaInterpretation(a.meanSignedDelta);
    const reasons =
      a.reasonGroups
        .slice(0, 2)
        .map((g) => `${g.label} (${g.count})`)
        .join("; ") || "—";
    lines.push(
      `| \`${a.field}\` | ${a.overrideCount} | ${a.opportunityCount} | ${a.opportunityCount ? pct(a.overrideRate) : "—"} | ${a.meanSignedDelta} | ${a.deltaVariance} | ${a.deltaStddev} | ${bias} | ${reasons} |`,
    );
  }

  if (data.arrStats.some((a) => a.reasonGroups.length)) {
    lines.push("", "### ARR override reasons", "");
    for (const a of data.arrStats.filter((x) => x.reasonGroups.length)) {
      lines.push(`**${a.field}**`);
      for (const g of a.reasonGroups.slice(0, 8)) {
        lines.push(`- (${g.count}) ${g.label}`);
      }
      lines.push("");
    }
  }

  lines.push("", "## Summary", "");
  if (!data.scoreOverrideCount && !data.arrOverrideCount) {
    lines.push(
      "No overrides logged yet. Re-run after SEs begin overriding scores and ARR assumptions.",
    );
  } else {
    const parts: string[] = [];
    if (anchorPriority.length) {
      parts.push(`${anchorPriority.length} theme(s) need anchors urgently`);
    }
    if (promptOffsets.length) {
      parts.push(`${promptOffsets.length} theme(s) need prompt bias calibration`);
    }
    const ai = data.arrStats.find((a) => a.field === "aiSessionRate");
    if (ai && ai.overrideCount >= OVERRIDE_THRESHOLDS.minOverridesForRate) {
      parts.push(
        `aiSessionRate mean Δ ${ai.meanSignedDelta} across ${ai.overrideCount} edit(s) — review price-book default 0.5`,
      );
    }
    lines.push(parts.length ? parts.join(". ") + "." : "Override volume is still low; treat as early signal.");
  }

  return lines.join("\n");
}

export { aggregateThemeMetrics };
