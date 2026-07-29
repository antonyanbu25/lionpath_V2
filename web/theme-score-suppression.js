/**
 * Per-theme QIP score display suppression (QIP_PROFILES §6).
 * Composite maths use stored scores; only individual theme numbers are hidden.
 */

import { themeSuppressionManifest as bundledManifest } from "./theme-suppression-data.js";

export const THEME_SCORE_SUPPRESSION_MESSAGE =
  "Not shown: this theme's scoring is still stabilising.";

/** @type {Set<string>} */
let suppressedThemes = new Set();
/** @type {object|null} */
let activeManifest = null;

function applyManifest(manifest) {
  if (!manifest?.runId) {
    throw new Error(
      "Theme score suppression manifest missing or invalid. " +
        "Run: npx tsx web/scripts/generate-theme-suppression.mjs",
    );
  }
  activeManifest = manifest;
  suppressedThemes = new Set(manifest.suppressedThemes || []);
}

applyManifest(bundledManifest);

/** Fail loudly at app startup if the 4.1′ artifact was not bundled. */
export function assertThemeScoreSuppressionReady() {
  if (!activeManifest?.runId) {
    throw new Error(
      "QIP theme score suppression is not configured. no consistency run bundled. " +
        "Run: npx tsx web/scripts/generate-theme-suppression.mjs",
    );
  }
  return activeManifest;
}

/** @param {string} themeKey */
export function isThemeScoreSuppressed(themeKey) {
  return suppressedThemes.has(themeKey);
}

export function getThemeScoreSuppressionMeta() {
  return activeManifest;
}

/** @internal Tests only. restore bundled manifest with __resetThemeSuppressionForTests(). */
export function __setThemeSuppressionForTests(manifest) {
  applyManifest(manifest);
}

export function __resetThemeSuppressionForTests() {
  applyManifest(bundledManifest);
}
