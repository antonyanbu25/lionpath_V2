import { initNavIcons } from "./nav-icons.js";

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

  function syncNavButtonSizes(collapsed) {
    sidebar.querySelectorAll("fw-button.nav-item").forEach((btn) => {
      const label = btn.querySelector(".nav-label");
      if (collapsed) {
        if (!btn.dataset.prevSize) {
          btn.dataset.prevSize = btn.getAttribute("size") || "normal";
        }
        btn.setAttribute("size", "icon");
        if (label && !btn._detachedLabel) {
          btn._detachedLabel = label;
          label.remove();
        }
      } else {
        btn.setAttribute("size", btn.dataset.prevSize || "normal");
        delete btn.dataset.prevSize;
        if (btn._detachedLabel) {
          btn.appendChild(btn._detachedLabel);
          delete btn._detachedLabel;
        }
      }
    });
  }

  // Crayons fw-button centers its content inside an encapsulated shadow `.fw-btn`
  // that has no exposed ::part, so external CSS can't left-align the expanded nav
  // items. Inject a one-time shadow style that reads a light-DOM custom property
  // (`--nav-btn-justify`), letting styles.css switch between left-aligned (expanded)
  // and centered (collapsed) via the normal cascade.
  function alignNavButton(btn) {
    const root = btn.shadowRoot;
    if (!root || root.querySelector("style[data-nav-align]")) return;
    const style = document.createElement("style");
    style.setAttribute("data-nav-align", "");
    style.textContent =
      ".fw-btn{justify-content:var(--nav-btn-justify,center)!important;width:100%!important}";
    root.appendChild(style);
  }

  function initNavAlignment() {
    sidebar.querySelectorAll("fw-button.nav-item").forEach((btn) => {
      if (typeof btn.componentOnReady === "function") {
        btn.componentOnReady().then(() => alignNavButton(btn));
      } else {
        alignNavButton(btn);
      }
    });
  }

  function applyCollapsed(collapsed) {
    if (isMobile()) {
      sidebar.classList.remove("sidebar-collapsed");
      appShell?.classList.remove("sidebar-is-collapsed");
      collapseBtn.hidden = true;
      collapseBtn.setAttribute("aria-expanded", "true");
      syncNavButtonSizes(false);
      return;
    }

    collapseBtn.hidden = false;
    sidebar.classList.toggle("sidebar-collapsed", collapsed);
    appShell?.classList.toggle("sidebar-is-collapsed", collapsed);
    syncNavButtonSizes(collapsed);
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
  initNavIcons();
  initNavAlignment();
}
