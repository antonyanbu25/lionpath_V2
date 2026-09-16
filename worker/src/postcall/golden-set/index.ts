/**
 * Growing QIP golden-set: human theme-level scores + distilled rules.
 * Used by the third scoring pass (scorecard-calibrate.ts) and by eval-qip-golden.
 */

import { profileFor, canonicalizeSeMotion, type CallType, type QipProfile, type SeMotion } from "../../rubric-profiles";
import { GOLDEN_EXAMPLES, type GoldenExample, type ThemeBand } from "./examples";
import { rulesFor } from "./rules";

export { GOLDEN_EXAMPLES, type GoldenExample, type ThemeBand } from "./examples";
export { GOLDEN_SET_RULES, rulesFor, type GoldenRule } from "./rules";

/** Themes the display layer currently N/As — still stored, excluded from default MAE. */
export const EVAL_EXCLUDED_THEMES = new Set(["camera_on"]);

export function goldenPassEnabled(env?: { SCORECARD_GOLDEN_PASS?: string }): boolean {
  const raw = (env?.SCORECARD_GOLDEN_PASS ?? process.env.SCORECARD_GOLDEN_PASS ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

/**
 * Map a 0–10 theme grade onto the human 0/1/2 band.
 * 0–2 absent, 3–7 adequate, 8–10 excellent.
 */
export function themeBandFromGrade(grade: number): ThemeBand {
  if (!Number.isFinite(grade) || grade <= 2) return 0;
  if (grade >= 8) return 2;
  return 1;
}

/** Midpoint of a human band on the 0–10 grade scale. */
export function targetGradeFromBand(band: ThemeBand): number {
  return band * 5;
}

export function selectGoldenExamples(opts: {
  seMotion?: SeMotion | string | null;
  callType?: CallType | string | null;
}): GoldenExample[] {
  const motion = canonicalizeSeMotion(opts.seMotion);
  const callType = typeof opts.callType === "string" ? opts.callType.trim() : "";
  const byMotion = GOLDEN_EXAMPLES.filter((e) => e.seMotion === motion);
  const byProfile = callType ? byMotion.filter((e) => e.callType === callType) : [];
  if (byProfile.length) return byProfile;
  // Discovery has no seed examples yet — pass rules only, never Shamron/Nitish demo tables.
  if (callType === "discovery") return [];
  if (byMotion.length) return byMotion;
  return GOLDEN_EXAMPLES;
}

export function humanOverallForExample(
  example: GoldenExample,
  opts?: { includeCameraOn?: boolean },
): { overall: number; includedCredits: number; missingThemes: string[] } {
  const profile = profileFor(example.callType, example.seMotion);
  return humanOverallAgainstProfile(example, profile, opts);
}

export function humanOverallAgainstProfile(
  example: GoldenExample,
  profile: QipProfile,
  opts?: { includeCameraOn?: boolean },
): { overall: number; includedCredits: number; missingThemes: string[] } {
  const includeCamera = !!opts?.includeCameraOn;
  let gp = 0;
  let credits = 0;
  const missingThemes: string[] = [];
  for (const theme of profile.themes) {
    if (!includeCamera && theme.key === "camera_on") continue;
    const band = example.themeBands[theme.key];
    if (band == null) {
      missingThemes.push(theme.key);
      continue;
    }
    gp += targetGradeFromBand(band) * theme.credit;
    credits += theme.credit;
  }
  return {
    overall: credits ? Math.round((gp / credits) * 100) / 100 : 0,
    includedCredits: credits,
    missingThemes,
  };
}

export interface ThemeComparison {
  themeKey: string;
  humanBand: ThemeBand;
  aiGrade: number | null;
  aiBand: ThemeBand | null;
  bandDelta: number | null;
  gradeDelta: number | null;
}

export interface GoldenComparison {
  exampleId: string;
  themeCount: number;
  exactBandMatch: number;
  exactMatchRate: number;
  bandMae: number;
  gradeMae: number;
  themes: ThemeComparison[];
}

export function compareScorecardToGolden(
  example: GoldenExample,
  lines: Array<{ themeKey: string; grade?: number | null; evidenceUnavailable?: boolean; modelOmitted?: boolean }>,
  opts?: { includeCameraOn?: boolean },
): GoldenComparison {
  const byKey = new Map(lines.map((l) => [l.themeKey, l]));
  const themes: ThemeComparison[] = [];
  for (const [themeKey, humanBand] of Object.entries(example.themeBands)) {
    if (!opts?.includeCameraOn && EVAL_EXCLUDED_THEMES.has(themeKey)) continue;
    const line = byKey.get(themeKey);
    const excluded = !line || line.evidenceUnavailable || line.modelOmitted;
    const aiGrade = excluded ? null : typeof line.grade === "number" ? line.grade : null;
    const aiBand = aiGrade == null ? null : themeBandFromGrade(aiGrade);
    themes.push({
      themeKey,
      humanBand,
      aiGrade,
      aiBand,
      bandDelta: aiBand == null ? null : aiBand - humanBand,
      gradeDelta: aiGrade == null ? null : aiGrade - targetGradeFromBand(humanBand),
    });
  }
  const scored = themes.filter((t) => t.aiBand != null && t.bandDelta != null && t.gradeDelta != null);
  const exactBandMatch = scored.filter((t) => t.aiBand === t.humanBand).length;
  const bandMae =
    scored.length === 0
      ? 0
      : scored.reduce((acc, t) => acc + Math.abs(t.bandDelta as number), 0) / scored.length;
  const gradeMae =
    scored.length === 0
      ? 0
      : scored.reduce((acc, t) => acc + Math.abs(t.gradeDelta as number), 0) / scored.length;
  return {
    exampleId: example.id,
    themeCount: scored.length,
    exactBandMatch,
    exactMatchRate: scored.length ? exactBandMatch / scored.length : 0,
    bandMae: Math.round(bandMae * 100) / 100,
    gradeMae: Math.round(gradeMae * 100) / 100,
    themes,
  };
}

function formatExampleTable(example: GoldenExample): string {
  const rows = Object.entries(example.themeBands)
    .filter(([key]) => key !== "camera_on")
    .map(([key, band]) => `  ${key}=${band}`)
    .join("\n");
  return [
    `${example.seName} · ${example.seMotion === "new_business" ? "hunting" : "expansion"} · ${example.callType}`,
    example.notes ? `  note: ${example.notes}` : "",
    "  human theme scores (0 absent / 1 adequate / 2 excellent):",
    rows,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Compact calibration block for the third-pass prompt. */
export function formatGoldenCalibrationPrompt(opts: {
  seMotion?: SeMotion | string | null;
  callType?: CallType | string | null;
}): string {
  const examples = selectGoldenExamples(opts);
  const motion = canonicalizeSeMotion(opts.seMotion);
  const callType = (opts.callType || "") as CallType;
  const rules = rulesFor(motion, callType);
  const exampleBlock = examples.length
    ? ["Worked examples for this motion/profile:", ...examples.map(formatExampleTable)]
    : [
        "No worked examples for this profile yet — apply the rules above to THIS transcript only. Do not copy hunting-demo score tables.",
      ];
  return [
    "=== HUMAN GOLDEN-SET CALIBRATION (not this call) ===",
    "These are director-scored calls. Copy the BAR, not the numbers. Score THIS transcript.",
    "",
    "Rules:",
    ...rules.map((r) => `- ${r.text}`),
    "",
    ...exampleBlock,
    "=== END GOLDEN SET ===",
  ].join("\n");
}
