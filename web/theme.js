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
    const isDark = theme === "dark";
    btn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    btn.textContent = isDark ? "☀️" : "🌙";
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
    if (btn.dataset.themeWired === "1") return;
    btn.dataset.themeWired = "1";
    btn.addEventListener("fwClick", toggleTheme);
    btn.addEventListener("click", toggleTheme);
  });
  applyTheme(getTheme());
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
  applyTheme(preferredTheme());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireThemeToggles);
  } else {
    wireThemeToggles();
  }
}

initTheme();
