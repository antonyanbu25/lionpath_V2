/**
 * Shared multi-stage pipeline progress card (pre-call + post-call).
 *
 * Extracted from postcall.js so the pre-call brief can show real per-stage progress
 * instead of one frozen status string. Keeps the postcall-* class names because
 * postcall.css is loaded globally from index.html, so both views style for free.
 *
 * A step is `{ id?, label, status }` where status is
 * "pending" | "active" | "done" | "error" | "skipped".
 */

import { esc, $, show } from "./shared.js";

/** @param {string} label @param {string} status @param {number} index */
export function renderProgressStep(label, status, index) {
  const icon =
    status === "done"
      ? "✓"
      : status === "active"
        ? "…"
        : status === "error"
          ? "!"
          : status === "skipped"
            ? "–"
            : String(index + 1);
  const cls =
    status === "done"
      ? "postcall-step-done"
      : status === "active"
        ? "postcall-step-active"
        : status === "error"
          ? "postcall-step-error"
          : "postcall-step-pending";
  return `<li class="postcall-step ${cls}"><span class="postcall-step-icon" aria-hidden="true">${icon}</span><span class="postcall-step-label">${esc(label)}</span></li>`;
}

/**
 * Card markup for a step list. `meta` overrides the default "N of M complete".
 * @param {{label: string, status: string}[]} steps
 * @param {{ title?: string, meta?: string }} [opts]
 */
export function renderPipelineCard(steps, opts = {}) {
  const title = opts.title || "Pipeline";
  // Skipped stages are resolved, so count them as complete for the bar.
  const doneCount = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;
  const meta = opts.meta ?? `${doneCount} of ${steps.length} complete`;
  return `
    <div class="postcall-pipeline-card">
      <div class="postcall-pipeline-head">
        <span class="prep-form-eyebrow">${esc(title)}</span>
        <span class="muted postcall-pipeline-meta">${esc(meta)}</span>
      </div>
      <div class="postcall-pipeline-bar" role="progressbar" aria-valuenow="${esc(String(pct))}" aria-valuemin="0" aria-valuemax="100">
        <span style="width:${pct}%"></span>
      </div>
      <ol class="postcall-step-list">${steps.map((s, i) => renderProgressStep(s.label, s.status, i)).join("")}</ol>
    </div>`;
}

/**
 * Render the card into a host element and reveal it.
 * @param {string} hostId
 * @param {{label: string, status: string}[]} steps
 * @param {{ title?: string, meta?: string }} [opts]
 */
export function showPipelineProgress(hostId, steps, opts) {
  const host = $(hostId);
  if (!host) return;
  host.innerHTML = renderPipelineCard(steps, opts);
  show(host, true);
}

/** @param {string} hostId */
export function hidePipelineProgress(hostId) {
  show($(hostId), false);
}

/**
 * Single-line stage progress (post-call progressive fill).
 * Keeps one persistent affordance without replacing rendered content.
 * @param {string} hostId
 * @param {string} message
 * @param {{ title?: string }} [opts]
 */
export function showInlineStageProgress(hostId, message, opts = {}) {
  const host = $(hostId);
  if (!host) return;
  const title = opts.title || "Call analysis";
  host.innerHTML = `
    <div class="postcall-inline-progress" role="status" aria-live="polite" aria-busy="true">
      <span class="postcall-inline-progress-dot" aria-hidden="true"></span>
      <div class="postcall-inline-progress-copy">
        <span class="prep-form-eyebrow">${esc(title)}</span>
        <span class="postcall-inline-progress-label">${esc(message || "Working…")}</span>
      </div>
    </div>`;
  show(host, true);
}
