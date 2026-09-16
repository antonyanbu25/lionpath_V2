/**
 * Discovery incident-theme applicability (QIP §3).
 *
 * On discovery (NB and expansion), objections / comp_pitch / case_study measure
 * incidents, not habits. If the moment never occurred, mark evidenceUnavailable
 * (UI N/A, out of denominator). A 0 stays in the denominator only when the
 * incident DID happen and the SE fumbled it.
 *
 * Decision (deterministic, no extra LLM pass):
 *   - any SP > 0 → scored (they did something)
 *   - all 0s + quotes that cite a pushback / competitor / case study → scored miss
 *   - all 0s + no incident evidence → N/A
 *
 * Re-apply after golden polarization so courtesy 1s that collapse to 0s with no
 * incident quotes become N/A rather than a miss.
 */

export const DISCOVERY_INCIDENT_THEME_KEYS = ["objections", "comp_pitch", "case_study"] as const;
export type DiscoveryIncidentThemeKey = (typeof DISCOVERY_INCIDENT_THEME_KEYS)[number];

export const DISCOVERY_INCIDENT_NA_REASONS: Record<DiscoveryIncidentThemeKey, string> = {
  objections: "No objection or customer pushback came up on this call.",
  comp_pitch: "No competitor or competitive comparison came up on this call.",
  case_study: "No case study or customer reference was told on this call.",
};

const INCIDENT_QUOTE_PATTERNS: Record<DiscoveryIncidentThemeKey, RegExp> = {
  objections:
    /\b(object(?:ion|ed)|push[\s-]?back|concern(?:ed|s)?|worried|worry|hesitat(?:e|ion|ed)|too expensive|already (?:have|using)|doesn'?t work|won'?t work|can'?t (?:do|afford)|skeptic|blocker|deal[\s-]?breaker|not convinced|why (?:would|should) we|that'?s a (?:problem|risk)|not ready|need to think)\b/i,
  comp_pitch:
    /\b(competitor|competitive|competition|versus|\bvs\.?\b|compared to|other vendor|zendesk|servicenow|salesforce|hubspot|intercom|point solution)\b/i,
  case_study:
    /\b(case study|customer stor(?:y|ies)|another customer|similar (?:company|customer|account)|we (?:helped|worked with)|for example at|reference (?:customer|account))\b/i,
};

export function isDiscoveryCallType(callType: string | null | undefined): boolean {
  return String(callType || "").trim() === "discovery";
}

export function isDiscoveryIncidentTheme(themeKey: string): themeKey is DiscoveryIncidentThemeKey {
  return (DISCOVERY_INCIDENT_THEME_KEYS as readonly string[]).includes(themeKey);
}

export function discoveryIncidentNaReason(themeKey: string): string {
  if (isDiscoveryIncidentTheme(themeKey)) return DISCOVERY_INCIDENT_NA_REASONS[themeKey];
  return DISCOVERY_INCIDENT_NA_REASONS.objections;
}

interface EvidenceQuote {
  quote?: string | null;
}

interface SubParamLike {
  score?: number | null;
  evidence?: EvidenceQuote[] | null;
}

export interface DiscoveryIncidentLine {
  themeKey: string;
  subParameters: SubParamLike[];
  grade: number;
  evidenceUnavailable: boolean;
  modelOmitted?: boolean;
  coachingNote: string | null;
  notApplicableReason?: string | null;
  confidence: number | null;
}

function paddedScores(subParameters: SubParamLike[] | undefined): number[] {
  return Array.from({ length: 5 }, (_, i) => {
    const n = subParameters?.[i]?.score;
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  });
}

function quoteBlob(subParameters: SubParamLike[] | undefined): string {
  return (subParameters || [])
    .flatMap((sp) => sp.evidence || [])
    .map((e) => String(e.quote || "").trim())
    .filter(Boolean)
    .join("\n");
}

/** True when the incident happened (score it, including a fumbled 0). */
export function discoveryIncidentOccurred(themeKey: string, subParameters: SubParamLike[] | undefined): boolean {
  if (!isDiscoveryIncidentTheme(themeKey)) return true;
  if (paddedScores(subParameters).some((s) => s > 0)) return true;
  const text = quoteBlob(subParameters);
  if (!text) return false;
  return INCIDENT_QUOTE_PATTERNS[themeKey].test(text);
}

/**
 * Mark discovery incident themes N/A when they never came up. Other profiles
 * and habit themes are unchanged. Set-only for N/A (does not un-N/A camera_on).
 */
export function applyDiscoveryIncidentApplicability<T extends DiscoveryIncidentLine>(
  profile: { key: string },
  lines: T[],
): T[] {
  if (!isDiscoveryCallType(profile.key)) return lines;
  return lines.map((line) => {
    if (!isDiscoveryIncidentTheme(line.themeKey)) return line;
    if (discoveryIncidentOccurred(line.themeKey, line.subParameters)) return line;
    const reason = DISCOVERY_INCIDENT_NA_REASONS[line.themeKey];
    return {
      ...line,
      evidenceUnavailable: true,
      grade: 0,
      notApplicableReason: reason,
      coachingNote: reason,
      confidence: 1,
    };
  });
}
