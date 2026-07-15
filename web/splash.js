/**
 * Lion splash — index.html only, once per browser (cookie lionpath_splash_seen=1).
 *
 * Reset splash: open DevTools → Application → Cookies → delete lionpath_splash_seen,
 * or visit index.html?splash=reset then reload, or run:
 *   document.cookie = "lionpath_splash_seen=; Max-Age=0; path=/"
 * Force replay without clearing cookie: index.html?splash=1
 */

const COOKIE_NAME = "lionpath_splash_seen";
const SPLASH_MS = 5000;

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
  return getCookie(COOKIE_NAME) !== "1";
}

/** Short synthesized roar — no external audio file. */
function playRoar() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.45, t0 + 0.08);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(140, t0);
    osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.9);
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.55;
    osc.connect(oscGain);
    oscGain.connect(master);
    osc.start(t0);
    osc.stop(t0 + 1.1);

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.setValueAtTime(400, t0);
    noiseFilter.frequency.exponentialRampToValueAtTime(80, t0 + 0.7);
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.35;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(t0 + 0.05);
    noise.stop(t0 + 0.75);

    window.setTimeout(() => ctx.close().catch(() => {}), 2000);
  } catch {
    // Autoplay policy or unsupported — splash still shows visually
  }
}

function runSplash() {
  const el = document.getElementById("lion-splash");
  if (!el || !shouldShowSplash()) return;

  el.hidden = false;
  el.classList.add("lion-splash-active");
  document.body.classList.add("splash-lock");

  window.setTimeout(playRoar, 600);

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
