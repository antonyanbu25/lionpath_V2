/**
 * Lion roar from recorded audio (Mixkit — mixkit.co, free license).
 * Shared by splash screen and post-sign-in welcome.
 */

const ROAR_SRC = new URL("./audio/lion-roar.mp3", import.meta.url).href;

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * @param {{ short?: boolean }} [opts]
 *   short — clip to ~1.2s for splash; full ~2.5s for sign-in
 */
export function playRoar(opts = {}) {
  if (prefersReducedMotion()) return;

  try {
    const short = !!opts.short;
    const audio = new Audio(ROAR_SRC);
    audio.volume = short ? 0.7 : 0.9;
    const limitMs = short ? 1200 : 2500;

    audio.play().catch(() => {});

    window.setTimeout(() => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }, limitMs);
  } catch {
    // Autoplay policy or unsupported — visual-only fallback
  }
}

/** Brief lion icon pulse in the top bar after sign-in. */
export function triggerSignInPulse() {
  const el = document.getElementById("signin-lion-pulse");
  if (!el) return;
  el.hidden = false;
  el.classList.remove("signin-lion-pulse-active");
  void el.offsetWidth;
  el.classList.add("signin-lion-pulse-active");
  window.setTimeout(() => {
    el.classList.remove("signin-lion-pulse-active");
    el.hidden = true;
  }, prefersReducedMotion() ? 400 : 2400);
}
