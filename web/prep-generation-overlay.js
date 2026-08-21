/**
 * Full-page brief / call analysis generation overlay — Dew theme, thinking orb, stage updates.
 */

import { hydrateThinkingOrbs } from "./thinking-orb.js";
import { $, show } from "./shared.js";
import { hydrateDecryptTexts } from "./decrypt-text.js";

const FADE_MS = 420;
const REVEAL_MS = 480;
let hideSeq = 0;
let hideTimer = 0;

export const PREP_GEN_THEME = {
  eyebrow: "Janus · Pre-call",
  title: "Building your brief",
  hint: "Research, enrichment, and synthesis run in the background — usually under a minute.",
};

export const POSTCALL_GEN_THEME = {
  eyebrow: "Janus · Post-call",
  title: "Analysing your call",
  hint: "Transcript analysis, qualification, and scoring run in the background — usually 40–90 seconds.",
};

export const CALL_LOAD_THEME = {
  eyebrow: "Janus · Call record",
  title: "Loading your call",
  hint: "Fetching analysis, scorecard, and timeline from your workspace — usually a few seconds.",
};

function overlayEl() {
  if (typeof document === "undefined") return null;
  return $("prep-gen-overlay");
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

/** @param {Partial<typeof PREP_GEN_THEME>} theme */
function applyGenOverlayTheme(theme = PREP_GEN_THEME) {
  if (typeof document === "undefined") return;
  const t = { ...PREP_GEN_THEME, ...theme };
  const eyebrow = $("prep-gen-eyebrow");
  const title = $("prep-gen-title");
  const hint = $("prep-gen-hint");
  if (eyebrow) {
    eyebrow.setAttribute("data-decrypt-static", "");
    eyebrow.textContent = t.eyebrow;
  }
  if (title) title.textContent = t.title;
  if (hint) hint.textContent = t.hint;
}

/** @param {number} pct 0–100 */
function setBarPct(pct) {
  if (typeof document === "undefined") return;
  const bar = $("prep-gen-bar");
  if (!bar) return;
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  bar.style.width = `${clamped}%`;
  const track = bar.closest(".prep-gen-progress-track");
  track?.setAttribute("aria-valuenow", String(clamped));
}

function setStageDecryptMode(stage, message, theme) {
  if (!stage) return;
  const isPostCall = theme?.eyebrow === POSTCALL_GEN_THEME.eyebrow;
  const isProspectsRead = /^Prospects read:/i.test(String(message || ""));
  if (!isPostCall || isProspectsRead) {
    stage.setAttribute("data-decrypt", isProspectsRead ? "loop" : "");
    if (isProspectsRead) stage.setAttribute("data-decrypt-loop", "");
    else stage.removeAttribute("data-decrypt-loop");
    hydrateDecryptTexts(stage);
    return;
  }

  stage.removeAttribute("data-decrypt");
  stage.removeAttribute("data-decrypt-loop");
  if (stage.__decryptState) {
    stage.__decryptState.cancelled = true;
    if (stage.__decryptState.raf) cancelAnimationFrame(stage.__decryptState.raf);
    if (stage.__decryptState.timer) clearTimeout(stage.__decryptState.timer);
  }
  stage.__decryptObserver?.disconnect?.();
  stage.__decryptObserver = null;
  stage.__decryptMounted = false;
  stage.__decryptLoop = false;
}

/**
 * Show the generation overlay.
 * @param {{ message?: string, pct?: number, theme?: Partial<typeof PREP_GEN_THEME> }} [opts]
 */
export function showPrepGenOverlay(opts = {}) {
  const el = overlayEl();
  if (!el) return;
  hideSeq += 1;
  if (hideTimer) {
    window.clearTimeout(hideTimer);
    hideTimer = 0;
  }
  applyGenOverlayTheme(opts.theme);
  const stage = $("prep-gen-stage");
  setStageDecryptMode(stage, opts.message, opts.theme);
  if (stage && opts.message) stage.textContent = opts.message;
  setBarPct(opts.pct ?? 8);
  hydrateThinkingOrbs(el);
  el.classList.remove("prep-gen-overlay-exit", "prep-gen-overlay-exit-active");
  show(el, true);
  document.body?.classList.add("prep-gen-lock");
  requestAnimationFrame(() => el.classList.add("prep-gen-overlay-active"));
}

/** @param {{ message?: string, pct?: number }} [opts] */
export function updatePrepGenOverlay(opts = {}) {
  const stage = $("prep-gen-stage");
  const eyebrow = $("prep-gen-eyebrow");
  const isPostCall = eyebrow?.textContent === POSTCALL_GEN_THEME.eyebrow;
  if (stage && opts.message) setStageDecryptMode(stage, opts.message, isPostCall ? POSTCALL_GEN_THEME : PREP_GEN_THEME);
  if (stage && opts.message) stage.textContent = opts.message;
  if (opts.pct != null) setBarPct(opts.pct);
}

/** Whether the full-page generation overlay is visible. */
export function isGenOverlayActive() {
  const el = overlayEl();
  return !!el && !el.hidden && el.classList.contains("prep-gen-overlay-active");
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
    document.body?.classList.remove("prep-gen-lock");
    onHidden?.();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const seq = ++hideSeq;
    el.classList.add("prep-gen-overlay-exit");
    requestAnimationFrame(() => el.classList.add("prep-gen-overlay-exit-active"));
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      if (seq !== hideSeq) {
        resolve();
        return;
      }
      show(el, false);
      el.classList.remove(
        "prep-gen-overlay-active",
        "prep-gen-overlay-exit",
        "prep-gen-overlay-exit-active",
      );
      document.body?.classList.remove("prep-gen-lock");
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
