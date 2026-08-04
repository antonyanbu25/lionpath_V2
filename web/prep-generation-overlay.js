/**
 * Full-page pre-call brief generation overlay — Dew theme, Freshworks mark, stage updates.
 */

import { $, show } from "./shared.js";

const FADE_MS = 420;
const REVEAL_MS = 480;

function overlayEl() {
  return $("prep-gen-overlay");
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

/** @param {number} pct 0–100 */
function setBarPct(pct) {
  const bar = $("prep-gen-bar");
  if (!bar) return;
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  bar.style.width = `${clamped}%`;
  const track = bar.closest(".prep-gen-progress-track");
  track?.setAttribute("aria-valuenow", String(clamped));
}

/**
 * Show the generation overlay.
 * @param {{ message?: string, pct?: number }} [opts]
 */
export function showPrepGenOverlay(opts = {}) {
  const el = overlayEl();
  if (!el) return;
  const stage = $("prep-gen-stage");
  if (stage && opts.message) stage.textContent = opts.message;
  setBarPct(opts.pct ?? 8);
  el.classList.remove("prep-gen-overlay-exit", "prep-gen-overlay-exit-active");
  show(el, true);
  document.body.classList.add("prep-gen-lock");
  requestAnimationFrame(() => el.classList.add("prep-gen-overlay-active"));
}

/** @param {{ message?: string, pct?: number }} [opts] */
export function updatePrepGenOverlay(opts = {}) {
  const stage = $("prep-gen-stage");
  if (stage && opts.message) stage.textContent = opts.message;
  if (opts.pct != null) setBarPct(opts.pct);
}

/**
 * Fade out overlay, then run callback (e.g. reveal brief).
 * @param {( () => void ) | undefined} [onHidden]
 * @returns {Promise<void>}
 */
export function hidePrepGenOverlay(onHidden) {
  const el = overlayEl();
  if (!el || el.hidden) {
    onHidden?.();
    return Promise.resolve();
  }

  if (prefersReducedMotion()) {
    show(el, false);
    el.classList.remove("prep-gen-overlay-active", "prep-gen-overlay-exit", "prep-gen-overlay-exit-active");
    document.body.classList.remove("prep-gen-lock");
    onHidden?.();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    el.classList.add("prep-gen-overlay-exit");
    requestAnimationFrame(() => el.classList.add("prep-gen-overlay-exit-active"));
    window.setTimeout(() => {
      show(el, false);
      el.classList.remove(
        "prep-gen-overlay-active",
        "prep-gen-overlay-exit",
        "prep-gen-overlay-exit-active",
      );
      document.body.classList.remove("prep-gen-lock");
      onHidden?.();
      resolve();
    }, FADE_MS);
  });
}

/** Progress fraction from pipeline step statuses. */
export function prepStepsToPct(steps) {
  if (!steps?.length) return 0;
  let score = 0;
  for (const s of steps) {
    if (s.status === "done" || s.status === "skipped") score += 1;
    else if (s.status === "active") score += 0.35;
  }
  return Math.round((score / steps.length) * 100);
}

/** Animate brief result into view after overlay hides. */
export function revealPrepResultView() {
  const rv = $("prep-result-view");
  if (!rv || rv.hidden) return;

  if (prefersReducedMotion()) {
    rv.classList.remove("prep-result-enter", "prep-result-enter-active");
    return;
  }

  rv.classList.add("prep-result-enter");
  rv.classList.remove("prep-result-enter-active");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => rv.classList.add("prep-result-enter-active"));
  });
  window.setTimeout(() => {
    rv.classList.remove("prep-result-enter", "prep-result-enter-active");
  }, REVEAL_MS + 80);
}

export { FADE_MS as PREP_GEN_FADE_MS };
