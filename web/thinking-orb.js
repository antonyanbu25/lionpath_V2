const DEFAULT_SIZE = 64;

function U(n, s, t) {
  return n + (s - n) * t;
}

function nt(n) {
  return n - Math.floor(n);
}

function E(n, s) {
  const t = Math.sin(n * 12.9898 + s * 78.233) * 43758.5453;
  return t - Math.floor(t);
}

function G(n, s) {
  const t = Math.floor(n);
  const r = Math.floor(s);
  let a = n - t;
  let o = s - r;
  a = a * a * (3 - 2 * a);
  o = o * o * (3 - 2 * o);
  const c = E(t, r);
  const M = E(t + 1, r);
  const h = E(t, r + 1);
  const m = E(t + 1, r + 1);
  return c + (M - c) * a + (h - c) * o + (c - M - h + m) * a * o;
}

function J(n, s) {
  const t = Math.PI * (3 - Math.sqrt(5));
  const r = 1 - (2 * (n + 0.5)) / s;
  const a = Math.sqrt(1 - r * r);
  const o = n * t;
  return [a * Math.cos(o), r, a * Math.sin(o)];
}

function rot(n, s, t, r, a) {
  const o = Math.sin(s);
  const c = Math.cos(s);
  const M = Math.sin(n);
  const h = Math.cos(n);
  return (m, D, p) => {
    const e = m * h + p * M;
    const l = -m * M + p * h;
    const R = D * c - l * o;
    const w = D * o + l * c;
    return [t + e * a, r - R * a, w];
  };
}

function scale(n, s) {
  return (n / 300) ** s;
}

function clampAlpha(value) {
  return Math.max(0, Math.min(1, value == null ? 1 : value));
}

function colorFor(white, alpha, darkMode) {
  const channel = Math.round((darkMode ? white : 1 - white) * 255);
  return `rgba(${channel}, ${channel}, ${channel}, ${clampAlpha(alpha)})`;
}

function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getMotionQuery() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia("(prefers-reduced-motion: reduce)");
}

function getThemeQuery() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia("(prefers-color-scheme: dark)");
}

function resolveDarkMode(host, query) {
  const explicitHost = host?.dataset?.theme || "";
  const explicitAncestor = host?.closest?.("[data-theme]")?.dataset?.theme || "";
  const explicit = `${explicitHost} ${explicitAncestor}`.toLowerCase();
  if (/\bdark\b/.test(explicit)) return true;
  if (/\blight\b/.test(explicit)) return false;

  const classTarget = `${host?.className || ""} ${document?.documentElement?.className || ""}`.toLowerCase();
  if (/\b(dark|theme-dark|dark-mode)\b/.test(classTarget)) return true;
  if (/\b(light|theme-light|light-mode)\b/.test(classTarget)) return false;

  return Boolean(query?.matches);
}

