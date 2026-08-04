/**
 * Lion splash — index.html only, once per browser (cookie lionpath_splash_seen=1).
 *
 * Reset splash: open DevTools → Application → Cookies → delete lionpath_splash_seen,
 * or visit index.html?splash=reset then reload, or run:
 *   document.cookie = "lionpath_splash_seen=; Max-Age=0; path=/"
 * Force replay without clearing cookie: index.html?splash=1
 */

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
  try {
    if (sessionStorage.getItem("se-sp-session") || localStorage.getItem("se-sp-session-local")) {
      return false;
    }
  } catch {
    // ignore storage errors
  }
  return getCookie(COOKIE_NAME) !== "1";
}

function runSplash() {
  const el = document.getElementById("lion-splash");
  if (!el || !shouldShowSplash()) return;

  el.hidden = false;
  el.classList.add("lion-splash-active");
  document.body.classList.add("splash-lock");

  window.setTimeout(() => {
    el.classList.add("lion-splash-fade");
    window.setTimeout(() => {
      el.hidden = true;
      el.classList.remove("lion-splash-active", "lion-splash-fade");
      document.body.classList.remove("splash-lock");
      setCookie(COOKIE_NAME, "1");
    }, 700);
  }, SPLASH_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runSplash);
} else {
  runSplash();
}
