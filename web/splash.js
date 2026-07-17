/**
 * Lion splash — permanently disabled.
 * Neutralizes cached legacy splash.js and removes any splash DOM.
 */

const SPLASH_COOKIE = "lionpath_splash_seen=1; Max-Age=31536000; Path=/; SameSite=Lax";

function killSplash() {
  document.documentElement.setAttribute("data-theme", "light");
  document.documentElement.style.colorScheme = "light";
  document.documentElement.classList.remove("fw-dark-theme");
  localStorage.setItem("lionpath_theme", "light");
  document.cookie = SPLASH_COOKIE;
  document.querySelectorAll("#lion-splash, .lion-splash").forEach((el) => el.remove());
  document.body?.classList.remove("splash-lock");
}

killSplash();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", killSplash);
} else {
  killSplash();
}

// Block legacy cached modules that define runSplash/show logic.
window.runSplash = killSplash;
window.shouldShowSplash = () => false;
