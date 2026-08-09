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
      // Restore feedback to original position
      restoreFeedbackPosition();
    } else if (choice === "hidden") {
      document.body.classList.add("cs-hidden");
      document.body.classList.remove("cs-timer");
      // Move feedback button to where Accounts nav was
      moveFeedbackToNav();
    }
  }

  // Keep reference to original feedback parent/sibling for restoration
  var feedbackOrigParent = null;
  var feedbackOrigNextSibling = null;

  function captureFeedbackPosition() {
    var fb = document.getElementById("sidebar-feedback");
    if (fb && !feedbackOrigParent) {
      feedbackOrigParent = fb.parentNode;
      feedbackOrigNextSibling = fb.nextSibling;
    }
  }

  function moveFeedbackToNav() {
    var fb = document.getElementById("sidebar-feedback");
    var nav = document.querySelector(".sidebar-nav");
    var accounts = nav?.querySelector('.nav-item[data-view="accounts"]');
    if (!fb || !nav || !accounts) return;
    captureFeedbackPosition();
    // Insert feedback button right after the accounts position (which is hidden via CSS)
    if (accounts.nextSibling) {
      nav.insertBefore(fb, accounts.nextSibling);
    } else {
      nav.appendChild(fb);
    }
  }

  function restoreFeedbackPosition() {
    var fb = document.getElementById("sidebar-feedback");
    if (!fb || !feedbackOrigParent) return;
    if (feedbackOrigNextSibling) {
      feedbackOrigParent.insertBefore(fb, feedbackOrigNextSibling);
    } else {
      feedbackOrigParent.appendChild(fb);
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
