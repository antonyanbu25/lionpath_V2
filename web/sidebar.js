/**
 * Desktop sidebar collapse — persists in localStorage (lionpath_sidebar_collapsed).
 * Mobile (<768px) keeps the existing overlay drawer; collapse is desktop-only.
 */

const STORAGE_KEY = "lionpath_sidebar_collapsed";
const MOBILE_MQ = "(max-width: 768px)";

export function initSidebar() {
  const sidebar = document.getElementById("sidebar");
  const collapseBtn = document.getElementById("sidebar-collapse");
  const appShell = document.getElementById("app-shell");
  if (!sidebar || !collapseBtn) return;

  const mq = window.matchMedia(MOBILE_MQ);

  function isMobile() {
    return mq.matches;
  }

  function readCollapsed() {
    if (isMobile()) return false;
    return localStorage.getItem(STORAGE_KEY) === "1";
  }

  function applyCollapsed(collapsed) {
    if (isMobile()) {
      sidebar.classList.remove("sidebar-collapsed");
      appShell?.classList.remove("sidebar-is-collapsed");
      collapseBtn.hidden = true;
      collapseBtn.setAttribute("aria-expanded", "true");
      return;
    }

    collapseBtn.hidden = false;
    sidebar.classList.toggle("sidebar-collapsed", collapsed);
    appShell?.classList.toggle("sidebar-is-collapsed", collapsed);
    collapseBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    collapseBtn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    const glyph = collapseBtn.querySelector(".sidebar-collapse-glyph");
    if (glyph) glyph.textContent = collapsed ? "›" : "‹";
  }

  function setCollapsed(collapsed) {
    if (!isMobile()) {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    }
    applyCollapsed(collapsed);
  }

  collapseBtn.addEventListener("fwClick", () => {
    setCollapsed(!sidebar.classList.contains("sidebar-collapsed"));
  });

  mq.addEventListener("change", () => applyCollapsed(readCollapsed()));
  applyCollapsed(readCollapsed());
}
