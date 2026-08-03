export const MODEL_OMITTED_THEME_REASON =
  "Model omitted this theme from the scorecard response — not scored.";
export const MODEL_OMITTED_CONFIDENCE = 0.25;

export const RESEARCH_NOT_EVIDENCED_REASON =
  "No pre-call research or account context referenced on this call.";

export const TRANSCRIPT_THEME_NOT_EVIDENCED_REASON =
  "Not enough evidence to score this theme from the transcript and materials on file.";

/** User-facing coaching note when a transcript-scorable theme has no evidence on the call. */
export function themeNotEvidencedReason(themeKey: string): string {
  if (themeKey === "research") return RESEARCH_NOT_EVIDENCED_REASON;
  return TRANSCRIPT_THEME_NOT_EVIDENCED_REASON;
}
