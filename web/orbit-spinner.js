/**
 * Backwards-compatible orbit spinner API.
 *
 * The portal's canonical loading animation is the thinking-orb canvas. Keep the
 * old exports so existing imports continue to work while all callers receive
 * the same [data-thinking-orb] animation.
 */

import {
  createThinkingOrb,
  renderLoadingPanel as renderThinkingOrbLoadingPanel,
  renderThinkingOrb,
} from "./thinking-orb.js";

function normalizeOptions(opts = {}) {
  const size = Number(opts.size || opts.diameter || 64);
  return {
    ...opts,
    state: opts.state || "solving",
    size: Number.isFinite(size) && size > 0 ? size : 64,
  };
}

export function renderOrbitSpinner(opts = {}) {
  return renderThinkingOrb(normalizeOptions(opts));
}

export function createOrbitSpinner(opts = {}) {
  return createThinkingOrb(normalizeOptions(opts));
}

export function renderLoadingPanel(message = "Loading…", opts = {}) {
  return renderThinkingOrbLoadingPanel(message, normalizeOptions(opts));
}
