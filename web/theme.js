/** Dark / light theme — persisted in localStorage (lionpath_theme). Default: light. */

const THEME_KEY = "lionpath_theme";
const DEFAULT_THEME = "light";

function preferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return DEFAULT_THEME;
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
}

function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
}

function bindThemeToggles() {
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    if (btn.dataset.themeBound) return;
    btn.dataset.themeBound = "1";
    btn.addEventListener("fwClick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleTheme();
    });
  });
}

export function initTheme() {
  applyTheme(preferredTheme());
  bindThemeToggles();
  if (typeof customElements !== "undefined") {
    customElements.whenDefined("fw-button").then(bindThemeToggles);
  }
  document.addEventListener("DOMContentLoaded", bindThemeToggles);
}

initTheme();
