/**
 * Thinking orb loading animation — vanilla JS wrapper around the vendored
 * thinking-orbs engine (web/vendor/thinking-orbs-engine.js, MIT, Jakub Antalik).
 * Replaces the old CSS planet-orbit spinner (orbit-spinner.js/css).
 *
 * The upstream package's React component is a thin shell around this engine:
 * a DPR-aware canvas, a rAF loop, IntersectionObserver/visibility gating,
 * `prefers-reduced-motion` fallback, and live theme detection. This module
 * replicates that shell 1:1 so behaviour matches <ThinkingOrb> exactly.
 *
 * Usage:
 *   import { createThinkingOrb, renderThinkingOrb, renderLoadingPanel } from "./thinking-orb.js";
 *   el.append(createThinkingOrb({ state: "solving", size: 64 }));
 *   host.innerHTML = renderThinkingOrb({ state: "working", size: 20 }); // auto-mounted
 *
 * Any <canvas class="thinking-orb"> inserted into the DOM (including static
 * markup in index.html) is mounted automatically via a MutationObserver.
 */

import { MODE_DRAWS, resolvePreset } from "./vendor/thinking-orbs-engine.js";

/** @typedef {"working"|"searching"|"solving"|"listening"|"connecting"|"weaving"|"composing"|"breathing"|"shaping"} OrbState */
/** @typedef {64 | 20} OrbSize */
/** @typedef {"auto" | "dark" | "light"} OrbTheme */

const STATE_LABELS = {
  working: "Working…",
  searching: "Searching…",
  solving: "Solving…",
  listening: "Listening…",
  connecting: "Connecting…",
  weaving: "Weaving…",
  composing: "Composing…",
  breathing: "Thinking…",
  shaping: "Shaping…",
};

/** Walk ancestors for data-theme / dark|light class (same convention as upstream). */
function detectDarkFromDom(el) {
  let node = el;
  while (node) {
    const attr = node.getAttribute && node.getAttribute("data-theme");
    if (attr === "dark") return true;
    if (attr === "light") return false;
    if (node.classList) {
      if (node.classList.contains("dark")) return true;
      if (node.classList.contains("light")) return false;
    }
    node = node.parentElement;
  }
  return null;
}

function prefersDark() {
  return typeof matchMedia === "undefined" || matchMedia("(prefers-color-scheme: dark)").matches;
}

function prefersReducedMotion() {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function escAttr(value) {
  return String(value).replace(/"/g, "&quot;");
}

/**
 * Mount the orb animation on a canvas. Returns an unmount function.
 * @param {HTMLCanvasElement} canvas
 * @param {{ state?: OrbState, size?: OrbSize, theme?: OrbTheme, speed?: number, paused?: boolean }} [opts]
 */
export function mountThinkingOrb(canvas, opts = {}) {
  if (!canvas || canvas.__thinkingOrbUnmount) return canvas?.__thinkingOrbUnmount ?? (() => {});
  const state = opts.state || canvas.dataset.orbState || "working";
  const size = /** @type {OrbSize} */ (Number(opts.size || canvas.dataset.orbSize || 64));
  const theme = opts.theme || canvas.dataset.orbTheme || "auto";
  const speed = opts.speed ?? 1;
  const paused = opts.paused ?? false;

  const dpr = Math.min(2, (typeof devicePixelRatio !== "undefined" && devicePixelRatio) || 1);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.style.display = "block";
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const { mode, speed: presetSpeed, opts: modeOpts } = resolvePreset(state, size);
  const draw = MODE_DRAWS[mode];
  const rate = presetSpeed * speed;

  let dark = theme === "dark" ? true : theme === "light" ? false : (detectDarkFromDom(canvas) ?? prefersDark());

  const renderFrame = (t) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    draw(ctx, size, t, dark, modeOpts);
  };

  const reduced = prefersReducedMotion();
  let rafId = 0;
  let running = false;
  let visible = true;

  const tick = () => {
    renderFrame((performance.now() / 1000) * rate);
    if (running) rafId = requestAnimationFrame(tick);
  };
  const start = () => {
    if (running || paused || reduced) return;
    running = true;
    rafId = requestAnimationFrame(tick);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(rafId);
  };

  renderFrame((performance.now() / 1000) * rate);

  // Live theme tracking: data-theme/class flips anywhere above the canvas,
  // plus OS-level switches when no ancestor pins a theme.
  const onThemeChange = () => {
    if (theme !== "auto") return;
    const next = detectDarkFromDom(canvas) ?? prefersDark();
    if (next === dark) return;
    dark = next;
    if (reduced || paused || !running) renderFrame((performance.now() / 1000) * rate);
  };
  const themeObserver =
    typeof MutationObserver !== "undefined"
      ? new MutationObserver(onThemeChange)
      : null;
  themeObserver?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
    subtree: true,
  });
  const schemeQuery = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;
  schemeQuery?.addEventListener("change", onThemeChange);

  if (reduced) {
    renderFrame(0.6);
  } else {
    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible && document.visibilityState !== "hidden") start();
            else stop();
          })
        : null;
    io?.observe(canvas);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
      else if (visible) start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (!io) start();

    const unmount = () => {
      stop();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      themeObserver?.disconnect();
      schemeQuery?.removeEventListener("change", onThemeChange);
      canvas.__thinkingOrbUnmount = null;
    };
    canvas.__thinkingOrbUnmount = unmount;
    canvas.dataset.orbMounted = "1";
    return unmount;
  }

  const unmountStatic = () => {
    themeObserver?.disconnect();
    schemeQuery?.removeEventListener("change", onThemeChange);
    canvas.__thinkingOrbUnmount = null;
  };
  canvas.__thinkingOrbUnmount = unmountStatic;
  canvas.dataset.orbMounted = "1";
  return unmountStatic;
}

