(function () {
  const TARGET_TIME = new Date("2026-08-16T17:30:00+05:30").getTime();
  const LOGO_URL = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQzqZF9fmoOKnnC88QNQk7vJLSYcZ6mPmffHIj9PDmpnqXvUWwt3NLqMJ3T&s=10";
  let activeTimer = null;
  let mountedRoot = null;

  function pad(value) {
    return String(Math.max(0, value)).padStart(2, "0");
  }

  function partsUntilLaunch() {
    const remaining = Math.max(0, TARGET_TIME - Date.now());
    const totalSeconds = Math.floor(remaining / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { days, hours, minutes, seconds };
  }

  function updateTimer(root) {
    const parts = partsUntilLaunch();
    root.querySelector("[data-coming-soon-days]").textContent = pad(parts.days);
    root.querySelector("[data-coming-soon-hours]").textContent = pad(parts.hours);
    root.querySelector("[data-coming-soon-minutes]").textContent = pad(parts.minutes);
    root.querySelector("[data-coming-soon-seconds]").textContent = pad(parts.seconds);
  }

  function render() {
    return `
      <main class="coming-soon-shell" aria-labelledby="coming-soon-title">
        <section class="coming-soon-card">
          <img class="coming-soon-logo" src="${LOGO_URL}" alt="Freshworks logo" width="96" height="96" />
          <p class="coming-soon-product">Freshworks SE Portal</p>
          <h1 id="coming-soon-title">Coming Soon</h1>
          <p class="coming-soon-copy">We are putting the finishing touches on this experience.</p>
          <div class="coming-soon-timer" aria-label="Countdown to launch">
            <div class="coming-soon-timebox">
              <span data-coming-soon-days>00</span>
              <small>Days</small>
            </div>
            <div class="coming-soon-separator" aria-hidden="true">:</div>
            <div class="coming-soon-timebox">
              <span data-coming-soon-hours>00</span>
              <small>Hours</small>
            </div>
            <div class="coming-soon-separator" aria-hidden="true">:</div>
            <div class="coming-soon-timebox">
              <span data-coming-soon-minutes>00</span>
              <small>Minutes</small>
            </div>
            <div class="coming-soon-separator" aria-hidden="true">:</div>
            <div class="coming-soon-timebox">
              <span data-coming-soon-seconds>00</span>
              <small>Seconds</small>
            </div>
          </div>
          <footer class="coming-soon-footer">Copyright Freshworks. All rights reserved.</footer>
        </section>
      </main>
    `;
  }

  function unmount() {
    if (activeTimer) {
      clearInterval(activeTimer);
      activeTimer = null;
    }
    if (mountedRoot) {
      mountedRoot.innerHTML = "";
      mountedRoot = null;
    }
  }

  function mount(target) {
    if (!target) return;
    unmount();
    target.innerHTML = render();
    mountedRoot = target;
    updateTimer(target);
    activeTimer = setInterval(() => updateTimer(target), 1000);
  }

  window.ComingSoon = { mount, unmount };
})();
