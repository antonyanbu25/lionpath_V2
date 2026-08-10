/**
 * Dev-only "Login as…" picker — switch to any user.
 * Works in dummy-auth mode (setSession) AND Firebase SSO mode (custom token endpoint).
 * Only visible to 3 dev accounts.
 */

import { setSession } from "./auth.js";
import { isFirebaseAuthEnabled, WORKER_BASE_URL } from "./firebase-config.js";
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

export function showLoginAsPicker() {
  const overlay = document.getElementById("login-as-overlay");
  if (!overlay) return;
  overlay.hidden = false;

  const list = document.getElementById("login-as-list");
  const search = document.getElementById("login-as-search");
  if (!list) return;

  const isSso = isFirebaseAuthEnabled();

  if (!list.dataset.populated) {
    list.dataset.populated = "1";
    if (isSso) {
      // SSO mode: text input for target email (dev knows who they want)
      renderSsoList(list, search);
    } else {
      // Dummy mode: load from dummy-users.js
      import("./dummy-users.js").then((mod) => {
        const users = Object.entries(mod.DUMMY_USERS || {});
        renderUserList(list, users, search);
      });
    }
  } else {
    if (search) {
      search.value = "";
      search.focus();
      if (isSso) {
        const input = document.getElementById("login-as-email-input");
        if (input) { input.value = ""; input.focus(); }
      } else {
        filterUsers("", list);
      }
    }
  }
}

function renderSsoList(list, search) {
  if (search) search.hidden = true;
  list.innerHTML =
    `<div style="padding:0 0 8px;font-size:12px;color:var(--dew-text-muted)">
      Enter the email of the user to impersonate:
    </div>
    <div style="padding:0 0 8px">
      <input type="email" id="login-as-email-input" placeholder="user@freshworks.com"
        style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--dew-border,#ddd);font:inherit;background:var(--dew-surface,#fff);color:inherit;box-sizing:border-box" />
    </div>
    <button type="button" id="login-as-go-btn"
      style="width:100%;padding:8px;border-radius:8px;border:none;background:var(--dew-brand,#5a4fcf);color:#fff;font:inherit;font-weight:500;cursor:pointer">
      Impersonate
    </button>
    <div id="login-as-status" style="padding:6px 0 0;font-size:12px;color:var(--dew-text-muted)" hidden></div>`;
  const input = document.getElementById("login-as-email-input");
  const goBtn = document.getElementById("login-as-go-btn");
  const statusEl = document.getElementById("login-as-status");
  if (!input || !goBtn) return;

  const go = () => {
    const email = input.value.trim().toLowerCase();
    if (!email) { input.focus(); return; }
    if (!email.includes("@")) {
      statusEl.textContent = "Enter a full email address (user@freshworks.com)";
      statusEl.hidden = false;
      return;
    }
    switchToUserSso(email, statusEl);
  };
  goBtn.addEventListener("click", go);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
  input.focus();
}

function renderUserList(list, entries, search) {
  if (search) search.hidden = false;
  list.innerHTML = entries
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
    el.addEventListener("click", () => {
      switchToUserDummy(el.dataset.email, el.dataset.name, el.dataset.role);
    });
  });
  if (search) {
    search.value = "";
    search.oninput = () => filterUsers(search.value, list);
    search.focus();
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

function switchToUserDummy(email, name, role) {
  const overlay = document.getElementById("login-as-overlay");
  if (overlay) overlay.hidden = true;
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

async function switchToUserSso(email, statusEl) {
  const overlay = document.getElementById("login-as-overlay");
  const goBtn = document.getElementById("login-as-go-btn");

  if (statusEl) statusEl.hidden = false;
  if (statusEl) statusEl.textContent = "Getting auth token…";
  if (goBtn) goBtn.disabled = true;

  try {
    // Wait for Firebase auth to be available (retry until ready)
    let fbAuth = null;
    for (let i = 0; i < 50; i++) {
      if (window.__fb?.auth) {
        fbAuth = window.__fb.auth;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!fbAuth) {
      if (statusEl) statusEl.textContent = "Firebase auth not ready after 10s. Reload and try again.";
      if (goBtn) goBtn.disabled = false;
      return;
    }

    // Wait for auth state to resolve (currentUser may be null initially)
    if (typeof fbAuth.authStateReady === "function") {
      await fbAuth.authStateReady();
    }

    const user = fbAuth.currentUser;
    if (!user) {
      if (statusEl) statusEl.textContent = "Not signed in to Firebase. Try again.";
      if (goBtn) goBtn.disabled = false;
      return;
    }

    const idToken = await user.getIdToken();

    if (statusEl) statusEl.textContent = "Requesting impersonation token…";

    const base = WORKER_BASE_URL;
    const res = await fetch(`${base}/api/admin/impersonate-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`,
      },
      body: JSON.stringify({ targetEmail: email }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Request failed" }));
      if (statusEl) statusEl.textContent = `Failed: ${err.error || res.statusText}`;
      if (goBtn) goBtn.disabled = false;
      return;
    }
    const data = await res.json();
    if (statusEl) statusEl.textContent = "Signing in with custom token…";

    const authMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    await authMod.signInWithCustomToken(fbAuth, data.token);
    if (overlay) overlay.hidden = true;
    location.reload();
  } catch (err) {
    if (statusEl) statusEl.textContent = `Failed: ${err?.message || "unknown error"}`;
    if (goBtn) goBtn.disabled = false;
  }
}

// Wire button click immediately — module loads via dynamic import so DOM is ready
{
  const btn = document.getElementById("user-menu-login-as");
  if (btn) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeUserMenu();
      showLoginAsPicker();
    });
  }

  const overlay = document.getElementById("login-as-overlay");
  if (overlay) {
    const closeBtn = document.getElementById("login-as-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => { overlay.hidden = true; });
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const o = document.getElementById("login-as-overlay");
      if (o && !o.hidden) o.hidden = true;
    }
  });
}
