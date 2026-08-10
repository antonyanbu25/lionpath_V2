/**
 * Dev-only "Login as…" picker — switch to any dummy account.
 * Only visible to 3 dev accounts in dummy-auth mode.
 */

import { isDummyAuth, setSession } from "./auth.js";
import { stableUserIdForEmail } from "./domain/id.js";
import { DEMO_TEAM_ID } from "./domain/constants.js";
import { closeUserMenu } from "./user-menu.js";

const DEV_EMAILS = [
  "sathish.kuttan@freshworks.com",
  "antony.sagayaraj@freshworks.com",
  "sowrav.sunil@freshworks.com",
];

/** @param {string|null|undefined} email */
export function isDevAccount(email) {
  return DEV_EMAILS.includes(String(email || "").trim().toLowerCase());
}

export function initLoginAs() {
  const btn = document.getElementById("user-menu-login-as");
  if (!btn) return;
  if (btn.dataset.loginAsWired) return;
  btn.dataset.loginAsWired = "1";
  btn.hidden = false;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeUserMenu();
    showLoginAsPicker();
  });
}

function showLoginAsPicker() {
  const overlay = document.getElementById("login-as-overlay");
  if (!overlay) return;
  overlay.hidden = false;

  const list = document.getElementById("login-as-list");
  const search = document.getElementById("login-as-search");
  if (!list) return;

  // Load users on first open
  if (!list.dataset.populated) {
    list.dataset.populated = "1";
    import("./dummy-users.js").then((mod) => {
      const users = Object.entries(mod.DUMMY_USERS || {});
      list.innerHTML = users
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(
          ([email, u]) =>
            `<button type="button" class="login-as-user" data-email="${email}" data-role="${u.role}" data-name="${u.name}">
              <span class="login-as-user-name">${u.name}</span>
              <span class="login-as-user-email">${email}</span>
              <span class="login-as-user-role">${u.role}</span>
            </button>`,
        )
        .join("");
      list.querySelectorAll(".login-as-user").forEach((el) => {
        el.addEventListener("click", () => switchToUser(el.dataset.email, el.dataset.name, el.dataset.role));
      });
      if (search) {
        search.value = "";
        search.oninput = () => filterUsers(search.value, list);
        search.focus();
      }
    });
  } else {
    if (search) {
      search.value = "";
      search.focus();
      filterUsers("", list);
    }
  }
}

function filterUsers(q, list) {
  const term = q.toLowerCase().trim();
  for (const el of list.children) {
    const email = (el.dataset.email || "").toLowerCase();
    const name = (el.dataset.name || "").toLowerCase();
    el.hidden = term && !email.includes(term) && !name.includes(term);
  }
}

function switchToUser(email, name, role) {
  // Close the picker first so sessionStorage.clear doesn't interfere
  const overlay = document.getElementById("login-as-overlay");
  if (overlay) overlay.hidden = true;

  // Clear proxied SE selection so the new user starts fresh
  try {
    sessionStorage.removeItem("se-sp-proxy-se:" + String(email).trim().toLowerCase());
  } catch { /* ok */ }

  const userId = stableUserIdForEmail(email);
  const session = {
    userId,
    uid: userId,
    authUid: null,
    role,
    email,
    name,
    teamId: DEMO_TEAM_ID,
  };
  setSession(session, { freshLogin: true });
  location.reload();
}

// Close overlay on backdrop click or Escape
document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("login-as-overlay");
  if (!overlay) return;
  const closeBtn = document.getElementById("login-as-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => { overlay.hidden = true; });
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) overlay.hidden = true;
  });
});
