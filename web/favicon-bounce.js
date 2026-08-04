/**
 * Subtle favicon bounce — redraws the tab icon on canvas with a gentle vertical bounce.
 * Respects prefers-reduced-motion and pauses when the tab is hidden.
 */

const ICON_SRC = new URL("./assets/freshworks-logomark.webp", import.meta.url).href;
const SIZE = 32;
const BOUNCE_PX = 2.5;
const PERIOD_MS = 2200;

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
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const img = new Image();
  let rafId = 0;
  let start = 0;
  let running = false;

  function draw(now) {
    if (!running) return;
    if (!start) start = now;

    const phase = ((now - start) % PERIOD_MS) / PERIOD_MS;
    const yOffset = -Math.sin(phase * Math.PI * 2) * BOUNCE_PX;

    ctx.clearRect(0, 0, SIZE, SIZE);
    const pad = 3;
    const drawSize = SIZE - pad * 2;
    ctx.drawImage(img, pad, pad + yOffset, drawSize, drawSize);
    link.type = "image/png";
    link.href = canvas.toDataURL("image/png");

    rafId = requestAnimationFrame(draw);
  }

  function startLoop() {
    if (running || !img.complete || !img.naturalWidth) return;
    running = true;
    rafId = requestAnimationFrame(draw);
  }

  function stopLoop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  img.onload = startLoop;
  img.onerror = () => {};
  img.src = ICON_SRC;

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopLoop();
    } else {
      start = 0;
      startLoop();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startFaviconBounce);
} else {
  startFaviconBounce();
}
