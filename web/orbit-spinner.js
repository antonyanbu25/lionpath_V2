/**
 * Themed "SPINNER ORBITS" loading animation (inspired by Alex Warnes / CodePen jXYYKL).
 * Nested rings rotate at different speeds with satellite dots tracing circular paths.
 */

/** @typedef {"small" | "medium" | "large"} OrbitSpinnerSize */

const SIZE_CLASS = {
  small: "dew-orbit-spinner--small",
  medium: "dew-orbit-spinner--medium",
  large: "dew-orbit-spinner--large",
};

/**
 * @param {OrbitSpinnerSize} [size]
 * @param {{ hollowCore?: boolean, className?: string, label?: string }} [opts]
 */
export function renderOrbitSpinner(size = "medium", opts = {}) {
  const sizeClass = SIZE_CLASS[size] || SIZE_CLASS.medium;
  const extra = opts.className ? ` ${opts.className}` : "";
  const hollow = opts.hollowCore ? " dew-orbit-spinner--hollow-core" : "";
  const label = opts.label
    ? ` aria-label="${String(opts.label).replace(/"/g, "&quot;")}"`
    : ' aria-hidden="true"';

  const core = opts.hollowCore ? "" : '<span class="dew-orbit-core"></span>';

  return `<div class="dew-orbit-spinner ${sizeClass}${hollow}${extra}" role="status"${label}>
  <div class="dew-orbit-ring dew-orbit-ring--1"><span class="dew-orbit-sat"></span></div>
  <div class="dew-orbit-ring dew-orbit-ring--2"><span class="dew-orbit-sat"></span></div>
  <div class="dew-orbit-ring dew-orbit-ring--3"><span class="dew-orbit-sat"></span></div>
  ${core}
</div>`;
}

/**
 * @param {OrbitSpinnerSize} [size]
 * @param {{ hollowCore?: boolean, className?: string, label?: string }} [opts]
 * @returns {HTMLElement}
 */
export function createOrbitSpinner(size = "medium", opts = {}) {
  const wrap = document.createElement("div");
  wrap.innerHTML = renderOrbitSpinner(size, opts).trim();
  return /** @type {HTMLElement} */ (wrap.firstElementChild);
}

/** Loading panel with orbit spinner + message (replaces fw-spinner panels). */
export function renderLoadingPanel(message = "Loading…") {
  const safe = String(message).replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  return `<div class="dew-loading-panel" role="status" aria-live="polite">
    ${renderOrbitSpinner("medium")}
    <span class="muted">${safe}</span>
  </div>`;
}
