/**
 * QIP rubric anchor import, validation, prompt formatting, and coverage.
 * See docs/QIP_PROFILES.md §4 — models must never write anchors without human approval.
 */

import {
  RUBRIC_PROFILES,
  rubricIdFor,
  type CallType,
  type RubricProfileSeed,
} from "./rubric-profiles";

export const ANCHOR_SCORES = [1, 2, 3, 4, 5] as const;
export type AnchorScore = (typeof ANCHOR_SCORES)[number];

/** Max confidence for applicable lines scored against unanchored themes (QIP §4). */
export const UNANCHORED_CONFIDENCE_CAP = 0.55;

export const UNANCHORED_PROMPT_NOTICE =
  "This theme is unanchored — score conservatively and report low confidence. Do NOT invent anchors.";

export interface RubricAnchorLevel {
  score: AnchorScore;
  description: string;
}

/** Stored on rubricThemes.anchorsJson once hand-scored and approved. */
export interface RubricAnchorsJson {
  themeKey: string;
  profileCallType: CallType;
  levels: RubricAnchorLevel[];
  author: string;
  approvedBy: string;
  approvedAt: number;
  notes?: string | null;
}

/** Canonical storytelling levels — docs/QIP_PROFILES.md §4 worked example. */
export const STORYTELLING_ANCHOR_LEVELS: RubricAnchorLevel[] = [
  {
    score: 1,
    description:
      'Pure feature tour — "here\'s the ticket list, here\'s the automation builder"',
  },
  {
    score: 2,
    description: "Occasional narrative gesture, mostly feature walkthrough",
  },
  {
    score: 3,
    description:
      'Personas named but generic ("a customer", "an agent"), or industry framing that doesn\'t persist past the opening',
  },
  {
    score: 4,
    description: "Two or three personas, industry-relevant, mostly sustained but drops in places",
  },
  {
    score: 5,
    description:
      "Named personas across all three lenses (end user, agent, admin), set in the customer's own industry using their vocabulary, carried as one continuous thread through the demo",
  },
];

const STORYTELLING_TEMPLATE_META = {
  author: "QIP spec §4 worked example",
  approvedBy: "qip-spec-v1.0-template",
  approvedAt: 0,
  notes: "Canonical template from docs/QIP_PROFILES.md §4 — not model-generated.",
} as const;

export function buildStorytellingAnchors(profileCallType: CallType): RubricAnchorsJson {
  return {
    themeKey: "storytelling",
    profileCallType,
    levels: STORYTELLING_ANCHOR_LEVELS,
    ...STORYTELLING_TEMPLATE_META,
  };
}

function isCallType(value: unknown): value is CallType {
  return typeof value === "string" && RUBRIC_PROFILES.some((p) => p.callType === value);
}

