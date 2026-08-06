/**
 * Favicon animation — active tab: subtle vertical bounce only.
 * Inactive tab (another tab focused): same bounce plus soft multi-hue glow.
 * Respects prefers-reduced-motion; keeps the HTML favicon when animation is off.
 */

const SIZE = 32;
const BOUNCE_PX = 2.5;
const PERIOD_MS = 2400;

/** Subtle brand hues from the logomark — inactive tab only. */
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

function resolveIconHref(link) {
  if (link.href) return link.href;
  const attr = link.getAttribute("href");
  if (attr) return new URL(attr, document.baseURI).href;
  return new URL("./assets/freshworks-logomark.webp", import.meta.url).href;
}

function startFaviconBounce() {
  if (prefersReducedMotion()) return;

  const link = getFaviconLink();
  const iconHref = resolveIconHref(link);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const img = new Image();
  let rafId = 0;
  let start = 0;
  let running = false;
  let glowEnabled = document.hidden;

  function draw(now) {
    if (!running) return;
    if (!start) start = now;

    const phase = ((now - start) % PERIOD_MS) / PERIOD_MS;
    const yOffset = -Math.sin(phase * Math.PI * 2) * BOUNCE_PX;

    ctx.clearRect(0, 0, SIZE, SIZE);

    if (glowEnabled) {
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

      ctx.save();
      ctx.shadowColor = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${glowAlpha})`;
      ctx.shadowBlur = 5;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    const pad = 3;
    const drawSize = SIZE - pad * 2;
    ctx.drawImage(img, pad, pad + yOffset, drawSize, drawSize);

    if (glowEnabled) ctx.restore();

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
