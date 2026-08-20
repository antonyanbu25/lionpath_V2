import { initThinkingOrbs } from "./thinking-orb.js";

/** @typedef {"small" | "medium" | "large"} OrbitSpinnerSize */

const SIZE_CLASS = {
  small: "dew-orbit-spinner--small",
  medium: "dew-orbit-spinner--medium",
  large: "dew-orbit-spinner--large",
};

function escapeAttribute(value) {
  return String(value).replace(/"/g, "&quot;");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function initSoon(root) {
  if (typeof document === "undefined") return;
  const scope = root || document;
  const run = () => initThinkingOrbs(scope);
  if (typeof queueMicrotask === "function") {
    queueMicrotask(run);
    return;
  }
  setTimeout(run, 0);
}

/**
 * @param {OrbitSpinnerSize} [size]
 * @param {{ className?: string, label?: string }} [opts]
 */
export function renderOrbitSpinner(size = "medium", opts = {}) {
  const sizeClass = SIZE_CLASS[size] || SIZE_CLASS.medium;
  const extra = opts.className ? ` ${opts.className}` : "";
  const label = opts.label
    ? ` aria-label="${escapeAttribute(opts.label)}"`
    : ' aria-hidden="true"';

  initSoon();
  return `<div class="thinking-orb dew-orbit-spinner ${sizeClass}${extra}" data-thinking-orb role="status"${label}></div>`;
}

/**
 * @param {OrbitSpinnerSize} [size]
 * @param {{ className?: string, label?: string }} [opts]
 * @returns {HTMLElement}
 */
export function createOrbitSpinner(size = "medium", opts = {}) {
  const wrap = document.createElement("div");
  wrap.innerHTML = renderOrbitSpinner(size, opts).trim();
  initThinkingOrbs(wrap);
  return /** @type {HTMLElement} */ (wrap.firstElementChild);
}

/** Loading panel with orbit spinner + message (replaces fw-spinner panels). */
export function renderLoadingPanel(message = "Loading…") {
  const safe = escapeHtml(message);
  return `<div class="dew-loading-panel" role="status" aria-live="polite">
    ${renderOrbitSpinner("medium")}
    <span class="muted">${safe}</span>
  </div>`;
}