/**
 * HTML string for an orb canvas. Auto-mounted on insertion by the observer below.
 * @param {{ state?: OrbState, size?: OrbSize, theme?: OrbTheme, className?: string, label?: string }} [opts]
 */
export function renderThinkingOrb(opts = {}) {
  const state = opts.state || "working";
  const size = opts.size || 64;
  const extra = opts.className ? ` ${opts.className}` : "";
  const themeAttr = opts.theme && opts.theme !== "auto" ? ` data-orb-theme="${escAttr(opts.theme)}"` : "";
  const label = opts.label || STATE_LABELS[state] || "Loading…";
  return `<canvas class="thinking-orb${extra}" data-orb-state="${escAttr(state)}" data-orb-size="${size}"${themeAttr} role="img" aria-label="${escAttr(label)}"></canvas>`;
}

/**
 * Create an orb canvas element, already mounted.
 * @param {{ state?: OrbState, size?: OrbSize, theme?: OrbTheme, className?: string, label?: string }} [opts]
 * @returns {HTMLCanvasElement}
 */
export function createThinkingOrb(opts = {}) {
  const wrap = document.createElement("div");
  wrap.innerHTML = renderThinkingOrb(opts).trim();
  const canvas = /** @type {HTMLCanvasElement} */ (wrap.firstElementChild);
  mountThinkingOrb(canvas, opts);
  return canvas;
}

/** Mount any unmounted orb canvases under a root node. */
export function hydrateThinkingOrbs(root = document) {
  const list = [];
  if (root.nodeType === 1 && root.matches?.("canvas.thinking-orb")) list.push(root);
  list.push(...(root.querySelectorAll?.("canvas.thinking-orb") ?? []));
  for (const canvas of list) {
    if (canvas.dataset.orbMounted) continue;
    if (canvas.dataset.orbTheme) {
      mountThinkingOrb(canvas, { theme: canvas.dataset.orbTheme });
    } else {
      mountThinkingOrb(canvas);
    }
  }
}

/** Loading panel with thinking orb + message (replaces fw-spinner panels). */
export function renderLoadingPanel(message = "Loading…") {
  const safe = String(message).replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  return `<div class="dew-loading-panel" role="status" aria-live="polite">
    ${renderThinkingOrb({ state: "working", size: 20 })}
    <span class="muted" data-decrypt-loop>${safe}</span>
  </div>`;
}

// Auto-mount static markup and innerHTML insertions app-wide.
function startOrbAutoMount() {
  if (typeof MutationObserver === "undefined" || !document.body?.nodeType) return;
  hydrateThinkingOrbs(document);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) hydrateThinkingOrbs(node);
      }
    }
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startOrbAutoMount, { once: true });
  } else {
    startOrbAutoMount();
  }
}
