/**
 * Sidebar idle animation — after 1 minute without input, nudge each nav icon slowly in sequence.
 * Respects prefers-reduced-motion and pauses while the tab is hidden.
 */

const IDLE_MS = 60_000;
const ICON_GAP_MS = 520;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "click", "wheel"];

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function visibleNavItems(sidebar) {
  return [...sidebar.querySelectorAll(".sidebar-nav fw-button.nav-item")].filter((el) => {
    if (el.hidden) return false;
    if (!el.querySelector(".nav-icon svg")) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function nudgeNavIcon(item) {
  const svg = item.querySelector(".nav-icon svg");
  if (!svg || prefersReducedMotion()) return;
  svg.animate(
    [
      { transform: "translateY(0)", opacity: 1 },
      { transform: "translateY(-2px)", opacity: 0.92, offset: 0.35 },
      { transform: "translateY(0)", opacity: 1 },
    ],
    { duration: 2100, easing: "ease-in-out" },
  );
}

export function initSidebarIdleAnimation() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar || prefersReducedMotion()) return;

  let idleTimer = 0;
  let cycleTimer = 0;
  let cycleIndex = 0;
  let cycling = false;

  function clearCycle() {
    clearTimeout(cycleTimer);
    cycleIndex = 0;
    cycling = false;
    sidebar.classList.remove("sidebar-idle-active");
  }

  function runCycleStep() {
    const items = visibleNavItems(sidebar);
    if (!items.length || document.hidden) {
      clearCycle();
      return;
    }

    sidebar.classList.add("sidebar-idle-active");
    nudgeNavIcon(items[cycleIndex % items.length]);
    cycleIndex += 1;
    cycleTimer = window.setTimeout(runCycleStep, ICON_GAP_MS);
  }

  function startIdleCycle() {
    if (document.hidden || cycling) return;
    cycling = true;
    cycleIndex = 0;
    runCycleStep();
  }

  function resetIdle() {
    clearCycle();
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(startIdleCycle, IDLE_MS);
  }

  const onActivity = () => resetIdle();

  ACTIVITY_EVENTS.forEach((evt) => {
    window.addEventListener(evt, onActivity, { passive: true, capture: true });
  });
  window.addEventListener("scroll", onActivity, { passive: true, capture: true });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearCycle();
    else resetIdle();
  });

  resetIdle();
}
