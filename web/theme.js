/** Dark / light theme. persisted in localStorage (lionpath_theme). */

const THEME_KEY = "lionpath_theme";

function preferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  document.documentElement.classList.toggle("fw-dark-theme", theme === "dark");
  localStorage.setItem(THEME_KEY, theme);
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    if (btn.closest("#login-view")) {
      btn.hidden = true;
      btn.style.display = "none";
      return;
    }
    const isDark = theme === "dark";
    btn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    const iconHost = btn.querySelector(".theme-toggle-icon");
    if (iconHost) {
      btn.classList.toggle("theme-is-dark", isDark);
      const moon = iconHost.querySelector(".theme-moon-icon");
      const sun = iconHost.querySelector(".theme-sun-icon");
      if (moon) moon.hidden = isDark;
      if (sun) sun.hidden = !isDark;
    } else {
      btn.textContent = isDark ? "☀️" : "🌙";
    }
  });
  syncThemeMenuState(document);
}

export function getTheme() {
  return document.documentElement.getAttribute("data-theme") || preferredTheme();
}

export function setTheme(theme) {
  if (theme !== "light" && theme !== "dark") return;
  applyTheme(theme);
}

function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
}

function wireThemeToggles() {
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    if (btn.closest("#login-view")) {
      btn.hidden = true;
      btn.style.display = "none";
      return;
    }
    if (btn.dataset.themeWired === "1") return;
    btn.dataset.themeWired = "1";
    btn.addEventListener("fwClick", toggleTheme);
    btn.addEventListener("click", toggleTheme);
  });
  applyTheme(getTheme());
}

function injectJanusLogoStyles() {
  if (document.getElementById("janus-logo-blend-styles")) return;
  const style = document.createElement("style");
  style.id = "janus-logo-blend-styles";
  style.textContent = `
    .sidebar-brand-logo {
      width: auto !important;
      height: 32px !important;
      max-height: 32px;
      object-fit: contain;
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
      border-radius: 4px;
      padding: 0;
      mix-blend-mode: multiply;
    }

    [data-theme="dark"] .sidebar-brand-logo {
      filter: invert(1) grayscale(1) contrast(1.12) brightness(1.08);
      mix-blend-mode: screen;
    }
  `;
  document.head.appendChild(style);
}

/** Wire Light/Dark options inside user menu panel. */
export function wireThemeMenu(root = document) {
  const scope = root instanceof Element ? root : document;
  scope.querySelectorAll(".user-menu-theme-option").forEach((btn) => {
    if (btn.dataset.themeMenuWired === "1") return;
    btn.dataset.themeMenuWired = "1";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const value = btn.dataset.themeValue;
      if (value === "light" || value === "dark") setTheme(value);
      syncThemeMenuState(scope);
    });
  });
  syncThemeMenuState(scope);
}

/** Mark active theme option in menu. */
export function syncThemeMenuState(root = document) {
  const scope = root instanceof Element ? root : document;
  const current = getTheme();
  scope.querySelectorAll(".user-menu-theme-option").forEach((btn) => {
    const active = btn.dataset.themeValue === current;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-checked", active ? "true" : "false");
  });
}

export function initTheme() {
  injectJanusLogoStyles();
  applyTheme(preferredTheme());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireThemeToggles);
  } else {
    wireThemeToggles();
  }
}

initTheme();