function nonEmptyString(value: unknown, field: string, errors: string[]): string | null {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${field} is required`);
    return null;
  }
  return value.trim();
}

/** Validate structured anchor payload — returns human-readable errors (empty = ok). */
export function validateRubricAnchors(
  raw: unknown,
  opts: { requireApproval?: boolean } = {},
): string[] {
  const requireApproval = opts.requireApproval !== false;
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") {
    return ["anchorsJson must be an object"];
  }
  const row = raw as Record<string, unknown>;

  const themeKey = nonEmptyString(row.themeKey, "themeKey", errors);
  if (row.profileCallType == null) {
    errors.push("profileCallType is required");
  } else if (!isCallType(row.profileCallType)) {
    errors.push(`profileCallType must be a known call type, got ${String(row.profileCallType)}`);
  }

  nonEmptyString(row.author, "author", errors);

  const approvedBy = nonEmptyString(row.approvedBy, "approvedBy", errors);
  if (requireApproval && !approvedBy) {
    errors.push("approvedBy is required — reject model-generated anchors at the data layer");
  }

  if (typeof row.approvedAt !== "number" || !Number.isFinite(row.approvedAt)) {
    errors.push("approvedAt must be a finite number (epoch ms)");
  }

  if (!Array.isArray(row.levels)) {
    errors.push("levels must be an array");
    return errors;
  }

  if (row.levels.length !== ANCHOR_SCORES.length) {
    errors.push(
      `levels must contain exactly ${ANCHOR_SCORES.length} entries — reject partial anchor sets`,
    );
    return errors;
  }

  const seenScores = new Set<number>();
  for (let i = 0; i < row.levels.length; i++) {
    const level = row.levels[i];
    if (!level || typeof level !== "object") {
      errors.push(`levels[${i}] must be an object`);
      continue;
    }
    const lv = level as Record<string, unknown>;
    if (typeof lv.score !== "number" || !Number.isInteger(lv.score)) {
      errors.push(`levels[${i}].score must be an integer 1..5`);
      continue;
    }
    if (lv.score < 1 || lv.score > 5) {
      errors.push(`levels[${i}].score must be 1..5`);
    }
    if (seenScores.has(lv.score)) {
      errors.push(`duplicate anchor score ${lv.score}`);
    }
    seenScores.add(lv.score);
    nonEmptyString(lv.description, `levels[${i}].description`, errors);
  }

  const expected = [...ANCHOR_SCORES];
  const actual = row.levels
    .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>).score : null))
    .filter((s): s is number => typeof s === "number")
    .sort((a, b) => a - b);
  if (
    actual.length === ANCHOR_SCORES.length &&
    !expected.every((score, idx) => actual[idx] === score)
  ) {
    errors.push("levels must include monotonic scores 1, 2, 3, 4, 5 exactly once");
  }

  if (themeKey && row.profileCallType && isCallType(row.profileCallType)) {
    const profile = RUBRIC_PROFILES.find((p) => p.callType === row.profileCallType);
    if (profile && !profile.themes.some((t) => t.themeKey === themeKey)) {
      errors.push(`${themeKey} is not in profile ${row.profileCallType}`);
    }
  }

  return errors;
}

/** Parse and normalize anchors — throws on validation failure. */
export function parseRubricAnchors(raw: unknown): RubricAnchorsJson {
  const errors = validateRubricAnchors(raw, { requireApproval: true });
  if (errors.length) {
    throw Object.assign(new Error(`Invalid anchorsJson: ${errors.join("; ")}`), {
      status: 400,
      validationErrors: errors,
    });
  }
  const row = raw as Record<string, unknown>;
  const levels = (row.levels as Array<Record<string, unknown>>).map((lv) => ({
    score: lv.score as AnchorScore,
    description: String(lv.description).trim(),
  }));
  levels.sort((a, b) => a.score - b.score);
  return {
    themeKey: String(row.themeKey).trim(),
    profileCallType: row.profileCallType as CallType,
    levels,
    author: String(row.author).trim(),
    approvedBy: String(row.approvedBy).trim(),
    approvedAt: row.approvedAt as number,
    notes: row.notes == null ? null : String(row.notes).trim() || null,
  };
}

export function isThemeAnchored(anchorsJson: RubricAnchorsJson | null | undefined): boolean {
  return validateRubricAnchors(anchorsJson, { requireApproval: true }).length === 0;
}

/** Reject writes without human approval — call before persisting anchorsJson. */
export function prepareRubricAnchorsWrite(raw: unknown): RubricAnchorsJson {
  return parseRubricAnchors(raw);
}

export function formatAnchorsForPrompt(anchors: RubricAnchorsJson): string {
  const lines = anchors.levels
    .slice()
    .sort((a, b) => a.score - b.score)
    .map((lv) => `  ${lv.score}: ${lv.description}`);
  return `Anchors (1–5 scale; map to 0–100 as 20/40/60/80/100):\n${lines.join("\n")}`;
}

export function formatAnchorBlockForPrompt(anchors: RubricAnchorsJson | null | undefined): string {
  if (anchors && isThemeAnchored(anchors)) {
    return formatAnchorsForPrompt(anchors);
  }
  return UNANCHORED_PROMPT_NOTICE;
}

export function applyUnanchoredConfidenceCap(confidence: number): number {
  return Math.min(confidence, UNANCHORED_CONFIDENCE_CAP);
}

export interface ProfileAnchorCoverage {
  callType: CallType;
  rubricId: string;
  version: string;
  provisional: boolean;
  themeCount: number;
  anchoredCount: number;
  unanchoredCount: number;
  totalWeight: number;
  anchoredWeight: number;
  unanchoredWeight: number;
  anchoredWeightPct: number;
  anchoredThemes: string[];
  unanchoredThemes: Array<{ themeKey: string; weight: number }>;
}

export interface AnchorCoverageReport {
  profiles: ProfileAnchorCoverage[];
  uniqueThemeKeys: number;
  uniqueAnchoredThemeKeys: number;
}

export type ResolveAnchorsFn = (
  themeKey: string,
  profile: RubricProfileSeed,
) => RubricAnchorsJson | null | undefined;

export function defaultResolveAnchors(
  themeKey: string,
  profile: RubricProfileSeed,
): RubricAnchorsJson | null {
  if (themeKey === "storytelling") {
    return buildStorytellingAnchors(profile.callType);
  }
  return null;
}

export function anchorsJsonForTheme(
  themeKey: string,
  profileCallType?: CallType,
): RubricAnchorsJson | null {
  if (profileCallType) {
    const profile = RUBRIC_PROFILES.find((p) => p.callType === profileCallType);
    if (profile) return defaultResolveAnchors(themeKey, profile);
  }
  if (themeKey === "storytelling") return buildStorytellingAnchors("demo");
  return null;
}

export function computeProfileAnchorCoverage(
  profile: RubricProfileSeed,
  resolveAnchors: ResolveAnchorsFn = defaultResolveAnchors,
): ProfileAnchorCoverage {
  const anchoredThemes: string[] = [];
  const unanchoredThemes: Array<{ themeKey: string; weight: number }> = [];
  let anchoredWeight = 0;
  let totalWeight = 0;

  for (const theme of profile.themes) {
    totalWeight += theme.weight;
    const anchors = resolveAnchors(theme.themeKey, profile);
    if (isThemeAnchored(anchors)) {
      anchoredThemes.push(theme.themeKey);
      anchoredWeight += theme.weight;
    } else {
      unanchoredThemes.push({ themeKey: theme.themeKey, weight: theme.weight });
    }
  }

  const anchoredWeightPct = totalWeight > 0 ? (anchoredWeight / totalWeight) * 100 : 0;

  return {
    callType: profile.callType,
    rubricId: rubricIdFor(profile.callType, profile.version),
    version: profile.version,
    provisional: profile.provisional,
    themeCount: profile.themes.length,
    anchoredCount: anchoredThemes.length,
    unanchoredCount: unanchoredThemes.length,
    totalWeight,
    anchoredWeight,
    unanchoredWeight: totalWeight - anchoredWeight,
    anchoredWeightPct,
    anchoredThemes,
    unanchoredThemes,
  };
}

export function computeAnchorCoverageReport(
  resolveAnchors: ResolveAnchorsFn = defaultResolveAnchors,
): AnchorCoverageReport {
  const profiles = RUBRIC_PROFILES.map((p) => computeProfileAnchorCoverage(p, resolveAnchors));
  const allKeys = new Set<string>();
  const anchoredKeys = new Set<string>();
  for (const profile of RUBRIC_PROFILES) {
    for (const theme of profile.themes) {
      allKeys.add(theme.themeKey);
      if (isThemeAnchored(resolveAnchors(theme.themeKey, profile))) {
        anchoredKeys.add(theme.themeKey);
      }
    }
  }
  return {
    profiles,
    uniqueThemeKeys: allKeys.size,
    uniqueAnchoredThemeKeys: anchoredKeys.size,
  };
}

export function formatAnchorCoverageReport(report: AnchorCoverageReport): string {
  const lines: string[] = [
    "QIP anchor coverage (weight-weighted)",
    `Shared vocabulary: ${report.uniqueAnchoredThemeKeys}/${report.uniqueThemeKeys} theme keys anchored`,
    "",
  ];

  for (const row of report.profiles) {
    const status = row.provisional ? "shadow" : "live";
    lines.push(
      `${row.callType} (${status}, ${row.version}) — ${row.anchoredCount}/${row.themeCount} themes anchored, ${row.anchoredWeightPct.toFixed(1)}% of weight anchored (${row.anchoredWeight}/${row.totalWeight} pts)`,
    );
    if (row.anchoredThemes.length) {
      lines.push(`  anchored: ${row.anchoredThemes.join(", ")}`);
    }
    if (row.unanchoredThemes.length) {
      const heavy = row.unanchoredThemes
        .slice()
        .sort((a, b) => b.weight - a.weight)
        .map((t) => `${t.themeKey} (${t.weight})`)
        .join(", ");
      lines.push(`  unanchored: ${heavy}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
