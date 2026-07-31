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

  function measureSidebarAlignment(collapsed) {
    const sidebarRect = sidebar.getBoundingClientRect();
    const sidebarCenter = sidebarRect.left + sidebarRect.width / 2;
    const navBtn = sidebar.querySelector("fw-button.nav-item");
    const icon = navBtn?.querySelector("[data-nav-icon], .nav-icon");
    const iconRect = icon?.getBoundingClientRect();
    const logo = sidebar.querySelector(".sidebar-brand-logo");
    const logoRect = logo?.getBoundingClientRect();
    const brandCopy = sidebar.querySelector(".sidebar-brand-copy");
    const shadowBtn = navBtn?.shadowRoot?.querySelector(".fw-btn");
    const stylesHref = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map((l) => l.href)
      .find((h) => h.includes("styles.css"));
    return {
      collapsed,
      sidebarWidth: Math.round(sidebarRect.width),
      iconOffset: iconRect ? Math.round(Math.abs(iconRect.left + iconRect.width / 2 - sidebarCenter)) : null,
      logoOffset: logoRect ? Math.round(Math.abs(logoRect.left + logoRect.width / 2 - sidebarCenter)) : null,
      logoClipped: logoRect
        ? logoRect.left < sidebarRect.left - 0.5 || logoRect.right > sidebarRect.right + 0.5
        : null,
      brandCopyDisplay: brandCopy ? getComputedStyle(brandCopy).display : null,
      navBtnSize: navBtn?.getAttribute("size") || null,
      shadowBtnClass: shadowBtn?.className || null,
      stylesHref: stylesHref || null,
    };
  }

  function logSidebarDebug(collapsed, runId = "pre-fix") {
    // #region agent log
    fetch("http://127.0.0.1:7865/ingest/46e458f7-44ce-49a5-87ef-1bb8839e9c5e", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "0a6d10" },
      body: JSON.stringify({
        sessionId: "0a6d10",
        runId,
        hypothesisId: collapsed ? "B-collapsed" : "E-expanded",
        location: "sidebar.js:applyCollapsed",
        message: "sidebar alignment snapshot",
        data: measureSidebarAlignment(collapsed),
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
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
    requestAnimationFrame(() => logSidebarDebug(collapsed));
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
}
