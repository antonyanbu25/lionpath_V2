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
    speed: readNumber(dataset.speed || dataset.orbSpeed, undefined),
    count: readNumber(dataset.count || dataset.orbCount, undefined),
    sizeScale: readNumber(dataset.sizeScale || dataset.orbSizeScale, undefined),
    moveCount: readNumber(dataset.moveCount || dataset.orbMoveCount, undefined),
    latRings: readNumber(dataset.latRings || dataset.orbLatRings, undefined),
    lonDensity: readNumber(dataset.lonDensity || dataset.orbLonDensity, undefined),
    rBase: readNumber(dataset.rBase || dataset.orbRBase, undefined),
    rDepth: readNumber(dataset.rDepth || dataset.orbRDepth, undefined),
    rActive: readNumber(dataset.rActive || dataset.orbRActive, undefined),
    inkFar: readNumber(dataset.inkFar || dataset.orbInkFar, undefined),
    inkSpan: readNumber(dataset.inkSpan || dataset.orbInkSpan, undefined),
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

function lt(n, s, t, r) {
  const a = 2 * s * t + r;
  const o = n % a;
  const c = new Array(s).fill(0);
  let M = -1;
  if (o < 2 * s * t) {
    const h = Math.floor(o / t);
    const m = (o - h * t) / t;
    const p = 1 - (1 - Math.min(1, m / 0.7)) ** 3;
    if (h < s) {
      for (let e = 0; e < h; e += 1) c[e] = 1;
      c[h] = p;
      M = h;
    } else {
      const e = 2 * s - 1 - h;
      for (let l = 0; l < e; l += 1) c[l] = 1;
      c[e] = 1 - p;
      M = e;
    }
  }
  return { amount: c, active: M };
}

function pt(n, s, t) {
  let [r, a, o] = n;
  let c = false;
  for (let M = 0; M < s.length; M += 1) {
    if (t.amount[M] <= 0) continue;
    const h = s[M];
    const m = h.axis === 0 ? r : h.axis === 1 ? a : o;
    if (m < h.lo || m >= h.hi) continue;
    if (M === t.active) c = true;
    const D = h.ang * t.amount[M];
    const p = Math.cos(D);
    const e = Math.sin(D);
    if (h.axis === 0) {
      const l = a * p - o * e;
      o = a * e + o * p;
      a = l;
    } else if (h.axis === 1) {
      const l = r * p + o * e;
      o = -r * e + o * p;
      r = l;
    } else {
      const l = r * p - a * e;
      a = r * e + a * p;
      r = l;
    }
  }
  return [r, a, o, c];
}

function ut(n) {
  const s = [];
  for (let t = 0; t < n; t += 1) {
    const r = Math.min(2, Math.floor(E(t, 2.3) * 3));
    const a = -1 + 0.5 * Math.min(3, Math.floor(E(t, 5.9) * 4));
    const o = E(t, 7.7) < 0.5 ? 1 : -1;
    s.push({ axis: r, lo: a, hi: a + 0.5, ang: (o * Math.PI) / 2 });
  }
  return s;
}

function drawConnectingOrb(ctx, size, time, opts, darkMode) {
  const n = size;
  const r = n / 2;
  const a = n / 2;
  const speed = opts.speed ?? 1.82;
  const s = time * speed;
  const sizeScale = opts.sizeScale ?? opts.spread ?? 1.05;
  const o = ((n / 2) * 0.82) * sizeScale;
  const c = rot(s * 0.55, 0.35 + 0.1 * Math.sin(s * 0.9), r, a, o);
  const M = scale(n, opts.rsPow ?? 0.6) * sizeScale;
  const h = opts.moveCount ?? 14;
  const m = ut(h);
  const D = lt(s, h, 0.42, 1.2);
  const p = [];
  const e = opts.latRings ?? 15;
  const l = opts.lonDensity ?? 40;
  for (let R = 0; R <= e; R += 1) {
    const w = -Math.PI / 2 + (R / e) * Math.PI;
    const i = Math.cos(w);
    const u = Math.sin(w);
    const y = Math.max(1, Math.round(Math.abs(i) * l));
    for (let b = 0; b < y; b += 1) {
      const f = (b / y) * 2 * Math.PI;
      const [P, x, g, d] = pt([i * Math.cos(f), u, i * Math.sin(f)], m, D);
      const [v, k, N] = c(P, x, g);
      const z = (N + 1) / 2;
      p.push({
        x: v,
        y: k,
        z: N,
        r: ((opts.rBase ?? 0.6) + (opts.rDepth ?? 1.7) * z + (d ? opts.rActive ?? 0.3 : 0)) * M,
        white: (opts.inkFar ?? 0.62) - (opts.inkSpan ?? 0.54) * z - (d ? 0.14 : 0),
      });
    }
  }

  p.sort((left, right) => left.z - right.z);
  for (const dot of p) {
    ctx.fillStyle = colorFor(dot.white, 1, darkMode);
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
    const hosts = [];
    if (scope.matches?.("[data-thinking-orb]")) hosts.push(scope);
    scope.querySelectorAll?.("[data-thinking-orb]")?.forEach((host) => hosts.push(host));
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

let thinkingOrbBodyObserver = null;

function observeThinkingOrbAdditions() {
  if (thinkingOrbBodyObserver || typeof document === "undefined" || typeof MutationObserver !== "function") return;
  if (!document.body) return;
  thinkingOrbBodyObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes?.forEach((node) => {
        if (node.nodeType !== 1) return;
        initThinkingOrbs(node);
      });
    }
  });
  thinkingOrbBodyObserver.observe(document.body, { childList: true, subtree: true });
}

if (typeof document !== "undefined") {
  const init = () => {
    initThinkingOrbs();
    observeThinkingOrbAdditions();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
}
