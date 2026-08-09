(function () {
  "use strict";

  var activeToast = null;
  var activeTimer = null;

  function clearActive() {
    if (activeTimer) window.clearTimeout(activeTimer);
    activeTimer = null;
    if (activeToast) activeToast.remove();
    activeToast = null;
  }

  function show(message, durationMs) {
    clearActive();

    var totalMs = Number.isFinite(Number(durationMs)) ? Number(durationMs) : 3000;
    var msg = message || "Preference saved!";

    var toast = document.createElement("div");
    toast.className = "boss-toast boss-toast--enter";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = msg;
    document.body.appendChild(toast);
    activeToast = toast;

    activeTimer = window.setTimeout(function () {
      if (activeTimer) window.clearTimeout(activeTimer);
      activeTimer = null;
      toast.classList.remove("boss-toast--enter");
      toast.classList.add("boss-toast--exit");
      window.setTimeout(function () {
        if (activeToast) activeToast.remove();
        activeToast = null;
      }, 300);
    }, totalMs);
  }

  window.BossToast = {
    show: show,
  };
})();
