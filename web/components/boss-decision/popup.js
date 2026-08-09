(function () {
  "use strict";

  var overlay = null;
  var selectedChoice = null;

  function button(label, className, onClick) {
    var el = document.createElement("button");
    el.type = "button";
    el.className = className;
    el.textContent = label;
    el.addEventListener("click", onClick);
    return el;
  }

  function renderStepOne(modal) {
    selectedChoice = null;
    modal.innerHTML = "";

    var title = document.createElement("h2");
    title.id = "boss-decision-title";
    title.textContent = "How do you want the unfinished tabs to look?";

    var actions = document.createElement("div");
    actions.className = "boss-actions boss-actions--stack";
    actions.append(
      button("See with coming soon timer", "boss-button boss-button--primary", function () {
        renderStepTwo(modal, "timer");
      }),
      button("See with icons hidden", "boss-button boss-button--secondary", function () {
        renderStepTwo(modal, "hidden");
      }),
    );

    modal.append(title, actions);
  }

  function renderStepTwo(modal, choice) {
    selectedChoice = choice;
    modal.innerHTML = "";

    var title = document.createElement("h2");
    title.id = "boss-decision-title";
    title.textContent = "Apply preference now? Reload to see the update.";

    var actions = document.createElement("div");
    actions.className = "boss-actions";
    actions.append(
      button("Cancel", "boss-button boss-button--secondary", function () {
        window.BossPopup.unmount();
      }),
      button("Continue", "boss-button boss-button--primary", function () {
        if (window.BossDecision && typeof window.BossDecision.recordDecision === "function") {
          window.BossDecision.recordDecision(selectedChoice);
        }
        window.BossPopup.unmount();
        if (window.BossRedeploy && typeof window.BossRedeploy.trigger === "function") {
          window.BossRedeploy.trigger(selectedChoice);
        } else if (window.BossToast && typeof window.BossToast.show === "function") {
          window.BossToast.show("Updates being applied. Estimated time: 30s", 30000);
        } else {
          window.setTimeout(function () {
            window.location.reload();
          }, 30000);
        }
      }),
    );

    modal.append(title, actions);
  }

  function mount(container) {
    if (overlay) return;
    var host = container || document.body;

    overlay = document.createElement("div");
    overlay.className = "boss-overlay";
    overlay.setAttribute("role", "presentation");

    var modal = document.createElement("section");
    modal.className = "boss-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "boss-decision-title");

    renderStepOne(modal);
    overlay.appendChild(modal);
    host.appendChild(overlay);
    var first = modal.querySelector("button");
    if (first) first.focus();
  }

  function unmount() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    selectedChoice = null;
  }

  window.BossPopup = {
    mount: mount,
    unmount: unmount,
  };
})();
