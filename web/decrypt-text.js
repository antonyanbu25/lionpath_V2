/**
 * Decrypted-text scramble — vanilla JS port of the reactbits.dev
 * "Decrypted Text" effect (no React). Characters cycle through random
 * glyphs and resolve left-to-right into the final string.
 *
 * Usage:
 *   import { decryptText } from "./decrypt-text.js";
 *   decryptText(el, { speed: 28 });          // scramble el.textContent into place
 *
 * Auto-mount: any element with `data-decrypt` (or class `decrypt-text`)
 * is animated on insertion via a MutationObserver — this covers panels
 * rendered through innerHTML strings. After the first pass, external
 * textContent writes (e.g. stage updates like "Prospects read: 1 of 1")
 * re-trigger the decrypt automatically.
 *
 * `prefers-reduced-motion: reduce` → final text is shown immediately.
 */

const DEFAULT_GLYPHS = "!<>-_\\/[]{}—=+*^?#·:;~$%&@";
const SELECTOR = "[data-decrypt], .decrypt-text";

function prefersReducedMotion() {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function randomGlyph(glyphs) {
  return glyphs[(Math.random() * glyphs.length) | 0];
}

function stopDecrypt(el) {
  const state = el.__decryptState;
  if (state) state.cancelled = true;
  if (state?.raf) cancelAnimationFrame(state.raf);
}

/**
 * Scramble-animate an element's text into its final value.
 * @param {HTMLElement} el
 * @param {{ speed?: number, duration?: number, glyphs?: string, text?: string }} [opts]
 *   speed    ms between scramble ticks (default 28)
 *   duration total reveal time in ms (default: 300 + 28/char, capped at 1600)
 *   text     override target text (default: current textContent)
 * @returns {() => void} cancel function (leaves whatever is currently rendered)
 */
export function decryptText(el, opts = {}) {
  if (!el) return () => {};
  stopDecrypt(el);

  const speed = opts.speed ?? 28;
  const glyphs = opts.glyphs || DEFAULT_GLYPHS;
  const target = String(opts.text ?? el.textContent ?? "");

  const state = { cancelled: false, raf: 0, lastRendered: target };
  el.__decryptState = state;

  const write = (s) => {
    state.lastRendered = s;
    if (el.textContent !== s) el.textContent = s;
  };

  if (prefersReducedMotion() || target.length === 0) {
    write(target);
    return () => stopDecrypt(el);
  }

  const duration =
    opts.duration ?? Math.min(1600, 300 + target.length * 28);
  const start = performance.now();
  let lastTick = 0;

  const frame = (now) => {
    if (state.cancelled) return;
    if (el.textContent !== state.lastRendered) {
      // External write landed mid-animation — adopt it and restart.
      decryptText(el, { ...opts, text: el.textContent });
      return;
    }
    const progress = Math.min(1, (now - start) / duration);
    if (progress >= 1) {
      write(target);
      return;
    }
    if (now - lastTick >= speed) {
      lastTick = now;
      const revealCount = Math.floor(progress * target.length);
      let out = target.slice(0, revealCount);
      for (let i = revealCount; i < target.length; i++) {
        const ch = target[i];
        out += ch === " " || ch === "\n" || ch === "\t" ? ch : randomGlyph(glyphs);
      }
      write(out);
    }
    state.raf = requestAnimationFrame(frame);
  };
  state.raf = requestAnimationFrame(frame);

  return () => stopDecrypt(el);
}

/**
 * Mount decrypt behaviour on one element: run the animation now, then
 * watch for external text changes and re-decrypt when they land.
 */
function mountDecryptText(el) {
  if (el.__decryptMounted) return;
  el.__decryptMounted = true;
  decryptText(el);
  if (typeof MutationObserver === "undefined") return;
  const observer = new MutationObserver(() => {
    const state = el.__decryptState;
    const current = el.textContent ?? "";
    // Ignore echoes of our own scramble frames.
    if (state && current === state.lastRendered) return;
    decryptText(el, { text: current });
  });
  observer.observe(el, { characterData: true, childList: true, subtree: true });
  el.__decryptObserver = observer;
}

/** Mount any unmounted [data-decrypt] elements under a root node. */
export function hydrateDecryptTexts(root = document) {
  if (root.nodeType === 1 && root.matches?.(SELECTOR)) mountDecryptText(root);
  for (const el of root.querySelectorAll?.(SELECTOR) ?? []) mountDecryptText(el);
}

// Auto-mount static markup and innerHTML insertions app-wide.
function startDecryptAutoMount() {
  if (typeof MutationObserver === "undefined" || !document.body?.nodeType) return;
  hydrateDecryptTexts(document);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) hydrateDecryptTexts(node);
      }
    }
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startDecryptAutoMount, { once: true });
  } else {
    startDecryptAutoMount();
  }
}