function readNumber(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readOptionsFromDataset(host) {
  const dataset = host?.dataset || {};
  return {
    size: readNumber(dataset.size || dataset.orbSize, undefined),
    spread: readNumber(dataset.spread || dataset.orbSpread, undefined),
    rsPow: readNumber(dataset.rsPow || dataset.orbRsPow, undefined),
    nodeN: readNumber(dataset.nodeN || dataset.orbNodeN, undefined),
    thr: readNumber(dataset.thr || dataset.orbThr, undefined),
    nodeR: readNumber(dataset.nodeR || dataset.orbNodeR, undefined),
    nodeRDepth: readNumber(dataset.nodeRDepth || dataset.orbNodeRDepth, undefined),
    lineW: readNumber(dataset.lineW || dataset.orbLineW, undefined),
    signals: readNumber(dataset.signals || dataset.orbSignals, undefined),
  };
}

function resolveSize(host, opts) {
  const optionSize = readNumber(opts.size, undefined);
  if (optionSize) return { width: optionSize, height: optionSize };

  const rect = host.getBoundingClientRect?.();
  const width = Math.round(rect?.width || host.clientWidth || 0);
  const height = Math.round(rect?.height || host.clientHeight || 0);
  const size = optionSize || DEFAULT_SIZE;
  return {
    width: width || size,
    height: height || width || size,
  };
}

function drawConnectingOrb(ctx, size, time, opts, darkMode) {
  const n = size;
  const r = n / 2;
  const a = n / 2;
  const o = (n / 2) * 0.8 * (opts.spread ?? 1);
  const proj = rot(time * 0.12, 0.32, r, a, o);
  const M = scale(n, opts.rsPow ?? 0.6);
  const h = opts.nodeN ?? 30;
  const m = opts.thr ?? 0.72;
  const D = opts.nodeR ?? 1.4;
  const p = opts.nodeRDepth ?? 1.8;

  const e = [];
  for (let i = 0; i < h; i += 1) {
    const u = J(i, h);
    const y = u[0] + 0.3 * (G(i * 0.31 + 9, time * 0.24) - 0.5) * 2;
    const b = u[1] + 0.3 * (G(i * 0.53 + 27, time * 0.21) - 0.5) * 2;
    const f = u[2] + 0.3 * (G(i * 0.77 + 55, time * 0.27) - 0.5) * 2;
    const P = Math.sqrt(y * y + b * b + f * f);
    e.push([y / P, b / P, f / P]);
  }

  const lines = [];
  for (let i = 0; i < h; i += 1) {
    for (let u = i + 1; u < h; u += 1) {
      const y = e[i][0] - e[u][0];
      const b = e[i][1] - e[u][1];
      const f = e[i][2] - e[u][2];
      const P = Math.sqrt(y * y + b * b + f * f);
      if (P >= m) continue;
      const [x, g, d] = proj(e[i][0], e[i][1], e[i][2]);
      const [v, k, N] = proj(e[u][0], e[u][1], e[u][2]);
      const z = ((d + N) / 2 + 1) / 2;
      lines.push({
        x1: x,
        y1: g,
        x2: v,
        y2: k,
        z,
        white: 0.42,
        a: (1 - P / m) * (0.3 + 0.55 * z),
        w: Math.max(0.6, (opts.lineW ?? 0.8) * M),
      });
    }
  }

  const dots = [];
  for (let i = 0; i < h; i += 1) {
    const [u, y, b] = proj(e[i][0], e[i][1], e[i][2]);
    const f = (b + 1) / 2;
    const P = 1 + 0.25 * Math.sin(time * 1.4 + i * 2.7);
    dots.push({ x: u, y, z: b, r: (D + p * f) * P * M, white: 0.55 - 0.45 * f });
  }

  const w = opts.signals ?? 5;
  for (let i = 0; i < w; i += 1) {
    const u = Math.floor(time * 0.55 + i * 7.31);
    const y = Math.floor(E(u, i * 3.1 + 1.7) * h);
    const b = Math.floor(E(u, i * 5.7 + 4.2) * h);
    if (y === b) continue;
    const f = nt(time * 0.55 + i * 7.31);
    const P = U(e[y][0], e[b][0], f);
    const x = U(e[y][1], e[b][1], f);
    const g = U(e[y][2], e[b][2], f);
    const d = Math.max(1e-6, Math.sqrt(P * P + x * x + g * g));
    const [v, k, N] = proj(P / d, x / d, g / d);
    const z = (N + 1) / 2;
    dots.push({ x: v, y: k, z: N, r: (D * 1.5 + p * z) * M, white: 0.05, a: 0.5 + 0.5 * z });
  }

  lines.sort((left, right) => left.z - right.z);
  for (const line of lines) {
    ctx.strokeStyle = colorFor(line.white, line.a, darkMode);
    ctx.lineWidth = line.w;
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  }

  dots.sort((left, right) => left.z - right.z);
  for (const dot of dots) {
    ctx.fillStyle = colorFor(dot.white, dot.a, darkMode);
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, Math.max(0.3, dot.r), 0, Math.PI * 2);
    ctx.fill();
  }
}

