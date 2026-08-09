(function () {
  "use strict";

  function trigger(choice) {
    if (choice !== "timer" && choice !== "hidden") return;
    // Apply immediately — no fake 30s countdown
    if (typeof window.BossDecision?.applyChoice === "function") {
      window.BossDecision.applyChoice(choice);
    }
    // Simple one-time notification toast
    if (window.BossToast && typeof window.BossToast.show === "function") {
      window.BossToast.show("Preference saved! Reload to see the update.", 3000);
    }
  }

  window.BossRedeploy = {
    trigger: trigger,
  };
})();
