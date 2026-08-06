/**
 * Favicon idle-tab animation — when the user is in another tab, the logo bounces
 * subtly and glows with Freshworks brand hues. Static icon while the tab is active.
 * Respects prefers-reduced-motion.
 */

const ICON_SRC = new URL("./assets/freshworks-logomark.webp", import.meta.url).href;
const SIZE = 32;
const BOUNCE_PX = 2.5;
const PERIOD_MS = 2400;

/** Subtle brand hues from the logomark — low alpha glow only. */
const GLOW_COLORS = [
  [0, 168, 134],
  [41, 171, 226],
  [123, 201, 80],
  [255, 180, 0],
];

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

function startFaviconBounce() {
  if (prefersReducedMotion()) return;

  const link = getFaviconLink();
  const staticHref = ICON_SRC;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const img = new Image();
  let rafId = 0;
  let start = 0;
  let running = false;

  function setStaticIcon() {
    link.type = "image/webp";
    link.href = staticHref;
  }

  function draw(now) {
    if (!running) return;
    if (!start) start = now;

    const phase = ((now - start) % PERIOD_MS) / PERIOD_MS;
    const yOffset = -Math.sin(phase * Math.PI * 2) * BOUNCE_PX;
    const glowPhase = (now - start) / 3200;
    const colorIdx = Math.floor(glowPhase) % GLOW_COLORS.length;
    const nextIdx = (colorIdx + 1) % GLOW_COLORS.length;
    const blend = glowPhase - Math.floor(glowPhase);
    const [r1, g1, b1] = GLOW_COLORS[colorIdx];
    const [r2, g2, b2] = GLOW_COLORS[nextIdx];
    const r = r1 + (r2 - r1) * blend;
    const g = g1 + (g2 - g1) * blend;
    const b = b1 + (b2 - b1) * blend;
    const glowAlpha = 0.22 + Math.sin(phase * Math.PI * 2) * 0.06;

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.shadowColor = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${glowAlpha})`;
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    const pad = 3;
    const drawSize = SIZE - pad * 2;
    ctx.drawImage(img, pad, pad + yOffset, drawSize, drawSize);
    ctx.restore();

    link.type = "image/png";
    link.href = canvas.toDataURL("image/png");
    rafId = requestAnimationFrame(draw);
  }

  function startLoop() {
    if (running || !img.complete || !img.naturalWidth) return;
    running = true;
    start = 0;
    rafId = requestAnimationFrame(draw);
  }

  function stopLoop() {
    running = false;
    cancelAnimationFrame(rafId);
    setStaticIcon();
  }

  img.onload = () => {
    setStaticIcon();
    if (document.hidden) startLoop();
  };
  img.onerror = () => {};
  img.src = ICON_SRC;

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      startLoop();
    } else {
      stopLoop();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startFaviconBounce);
} else {
  startFaviconBounce();
}
