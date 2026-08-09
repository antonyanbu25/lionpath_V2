(function () {
  "use strict";

  var TAKEN_KEY = "bossDecisionTaken";
  var COUNTER_KEY = "bossDecisionCounter";
  var CHOICE_KEY = "bossDecisionChoice";
  var ALLOWED_EMAILS = [
    "sathish.kuttan@freshworks.com",
    "antony.sagayaraj@freshworks.com",
  ];
  var memory = {};

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      memory[key] = String(value);
    }
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function getCounter() {
    var raw = storageGet(COUNTER_KEY);
    if (raw === null || raw === "") return 1;
    var parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 1;
  }

  function isTaken() {
    return storageGet(TAKEN_KEY) === "true";
  }

  function shouldShow(email) {
    return ALLOWED_EMAILS.indexOf(normalizeEmail(email)) !== -1 && getCounter() > 0 && !isTaken();
  }

  function recordDecision(choice) {
    if (choice !== "timer" && choice !== "hidden") return;
    storageSet(CHOICE_KEY, choice);
    storageSet(TAKEN_KEY, "true");
    storageSet(COUNTER_KEY, String(Math.max(0, getCounter() - 1)));
  }

  function getChoice() {
    var choice = storageGet(CHOICE_KEY);
    return choice === "timer" || choice === "hidden" ? choice : null;
  }

  /** Apply the stored choice immediately on the current page view */
  function applyChoice(choice) {
    if (choice === "timer") {
      document.body.classList.add("cs-timer");
      document.body.classList.remove("cs-hidden");
    } else if (choice === "hidden") {
      document.body.classList.add("cs-hidden");
      document.body.classList.remove("cs-timer");
    }
  }

  /** Auto-apply on page load if a choice was previously recorded */
  function autoApplyOnLoad() {
    var choice = getChoice();
    if (choice) applyChoice(choice);
  }

  window.BossDecision = {
    shouldShow: shouldShow,
    recordDecision: recordDecision,
    getChoice: getChoice,
    applyChoice: applyChoice,
    autoApplyOnLoad: autoApplyOnLoad,
  };
})();
