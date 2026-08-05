/**
 * End-user copy helpers — never expose internal pipeline/pass names in the UI.
 */

import {
  MODEL_OMITTED_THEME_REASON,
  themeNotEvidencedReason,
} from "./shared/qip-scorecard-normalize.js";
import { videoDependentThemeKeys } from "./rubric-profiles.js";

export const VIDEO_THEME_UNAVAILABLE_REASON =
  "No video recording — this theme requires visual evidence from the recording and cannot be scored from transcript alone.";

export const GENERIC_EVIDENCE_UNAVAILABLE_REASON =
  "Not enough evidence to score this theme from the transcript and materials on file.";

export const SLIDE_DECK_UNAVAILABLE_REASON =
  "No deck link or slide share detected on this call.";

/** Themes that only apply when video analysis has run (v2.1 profile). */
const VIDEO_ONLY_THEME_KEYS = new Set(["camera_on"]);

/**
 * User-facing N/A copy for a scorecard line — never default every gap to "needs video".
 * @param {object|null|undefined} line
 * @param {{ themes?: object[] }|null} [profile]
 */
export function resolveThemeNaReason(line, profile = null) {
  if (!line) return GENERIC_EVIDENCE_UNAVAILABLE_REASON;
  if (line.notApplicableReason) return sanitizeUserFacingCopy(line.notApplicableReason);
  const themeKey = String(line.themeKey || "");
  const videoThemes = profile ? new Set(videoDependentThemeKeys(profile)) : VIDEO_ONLY_THEME_KEYS;
  const transcriptScorable = !videoThemes.has(themeKey);
  if (line.coachingNote && (line.evidenceUnavailable || line.applicable === false)) {
    const note = sanitizeUserFacingCopy(line.coachingNote);
    if (note && note !== MODEL_OMITTED_THEME_REASON) return note;
  }
  if (line.modelOmitted) {
    if (transcriptScorable) return themeNotEvidencedReason(themeKey);
    return MODEL_OMITTED_THEME_REASON;
  }
  if (line.applicable === false && videoThemes.has(themeKey)) {
    return VIDEO_THEME_UNAVAILABLE_REASON;
  }
  if (line.evidenceUnavailable && videoThemes.has(themeKey)) {
    return VIDEO_THEME_UNAVAILABLE_REASON;
  }
  if (themeKey === "slide_deck" && line.evidenceUnavailable) {
    return SLIDE_DECK_UNAVAILABLE_REASON;
  }
  if (line.applicable === false) {
    return GENERIC_EVIDENCE_UNAVAILABLE_REASON;
  }
  return GENERIC_EVIDENCE_UNAVAILABLE_REASON;
}

export const VIDEO_ANALYSIS_PENDING_REASON =
  "Video was found but visual analysis is still processing — check back shortly.";

export const VIDEO_ANALYSIS_FAILED_REASON =
  "Visual analysis could not be completed for this recording.";

/** @type {[RegExp, string][]} */
const LEGACY_COPY_REPLACEMENTS = [
  [
    /No video recording — requires Pass 2 video evidence[^.]*\.?/gi,
    VIDEO_THEME_UNAVAILABLE_REASON,
  ],
  [
    /Video stream found but Pass 2 facts not ready[^.]*\.?/gi,
    VIDEO_ANALYSIS_PENDING_REASON,
  ],
  [/Pass 2 ran but camera_on_pct unavailable\.?/gi, "Camera state could not be determined from the recording."],
  [/Pass 2 vision:\s*/gi, "Video analysis: "],
  [/Pass 2 sampled camera-on/gi, "Recording showed camera on"],
  [/those need Pass 2\.?/gi, "those require video analysis."],
  [/either Pass 2 video or a VTT transcript/gi, "either video analysis or a VTT transcript"],
  [
    /Video was available, but Pass 2 did not produce share segments[^.]*\.?/gi,
    "Video was available, but visual analysis did not produce a share timeline for this call.",
  ],
  [
    /Pass 5 did not return a commit snapshot for this call[^.]*\.?/gi,
    "Technical commit has not been captured for this call yet. Re-run post-call analysis to extract it from the transcript.",
  ],
  [
    /Pass 4 MEDDPICC deltas, Pass 7 objections, and Pass 8 traction reasons appear here[^.]*\.?/gi,
    "MEDDPICC movement, objections, and traction reasons appear here after analysis on a linked deal.",
  ],
  [/Run Pass 4 qualification on a linked deal\.?/gi, "Run deal qualification on a linked deal."],
  [
    /Pass 7 did not return a MoM for this call[^.]*\.?/gi,
    "Minutes of meeting were not generated for this call, or summarisation was skipped. Re-run analysis to generate one.",
  ],
  [
    /Re-run post-call analysis\. Pass 6 extracts gaps[^.]*\.?/gi,
    "Re-run post-call analysis to extract product gaps from the transcript and call notes.",
  ],
  [
    /Technical commit snapshot appears after Pass 5 commit on a post-call\.?/gi,
    "Technical commit snapshot appears after post-call analysis on a linked deal.",
  ],
  [
    /What landed rows appear after Pass 6 analysis\.?/gi,
    "What landed rows appear after product signal analysis.",
  ],
  [/Technical commit \(Pass 5\) not yet on file/gi, "Technical commit not yet on file"],
  [/Complete Pass 5 technical commit assessment on this deal/gi, "Complete the technical commit assessment on this deal"],
];

/** @param {string|null|undefined} text */
export function sanitizeUserFacingCopy(text) {
  if (!text) return "";
  let out = String(text);
  for (const [pattern, replacement] of LEGACY_COPY_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\bPass [0-9]+\b/gi, "analysis").trim();
}
