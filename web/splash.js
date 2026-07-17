/**
 * Lion splash — disabled (no first-visit animation).
 * Kept as a no-op module so existing script tags do not 404.
 */

function runSplash() {
  /* splash intentionally disabled */
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runSplash);
} else {
  runSplash();
}