export function createThinkingOrb(host, opts = {}) {
  if (!host || typeof document === "undefined") {
    return { destroy() {} };
  }

  const mergedOpts = { ...readOptionsFromDataset(host), ...opts };
  host.classList?.add("thinking-orb");

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  const initialSize = readNumber(mergedOpts.size, DEFAULT_SIZE);
  canvas.style.width = `${initialSize}px`;
  canvas.style.height = `${initialSize}px`;
  host.appendChild(canvas);

  const ctx = canvas.getContext?.("2d");
  if (!ctx) {
    return {
      destroy() {
        canvas.remove();
      },
    };
  }

  let frame = 0;
  let destroyed = false;
  let width = 0;
  let height = 0;
  let size = 0;
  let start = 0;
  let darkMode = false;
  let visible = false;
  const themeQuery = getThemeQuery();
  const motionQuery = getMotionQuery();

  function hostHasSize() {
    const rect = host.getBoundingClientRect?.();
    return Boolean((rect?.width || host.clientWidth || 0) && (rect?.height || host.clientHeight || 0));
  }

  function syncSize() {
    const resolved = resolveSize(host, mergedOpts);
    width = Math.max(1, resolved.width);
    height = Math.max(1, resolved.height);
    size = Math.min(width, height);

    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function render(timeStamp = 0) {
    if (destroyed) return;
    if (!visible || !hostHasSize()) return;
    if (!start) start = timeStamp;
    syncSize();
    darkMode = resolveDarkMode(host, themeQuery);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate((width - size) / 2, (height - size) / 2);
    drawConnectingOrb(ctx, size, (timeStamp - start) / 1000, mergedOpts, darkMode);
    ctx.restore();
  }

  function animate(timeStamp) {
    const hasSize = hostHasSize();
    visible = hasSize;
    render(timeStamp);
    if (!destroyed && !prefersReducedMotion()) {
      frame = window.requestAnimationFrame(animate);
    }
  }

  function stopLoop() {
    if (!frame) return;
    window.cancelAnimationFrame(frame);
    frame = 0;
  }

  function startLoop() {
    if (destroyed || frame || !hostHasSize()) return;
    if (prefersReducedMotion()) {
      visible = true;
      render(performance.now());
      return;
    }
    frame = window.requestAnimationFrame(animate);
  }

  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (hostHasSize()) {
            visible = true;
            startLoop();
            return;
          }
          visible = false;
        })
      : null;
  resizeObserver?.observe(host);

  const repaint = () => {
    if (visible) render(performance.now());
  };
  themeQuery?.addEventListener?.("change", repaint);
  const handleMotionChange = () => {
    if (prefersReducedMotion()) {
      stopLoop();
      repaint();
    } else if (!frame && visible) {
      start = 0;
      startLoop();
    }
  };
  motionQuery?.addEventListener?.("change", handleMotionChange);

  if (hostHasSize()) {
    visible = true;
    startLoop();
  }

  return {
    destroy() {
      destroyed = true;
      stopLoop();
      resizeObserver?.disconnect();
      themeQuery?.removeEventListener?.("change", repaint);
      motionQuery?.removeEventListener?.("change", handleMotionChange);
      canvas.remove();
    },
  };
}

export function initThinkingOrbs(root = document) {
  const run = () => {
    const scope = root || document;
    const hosts = scope.querySelectorAll?.("[data-thinking-orb]") || [];
    hosts.forEach((host) => {
      if (host.__thinkingOrb) return;
      host.__thinkingOrb = createThinkingOrb(host);
    });
  };

  if (root === document && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
    return;
  }

  run();
}

export default initThinkingOrbs;

if (typeof document !== "undefined") {
  const init = () => initThinkingOrbs();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
}
