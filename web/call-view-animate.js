/**
 * Subtle call-record data animations — count-up KPIs, meter bars, radar reveal.
 * Respects prefers-reduced-motion; safe to call after every render.
 */

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function formatCount(value, decimals) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "-");
  if (decimals <= 0) return String(Math.round(n));
  return String(Math.round(n * 10 ** decimals) / 10 ** decimals);
}

/** @type {Set<string>} Call ids whose star radar entrance animation already ran. */
const starRadarAnimatedCallIds = new Set();

function freezeStarRadar(record) {
  const starCard = record.querySelector?.(".qip-star-card.qip-star-animated");
  if (!starCard) return;
  starCard.classList.remove("qip-star-animated");
  starCard.classList.add("qip-star-static");
}

function wireStarRadarAnimation(record) {
  const callId = record?.dataset?.callId || "";
  const starCard = record.querySelector?.(".qip-star-card");
  if (!starCard) return;

  if (record.classList.contains("call-record--progressive")) {
    freezeStarRadar(record);
    return;
  }

  if (callId && starRadarAnimatedCallIds.has(callId)) {
    freezeStarRadar(record);
    return;
  }

  if (callId && starCard.classList.contains("qip-star-animated")) {
    starRadarAnimatedCallIds.add(callId);
  }
}

/** @type {Set<string>} KPI count-up keys already completed this session (per call + value). */
const countUpCompletedKeys = new Set();

/** @type {Set<string>} Meter fill keys already completed this session (per call + target). */
const meterFillCompletedKeys = new Set();

function animationScopeKey(recordEl, el, valueAttr) {
  const callId = recordEl?.dataset?.callId || "";
  const value = el.dataset[valueAttr] || "";
  const decimals = el.dataset.countDecimals || "0";
  return `${callId}:${valueAttr}:${value}:${decimals}`;
}

function randomScrambleDigits(target, decimals) {
  const base = Math.max(10000, Math.floor(Math.abs(Number(target) || 0) * 1000) + 10000);
  const jitter = Math.floor(Math.random() * 9000);
  const raw = base + jitter;
  if (decimals <= 0) return String(raw);
  const whole = Math.floor(raw / 100);
  const frac = raw % 100;
  return `${whole}.${String(frac).padStart(2, "0").slice(0, decimals)}`;
}

function animateCountUp(el, duration = 720, onDone) {
  const target = parseFloat(el.dataset.countTo || "");
  if (!Number.isFinite(target)) return;

  const decimals = parseInt(el.dataset.countDecimals || "0", 10) || 0;

  if (prefersReducedMotion()) {
    el.textContent = formatCount(target, decimals);
    el.classList.add("call-count-up--done");
    onDone?.();
    return;
  }

  const start = performance.now();
  el.textContent = formatCount(0, decimals);
  el.classList.add("call-count-up--active");

  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    const current = target * eased;
    el.textContent = formatCount(current, decimals);

    if (t < 1) requestAnimationFrame(tick);
    else {
      el.textContent = formatCount(target, decimals);
      el.classList.remove("call-count-up--active");
      el.classList.add("call-count-up--done");
      onDone?.();
    }
  }

  requestAnimationFrame(tick);
}

function animateMeterFill(el, duration = 680, onDone) {
  const target = parseFloat(el.dataset.meterTarget || "");
  if (!Number.isFinite(target)) return;

  if (prefersReducedMotion()) {
    el.style.width = `${target}%`;
    el.classList.add("call-meter-fill--done");
    onDone?.();
    return;
  }

  el.style.width = "0%";
  const start = performance.now();

  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    el.style.width = `${target * eased}%`;
    if (t < 1) requestAnimationFrame(tick);
    else {
      el.style.width = `${target}%`;
      el.classList.add("call-meter-fill--done");
      onDone?.();
    }
  }

  requestAnimationFrame(tick);
}

/**
 * Wire KPI count-up, meter bars, cam pills, and pentagon reveal inside a call record.
 * @param {ParentNode | null | undefined} root
 */
export function wireCallViewAnimations(root) {
  if (!root) return;

  const record = root.querySelector?.(".call-record");
  if (!record) return;

  const paintStaticKpis = () => {
    root.querySelectorAll("[data-count-to]").forEach((el) => {
      const decimals = parseInt(el.dataset.countDecimals || "0", 10) || 0;
      el.textContent = formatCount(el.dataset.countTo, decimals);
    });
    root.querySelectorAll("[data-meter-target]").forEach((el) => {
      el.style.width = `${el.dataset.meterTarget}%`;
    });
  };

  if (prefersReducedMotion()) {
    record.classList.add("call-record-anim-ready");
    paintStaticKpis();
    return;
  }

  /* While background hydration is running, show final values statically and
     animate once when the record leaves progressive mode. */
  if (record.classList.contains("call-record--progressive")) {
    paintStaticKpis();
    freezeStarRadar(record);
    record.classList.add("call-record-anim-ready");
    return;
  }

  wireStarRadarAnimation(record);

  root.querySelectorAll(".call-count-up[data-count-to]:not(.call-count-up--done)").forEach((el) => {
    const key = animationScopeKey(record, el, "countTo");
    if (countUpCompletedKeys.has(key)) {
      const decimals = parseInt(el.dataset.countDecimals || "0", 10) || 0;
      el.textContent = formatCount(el.dataset.countTo, decimals);
      el.classList.add("call-count-up--done");
      return;
    }
    animateCountUp(el, 720, () => countUpCompletedKeys.add(key));
  });

  root.querySelectorAll(".call-meter-fill[data-meter-target]:not(.call-meter-fill--done)").forEach((el) => {
    const key = animationScopeKey(record, el, "meterTarget");
    if (meterFillCompletedKeys.has(key)) {
      el.style.width = `${el.dataset.meterTarget}%`;
      el.classList.add("call-meter-fill--done");
      return;
    }
    animateMeterFill(el, 680, () => meterFillCompletedKeys.add(key));
  });

  requestAnimationFrame(() => {
    record.classList.add("call-record-anim-ready");
  });
}
