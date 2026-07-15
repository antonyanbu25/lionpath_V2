/**
 * Synthesized lion roar via Web Audio — no external audio file.
 * Shared by splash screen and post-sign-in welcome.
 */

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * @param {{ short?: boolean }} [opts]
 *   short — very brief roar for reduced-motion fallback (~0.4s)
 */
export function playRoar(opts = {}) {
  if (prefersReducedMotion() && !opts.short) return;

  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    const short = opts.short || prefersReducedMotion();
    const duration = short ? 0.4 : 1.4;
    const fadeOut = short ? 0.35 : 1.4;
    const peakGain = short ? 0.2 : 0.45;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(peakGain, t0 + 0.08);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + fadeOut);
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(short ? 120 : 140, t0);
    osc.frequency.exponentialRampToValueAtTime(short ? 55 : 38, t0 + (short ? 0.3 : 0.9));
    const oscGain = ctx.createGain();
    oscGain.gain.value = short ? 0.35 : 0.55;
    osc.connect(oscGain);
    oscGain.connect(master);
    osc.start(t0);
    osc.stop(t0 + (short ? 0.35 : 1.1));

    const noiseLen = short ? 0.25 : 0.6;
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * noiseLen, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.setValueAtTime(400, t0);
    noiseFilter.frequency.exponentialRampToValueAtTime(80, t0 + (short ? 0.25 : 0.7));
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = short ? 0.2 : 0.35;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(t0 + 0.05);
    noise.stop(t0 + (short ? 0.3 : 0.75));

    window.setTimeout(() => ctx.close().catch(() => {}), Math.ceil(duration * 1000) + 600);
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
