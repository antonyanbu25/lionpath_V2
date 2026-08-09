(function () {
  "use strict";

  var activeToast = null;
  var activeTimer = null;

  function clearActive() {
    if (activeTimer) window.clearInterval(activeTimer);
    activeTimer = null;
    if (activeToast) activeToast.remove();
    activeToast = null;
  }

  function show(message, durationMs) {
    clearActive();

    var totalMs = Number.isFinite(Number(durationMs)) ? Number(durationMs) : 30000;
    var remaining = Math.max(0, Math.ceil(totalMs / 1000));
    var baseMessage = message || "Updates being applied. Estimated time: 30s";

    var toast = document.createElement("div");
    toast.className = "boss-toast boss-toast--enter";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
    activeToast = toast;

    function setProgress() {
      toast.textContent = baseMessage + " (" + remaining + ")";
    }

    function finish() {
      if (activeTimer) window.clearInterval(activeTimer);
      activeTimer = null;
      toast.textContent = "Done!";
      window.setTimeout(function () {
        toast.classList.remove("boss-toast--enter");
        toast.classList.add("boss-toast--exit");
      }, 450);
      window.setTimeout(function () {
        window.location.reload();
      }, 900);
    }

    setProgress();
    activeTimer = window.setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        finish();
      } else {
        setProgress();
      }
    }, 1000);
  }

  window.BossToast = {
    show: show,
  };
})();
