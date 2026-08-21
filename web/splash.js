/**
 * Lion splash — index.html only, once per browser (cookie lionpath_splash_seen=1).
 *
 * Reset splash: open DevTools → Application → Cookies → delete lionpath_splash_seen,
 * or visit index.html?splash=reset then reload, or run:
 *   document.cookie = "lionpath_splash_seen=; Max-Age=0; path=/"
 * Force replay without clearing cookie: index.html?splash=1
 */

import "./thinking-orb.js";
import "./decrypt-text.js";

const COOKIE_NAME = "lionpath_splash_seen";
const SPLASH_MS = 2000;

function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name, value, days = 365) {
  const maxAge = days * 86400;
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
}

function shouldShowSplash() {
  const params = new URLSearchParams(location.search);
  if (params.get("splash") === "reset") {
    document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/`;
    params.delete("splash");
    const qs = params.toString();
    history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
    return true;
  }
  if (params.get("splash") === "1") return true;
  // Production SSO: skip pre-login splash — go straight to sign-in (post-auth loader handles wait states).
  try {
    const host = location.hostname;
    if (
      host === "portal.benjaminsquare.com" ||
      host === "yonus.benjaminsquare.com" ||
      host === "lionpath.benjaminsquare.com" ||
      /\.run\.app$/.test(host)
    ) {
      return false;
    }
  } catch {
    // ignore
  }
  try {
    if (sessionStorage.getItem("se-sp-session") || localStorage.getItem("se-sp-session-local")) {
      return false;
    }
  } catch {
    // ignore storage errors
  }
  return getCookie(COOKIE_NAME) !== "1";
}

/** Force-hide fallback so a stalled boot never traps the user behind the splash. */
const SAFETY_MS = 10000;

function runSplash() {
  const el = document.getElementById("lion-splash");
  if (!el) return;
  el.querySelector(".lion-title")?.setAttribute("data-decrypt-static", "");

  // Splash is visible from markup as a boot cover (prevents unstyled login FOUC).
  // Lift it once the app reveals its first real surface — and, on branded runs,
  // only after the minimum display time has elapsed.
  const branded = shouldShowSplash();
  const minMs = branded ? SPLASH_MS : 0;
  const startedAt = performance.now();
  const loginView = document.getElementById("login-view");
  const appShell = document.getElementById("app-shell");
  const appLoading = document.getElementById("app-loading");
  const targets = [loginView, appShell, appLoading].filter(Boolean);

  el.hidden = false;
  el.classList.add("lion-splash-active");
  document.body.classList.add("splash-lock");

  let done = false;
  let scheduled = false;
  let mo = null;

  const dismiss = () => {
    if (done) return;
    done = true;
    if (mo) mo.disconnect();
    el.classList.add("lion-splash-fade");
    window.setTimeout(() => {
      el.hidden = true;
      el.classList.remove("lion-splash-active", "lion-splash-fade");
      document.body.classList.remove("splash-lock");
      if (branded) setCookie(COOKIE_NAME, "1");
    }, 700);
  };

  const maybeDismiss = () => {
    if (done || scheduled) return;
    // #lion-splash owns first paint; do not create or reveal loader/card markup here.
    const readyForHandoff =
      !loginView?.hidden || (!!appShell && !appShell.hidden && (appLoading?.hidden ?? true));
    if (!readyForHandoff) return;
    scheduled = true;
    const wait = Math.max(0, minMs - (performance.now() - startedAt));
    window.setTimeout(dismiss, wait);
  };

  if (targets.length) {
    mo = new MutationObserver(maybeDismiss);
    for (const t of targets) mo.observe(t, { attributes: true, attributeFilter: ["hidden"] });
  }
  maybeDismiss();
  window.setTimeout(dismiss, SAFETY_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runSplash);
} else {
  runSplash();
}
