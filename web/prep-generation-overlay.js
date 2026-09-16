/**
 * Full-page brief / call analysis generation overlay — Dew theme, orbit spinner, stage updates.
 */

import { $, show } from "./shared.js";

const FADE_MS = 420;
const REVEAL_MS = 480;

export const PREP_GEN_THEME = {
  eyebrow: "SE Labs · Pre-call",
  title: "Building your brief",
  hint: "Research, enrichment, and synthesis run in the background — usually under a minute.",
};

export const POSTCALL_GEN_THEME = {
  eyebrow: "SE Labs · Post-call",
  title: "Analysing your call",
  hint: "Transcript analysis, qualification, and scoring run in the background — usually 40–90 seconds.",
};

export const CALL_LOAD_THEME = {
  eyebrow: "SE Labs · Call record",
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
  if (eyebrow) eyebrow.textContent = t.eyebrow;
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

/**
 * Show the generation overlay.
 * @param {{ message?: string, pct?: number, theme?: Partial<typeof PREP_GEN_THEME> }} [opts]
 */
export function showPrepGenOverlay(opts = {}) {
  const el = overlayEl();
  if (!el) return;
  applyGenOverlayTheme(opts.theme);
  const stage = $("prep-gen-stage");
  if (stage && opts.message) stage.textContent = opts.message;
  setBarPct(opts.pct ?? 8);
  el.classList.remove("prep-gen-overlay-exit", "prep-gen-overlay-exit-active");
  show(el, true);
  document.body?.classList.add("prep-gen-lock");
  requestAnimationFrame(() => el.classList.add("prep-gen-overlay-active"));
}

/** @param {{ message?: string, pct?: number }} [opts] */
export function updatePrepGenOverlay(opts = {}) {
  const stage = $("prep-gen-stage");
  if (stage && opts.message) stage.textContent = opts.message;
  if (opts.pct != null) setBarPct(opts.pct);
}

/**
 * Override the overlay's static expectation-setting hint (the "usually N seconds" line
 * set once by applyGenOverlayTheme and never touched again). UAT-004: that line kept
 * asserting a timeframe verbatim for the full wait, so once real elapsed time ran past
 * it, the copy was simply wrong. Callers swap it for an honest "still working" notice
 * instead of continuing to claim a window that has already passed — see
 * startPipelineAutoAdvance's `onOverrun`.
 * @param {string} text
 */
export function setPrepGenHint(text) {
  if (typeof document === "undefined" || !text) return;
  const hint = $("prep-gen-hint");
  if (hint) hint.textContent = text;
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
    el.classList.add("prep-gen-overlay-exit");
    requestAnimationFrame(() => el.classList.add("prep-gen-overlay-exit-active"));
    window.setTimeout(() => {
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

/**
 * Pure lookup for the client-side staged-timer (UAT-001b / UAT-004): given an ordered
 * `plan` of steps with their expected real-world duration (`ms`, grounded in measured
 * per-pass latencies — see callers), and how much real time (`elapsedMs`) has actually
 * passed, returns which plan entry should be showing right now.
 *
 * Never returns an index past what its expected cumulative duration justifies (so it
 * can't claim a stage finished before its typical time), and flags `overrun: true` once
 * total elapsed time exceeds every planned duration — the point at which any "usually
 * N seconds" framing shown alongside it has already become false and should be retired
 * rather than repeated.
 *
 * @param {Array<{ id: string, ms: number, detail?: string }>} plan
 * @param {number} elapsedMs
 * @returns {{ index: number, overrun: boolean }}
 */
export function planIndexAtElapsed(plan, elapsedMs) {
  if (!plan?.length) return { index: 0, overrun: false };
  let cursor = 0;
  let index = 0;
  for (let i = 0; i < plan.length - 1; i++) {
    cursor += plan[i].ms;
    if (elapsedMs >= cursor) index = i + 1;
  }
  const total = plan.reduce((sum, step) => sum + step.ms, 0);
  return { index, overrun: elapsedMs > total };
}

/**
 * Advance a step-progress tracker (createPrepProgress / createPostcallProgress) through
 * a REAL plan of server-side passes over time. Exists because neither the pre-call
 * synthesize request nor the post-call generate request gives any incremental signal
 * back to the client — one JSON response at the end, no SSE, no polling route (checked
 * worker/src/index.ts and worker/src/node-server.ts before adding this) — so a long
 * single fetch used to leave the stage text and progress bar frozen for its entire
 * duration.
 *
 * A plan entry may repeat the same `id` as the previous one (to just re-narrate the
 * copy for a step that is honestly still in progress, e.g. pre-call's "synthesize"),
 * or use a new `id` already present in `progress.steps` (to move a discrete bucket
 * forward, e.g. post-call's analyzing → verifying → calibrating). The final plan entry
 * is only ever entered, never marked "done" — that transition belongs to the real
 * response landing.
 *
 * @param {{ steps: unknown[], set: Function, advance: Function, setDetail: Function, clearDetail: Function }} progress
 * @param {Array<{ id: string, ms: number, detail?: string }>} plan
 * @param {{ onOverrun?: () => void, tickMs?: number }} [opts]
 * @returns {() => void} stop function — call as soon as the real response lands
 */
export function startPipelineAutoAdvance(progress, plan, opts = {}) {
  if (typeof window === "undefined" || !progress || !plan?.length) return () => {};
  const { onOverrun, tickMs = 200 } = opts;
  const t0 = Date.now();
  let idx = 0;
  let firedOverrun = false;
  let stopped = false;

  const enter = (i) => {
    const step = plan[i];
    if (!step) return;
    if (step.detail) progress.setDetail(step.detail);
    else progress.clearDetail();
  };
  enter(0);

  const timerId = window.setInterval(() => {
    if (stopped) return;
    const { index: target, overrun } = planIndexAtElapsed(plan, Date.now() - t0);
    while (idx < target) {
      const from = plan[idx];
      const to = plan[idx + 1];
      if (to.id !== from.id) progress.advance(from.id, to.id);
      idx += 1;
      enter(idx);
    }
    if (overrun && !firedOverrun) {
      firedOverrun = true;
      onOverrun?.();
    }
  }, tickMs);

  return () => {
    stopped = true;
    window.clearInterval(timerId);
  };
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
