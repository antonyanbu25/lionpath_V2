/**
 * Favicon animation — active tab: subtle vertical bob, fluid and seamless.
 * Inactive tab (another tab focused): same bob plus a soft, slow multi-hue glow.
 * Respects prefers-reduced-motion; keeps the HTML favicon when animation is off.
 *
 * GLITCH FIX: The original called canvas.toDataURL("image/png") on every
 * requestAnimationFrame tick (~60fps). toDataURL is synchronous and
 * allocates/parses a data URL string each frame — expensive enough to cause
 * visible stutter/flicker in the browser tab. This rewrite pre-renders a
 * fixed ring of 32 frames per visual mode into an offscreen canvas once at
 * startup, then the rAF loop simply cycles through cached data URLs. No
 * per-frame canvas drawing and no per-frame toDataURL — the tab updates are
 * cheap string assignments throttled to ~10fps via a time accumulator, while
 * the animation math (sine phase) is computed once per frame for smoothness.
 * Net effect: the browser tab shows a smooth, continuous motion with no
 * blocking work on the main thread.
 */

const SIZE = 32;

/** Subtle bounce: small amplitude, slow period — barely eye-catching. */
const BOUNCE_PX = 2.0;
const PERIOD_MS = 3200;

/** Subtle glow (inactive tab only): soft alpha window, slow color cycle. */
const GLOW_COLORS = [
  [0, 168, 134],
  [41, 171, 226],
  [123, 201, 80],
  [255, 180, 0],
];
const GLOW_PERIOD_MS = 6400;
/** Peak glow alpha kept low so it reads as a gentle halo, not a flash. */
const GLOW_ALPHA_MIN = 0.10;
const GLOW_ALPHA_MAX = 0.22;

/**
 * Number of pre-rendered frames in the ring. 32 (= period/glowCycle step) is
 * plenty for a slow, subtle motion — the position deltas between adjacent
 * cached frames are sub-pixel, so the 32-step ring looks continuous.
 */
const FRAME_COUNT = 32;

/** Favicon href updates are throttled to ~10fps (100ms). Below this the tab
 *  flickers from rapid data-URL swaps; above ~12fps the CPU cost rises for no
 *  visible gain at these slow periods. 10fps is the sweet spot. */
const UPDATE_INTERVAL_MS = 100;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getFaviconLink() {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  return link;
}

function resolveIconHref(link) {
  if (link.href) return link.href;
  const attr = link.getAttribute("href");
  if (attr) return new URL(attr, document.baseURI).href;
  return new URL("./assets/freshworks-logomark.webp", import.meta.url).href;
}

/** Lerp helper for color blending. */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Pre-render the full ring of FRAME_COUNT frames for a given mode.
 * Returns an array of data-URL strings.
 */
function buildFrameRing(img, mode) {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const frames = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const t = i / FRAME_COUNT;
    const phase = t * Math.PI * 2;
    const yOffset = -Math.sin(phase) * BOUNCE_PX;

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();

    if (mode === "glow") {
      const glowT = t * GLOW_COLORS.length;
      const colorIdx = Math.floor(glowT) % GLOW_COLORS.length;
      const nextIdx = (colorIdx + 1) % GLOW_COLORS.length;
      const blend = glowT - Math.floor(glowT);
      const [r1, g1, b1] = GLOW_COLORS[colorIdx];
      const [r2, g2, b2] = GLOW_COLORS[nextIdx];
      const r = Math.round(lerp(r1, r2, blend));
      const g = Math.round(lerp(g1, g2, blend));
      const b = Math.round(lerp(b1, b2, blend));
      const glowAlpha = lerp(GLOW_ALPHA_MIN, GLOW_ALPHA_MAX, 0.5 + 0.5 * Math.sin(phase));
      ctx.shadowColor = `rgba(${r},${g},${b},${glowAlpha})`;
      ctx.shadowBlur = 5;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    const pad = 3;
    const drawSize = SIZE - pad * 2;
    ctx.drawImage(img, pad, pad + yOffset, drawSize, drawSize);
    ctx.restore();

    frames.push(canvas.toDataURL("image/png"));
  }
  return frames;
}

function startFaviconBounce() {
  if (prefersReducedMotion()) return;

  const link = getFaviconLink();
  const iconHref = resolveIconHref(link);
  const img = new Image();
  let rafId = 0;
  let running = false;

  /** Pre-rendered data-URL rings, keyed by mode. Built once after img load. */
  let rings = null; // { bob: string[], glow: string[] }

  /** Which ring is active — driven by document.hidden (visibilitychange). */
  let glowEnabled = document.hidden;

  function buildRings() {
    const bob = buildFrameRing(img, "bob");
    const glow = buildFrameRing(img, "glow");
    if (!bob || !glow) return false;
    rings = { bob, glow };
    return true;
  }

  // --- Throttled updater: only write link.href at most every UPDATE_INTERVAL_MS.
  //     to avoid the browser thrashing on rapid data-URL swaps (a second-line
  //     defense on top of pre-rendering). The rAF loop above runs every frame
  //     for smooth math but we gate the actual DOM write here.
  let lastHrefUpdate = 0;
  function throttledLoop(now) {
    if (!running || !rings) return;

    const ringIndex = Math.floor(
      ((now / PERIOD_MS) * FRAME_COUNT) % FRAME_COUNT
    );
    const idx = ((ringIndex % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
    const ring = glowEnabled ? rings.glow : rings.bob;

    if (now - lastHrefUpdate >= UPDATE_INTERVAL_MS) {
      link.type = "image/png";
      link.href = ring[idx];
      lastHrefUpdate = now;
    }

    rafId = requestAnimationFrame(throttledLoop);
  }

  function startLoop() {
    if (running || !img.complete || !img.naturalWidth) return;
    if (rings || !buildRings()) return;
    running = true;
    lastHrefUpdate = 0;
    rafId = requestAnimationFrame(throttledLoop);
  }

  img.onload = () => {
    if (!img.naturalWidth) return;
    startLoop();
  };
  img.onerror = () => {
    // Keep the original HTML favicon if the canvas source fails to load.
  };
  img.src = iconHref;

  document.addEventListener("visibilitychange", () => {
    glowEnabled = document.hidden;
    if (!running && img.complete && img.naturalWidth) startLoop();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startFaviconBounce);
} else {
  startFaviconBounce();
}
