(function () {
  "use strict";

  function trigger(choice) {
    if (choice !== "timer" && choice !== "hidden") return;
    if (window.BossToast && typeof window.BossToast.show === "function") {
      window.BossToast.show("Updates being applied. Estimated time: 30s", 30000);
      return;
    }
    window.setTimeout(function () {
      window.location.reload();
    }, 30000);
  }

  window.BossRedeploy = {
    trigger: trigger,
  };
})();
