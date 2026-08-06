/**
 * Sidebar idle animation — after 1 minute without input, nudge each nav icon slowly in sequence.
 * Respects prefers-reduced-motion and pauses while the tab is hidden.
 */

const IDLE_MS = 60_000;
const ICON_GAP_MS = 520;

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

export function initSidebarIdleAnimation() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar || prefersReducedMotion()) return;

  const navItems = () =>
    [...sidebar.querySelectorAll(".sidebar-nav .nav-item")].filter((el) => el.querySelector(".nav-icon"));

  let idleTimer = 0;
  let cycleTimer = 0;
  let cycleIndex = 0;

  function clearCycle() {
    clearTimeout(cycleTimer);
    cycleIndex = 0;
    navItems().forEach((item) => item.classList.remove("sidebar-idle-nudge"));
    sidebar.classList.remove("sidebar-idle-active");
  }

  function runCycleStep() {
    const items = navItems();
    if (!items.length || document.hidden) {
      clearCycle();
      return;
    }

    items.forEach((item) => item.classList.remove("sidebar-idle-nudge"));
    const item = items[cycleIndex % items.length];
    item.classList.add("sidebar-idle-nudge");
    cycleIndex += 1;
    cycleTimer = window.setTimeout(runCycleStep, ICON_GAP_MS);
  }

  function startIdleCycle() {
    if (document.hidden) return;
    sidebar.classList.add("sidebar-idle-active");
    cycleIndex = 0;
    runCycleStep();
  }

  function resetIdle() {
    clearCycle();
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(startIdleCycle, IDLE_MS);
  }

  ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click", "wheel"].forEach((evt) => {
    document.addEventListener(evt, resetIdle, { passive: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearCycle();
    else resetIdle();
  });

  resetIdle();
}
