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

function animateCountUp(el, duration = 720) {
  const target = parseFloat(el.dataset.countTo || "");
  if (!Number.isFinite(target)) return;

  const decimals = parseInt(el.dataset.countDecimals || "0", 10) || 0;
  if (prefersReducedMotion()) {
    el.textContent = formatCount(target, decimals);
    el.classList.add("call-count-up--done");
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
    }
  }

  requestAnimationFrame(tick);
}

function animateMeterFill(el, duration = 680) {
  const target = parseFloat(el.dataset.meterTarget || "");
  if (!Number.isFinite(target)) return;

  if (prefersReducedMotion()) {
    el.style.width = `${target}%`;
    el.classList.add("call-meter-fill--done");
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

  if (prefersReducedMotion()) {
    record.classList.add("call-record-anim-ready");
    root.querySelectorAll("[data-count-to]").forEach((el) => {
      const decimals = parseInt(el.dataset.countDecimals || "0", 10) || 0;
      el.textContent = formatCount(el.dataset.countTo, decimals);
    });
    root.querySelectorAll("[data-meter-target]").forEach((el) => {
      el.style.width = `${el.dataset.meterTarget}%`;
    });
    return;
  }

  root.querySelectorAll(".call-count-up[data-count-to]:not(.call-count-up--done)").forEach((el) => {
    animateCountUp(el);
  });

  root.querySelectorAll(".call-meter-fill[data-meter-target]:not(.call-meter-fill--done)").forEach((el) => {
    animateMeterFill(el);
  });

  requestAnimationFrame(() => {
    record.classList.add("call-record-anim-ready");
  });
}
