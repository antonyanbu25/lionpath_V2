/**
 * Admin assume-identity + dev login-as picker.
 * Production path: POST /api/admin/assume-identity (SQL admin role, audited, 15m TTL).
 * Dev fallback: POST /api/admin/impersonate-token (non-prod, dev emails + secret).
 */

import { setSession, logout } from "./auth.js";
import { isFirebaseAuthEnabled, WORKER_BASE_URL } from "./firebase-config.js";
import { ASSUME_IDENTITY_EXPIRED_EVENT } from "./assume-identity-client.js";
import { stableUserIdForEmail } from "./domain/id.js";
import { DEMO_TEAM_ID } from "./domain/constants.js";
import { closeUserMenu } from "./user-menu.js";

const DEV_EMAILS = [
  fwDevEmail("sathish.kuttan"),
  fwDevEmail("antony.sagayaraj"),
  fwDevEmail("sowrav.sunil"),
];
const DEV_USERS_MODULE_URL = ["./dummy", "users.js"].join("-");
const DEV_USERS_EXPORT_NAME = ["DUMMY", "USERS"].join("_");
const ASSUME_BANNER_ID = "assume-identity-banner";

function fwDevEmail(localPart) {
  return `${localPart}@freshworks.com`;
}

/** @param {string|null|undefined} email */
export function isDevAccount(email) {
  return DEV_EMAILS.includes(String(email || "").trim().toLowerCase());
}

function isLocalWorkerUrl() {
  try {
    const host = new URL(WORKER_BASE_URL).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/** @param {{ email?: string, canAssumeIdentity?: boolean } | null | undefined} session */
export function canShowLoginAsMenu(session) {
  if (!session?.email) return false;
  if (session.canAssumeIdentity === true) return true;
  return isDevAccount(session.email) && isLocalWorkerUrl();
}

/** @param {string} idToken */
export async function fetchAssumeIdentityCapabilities(idToken) {
  const base = WORKER_BASE_URL;
  const res = await fetch(`${base}/api/admin/assume-identity/capabilities`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) return { canAssumeIdentity: false };
  const data = await res.json().catch(() => ({}));
  return { canAssumeIdentity: data.canAssumeIdentity === true };
}

export function initLoginAs() {
  const btn = document.getElementById("user-menu-login-as");
  if (!btn) return;
  if (btn.dataset.loginAsWired) return;
  btn.dataset.loginAsWired = "1";
  btn.textContent = btn.textContent?.includes("Assume") ? btn.textContent : "Assume identity…";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeUserMenu();
    showLoginAsPicker();
  });

  const overlay = document.getElementById("login-as-overlay");
  if (overlay && !overlay.dataset.loginAsOverlayWired) {
    overlay.dataset.loginAsOverlayWired = "1";
    const closeBtn = document.getElementById("login-as-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        overlay.hidden = true;
      });
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const o = document.getElementById("login-as-overlay");
        if (o && !o.hidden) o.hidden = true;
      }
    });
  }
}

/** Show or hide assume-identity menu item from current session. */
export function syncLoginAsMenuVisibility(session) {
  const btn = document.getElementById("user-menu-login-as");
  if (!btn) return;
  btn.hidden = !canShowLoginAsMenu(session);
}

/** Show persistent banner when Firebase token has assume_identity claims. */
export async function initAssumeIdentityBanner(fbAuth) {
  if (!fbAuth?.currentUser) return;
  try {
    const result = await fbAuth.currentUser.getIdTokenResult();
    const claims = result?.claims || {};
    if (claims.assume_identity !== true) {
      removeAssumeIdentityBanner();
      return;
    }
    const expiresAt = String(claims.assume_expires_at || "");
    const adminEmail = String(claims.assume_admin_email || "admin");
    const targetEmail = fbAuth.currentUser.email || "";
    showAssumeIdentityBanner({ adminEmail, targetEmail, expiresAt, fbAuth });
  } catch {
    /* ignore */
  }
}

function showAssumeIdentityBanner({ adminEmail, targetEmail, expiresAt, fbAuth }) {
  let bar = document.getElementById(ASSUME_BANNER_ID);
  if (!bar) {
    bar = document.createElement("div");
    bar.id = ASSUME_BANNER_ID;
    bar.setAttribute("role", "status");
    bar.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:99999;padding:10px 16px;background:#7c2d12;color:#fff;font:500 13px/1.4 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,.25)";
    document.body.prepend(bar);
    document.documentElement.style.setProperty("--assume-banner-offset", "44px");
  }
  const expLabel = expiresAt ? new Date(expiresAt).toLocaleTimeString() : "soon";
  bar.innerHTML = "";
  const text = document.createElement("span");
  text.textContent = `ASSUME-IDENTITY — viewing as ${targetEmail} (admin: ${adminEmail}). Expires ${expLabel}.`;
  const exitBtn = document.createElement("button");
  exitBtn.type = "button";
  exitBtn.textContent = "Exit";
  exitBtn.style.cssText =
    "padding:4px 12px;border-radius:6px;border:1px solid #fff;background:transparent;color:#fff;font:inherit;cursor:pointer";
  exitBtn.addEventListener("click", () => exitAssumeIdentity(fbAuth));
  bar.appendChild(text);
  bar.appendChild(exitBtn);
}

function removeAssumeIdentityBanner() {
  const bar = document.getElementById(ASSUME_BANNER_ID);
  if (bar) bar.remove();
  document.documentElement.style.removeProperty("--assume-banner-offset");
}

async function exitAssumeIdentity(fbAuth) {
  const auth = fbAuth || window.__firebaseAuth || window.__fb?.auth;
  if (!auth?.currentUser) {
    location.reload();
    return;
  }
  const idToken = await auth.currentUser.getIdToken();
  const base = WORKER_BASE_URL;
  const res = await fetch(`${base}/api/admin/assume-identity/exit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || "Could not exit assume-identity mode.");
    return;
  }
  removeAssumeIdentityBanner();
  logout();
  const authMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  try {
    await authMod.signOut(auth);
  } catch {
    /* ok */
  }
  alert(data.message || "Assume-identity ended. Sign in with your admin account.");
  location.reload();
}

async function signInWithAssumeCustomToken(fbAuth, token) {
  const authMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  try {
    await authMod.setPersistence(fbAuth, authMod.inMemoryPersistence);
  } catch {
    /* ok */
  }
  logout();
  await authMod.signInWithCustomToken(fbAuth, token);
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
      renderSsoList(list, search);
    } else {
      import(/* @vite-ignore */ DEV_USERS_MODULE_URL).then((mod) => {
        const users = Object.entries(mod[DEV_USERS_EXPORT_NAME] || {});
        renderUserList(list, users, search);
      });
    }
  } else {
    if (search) {
      search.value = "";
      search.focus();
      if (isSso) {
        const input = document.getElementById("login-as-email-input");
        if (input) {
          input.value = "";
          input.focus();
        }
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
      Assume identity as another user (admin only). Target must exist in Firebase + SQL.
    </div>
    <div style="padding:0 0 8px">
      <input type="email" id="login-as-email-input" placeholder="se.user@freshworks.com"
        style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--dew-border,#ddd);font:inherit;background:var(--dew-surface,#fff);color:inherit;box-sizing:border-box" />
    </div>
    <div style="padding:0 0 8px">
      <textarea id="login-as-reason-input" rows="2" placeholder="Reason (min 10 chars, e.g. support ticket #1234)"
        style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--dew-border,#ddd);font:inherit;background:var(--dew-surface,#fff);color:inherit;box-sizing:border-box;resize:vertical"></textarea>
    </div>
    <button type="button" id="login-as-go-btn"
      style="width:100%;padding:8px;border-radius:8px;border:none;background:var(--dew-brand,#5a4fcf);color:#fff;font:inherit;font-weight:500;cursor:pointer">
      Assume identity
    </button>
    <div id="login-as-status" style="padding:6px 0 0;font-size:12px;color:var(--dew-text-muted)" hidden></div>`;
  const input = document.getElementById("login-as-email-input");
  const reasonEl = document.getElementById("login-as-reason-input");
  const goBtn = document.getElementById("login-as-go-btn");
  const statusEl = document.getElementById("login-as-status");
  if (!input || !goBtn || !reasonEl) return;

  const go = () => {
    const email = input.value.trim().toLowerCase();
    const reason = reasonEl.value.trim();
    if (!email) {
      input.focus();
      return;
    }
    if (!email.includes("@")) {
      statusEl.textContent = "Enter a full email address.";
      statusEl.hidden = false;
      return;
    }
    if (reason.length < 10) {
      statusEl.textContent = "Enter a reason (at least 10 characters).";
      statusEl.hidden = false;
      reasonEl.focus();
      return;
    }
    switchToUserSso(email, reason, statusEl);
  };
  goBtn.addEventListener("click", go);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) go();
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
  } catch {
    /* ok */
  }
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

async function switchToUserSso(email, reason, statusEl) {
  const overlay = document.getElementById("login-as-overlay");
  const goBtn = document.getElementById("login-as-go-btn");

  if (statusEl) statusEl.hidden = false;
  if (statusEl) statusEl.textContent = "Getting auth token…";
  if (goBtn) goBtn.disabled = true;

  try {
    let fbAuth = null;
    for (let i = 0; i < 50; i++) {
      const a = window.__firebaseAuth || window.__fb?.auth;
      if (
        a &&
        (typeof a.authStateReady !== "function" ||
          (await Promise.race([
            a.authStateReady().then(() => true),
            new Promise((r) => setTimeout(r, 3000)).then(() => false),
          ])))
      ) {
        fbAuth = a;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!fbAuth) {
      if (statusEl) statusEl.textContent = "Firebase auth not ready. Reload and try again.";
      if (goBtn) goBtn.disabled = false;
      return;
    }

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
    const base = WORKER_BASE_URL;

    if (statusEl) statusEl.textContent = "Requesting assume-identity token…";
    let res = await fetch(`${base}/api/admin/assume-identity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ targetEmail: email, reason }),
    });

    if (!res.ok && isDevAccount(user.email) && isLocalWorkerUrl()) {
      if (statusEl) statusEl.textContent = "Trying dev impersonate fallback…";
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      };
      let secret = "";
      try {
        secret = sessionStorage.getItem("se-impersonate-secret") || "";
      } catch {
        /* ok */
      }
      if (secret) headers["X-Impersonate-Secret"] = secret;
      res = await fetch(`${base}/api/admin/impersonate-token`, {
        method: "POST",
        headers,
        body: JSON.stringify({ targetEmail: email }),
      });
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Request failed" }));
      if (statusEl) statusEl.textContent = `Failed: ${err.error || res.statusText}`;
      if (goBtn) goBtn.disabled = false;
      return;
    }
    const data = await res.json();
    if (statusEl) statusEl.textContent = "Signing in with custom token…";

    await signInWithAssumeCustomToken(fbAuth, data.token);
    if (overlay) overlay.hidden = true;
    location.reload();
  } catch (err) {
    if (statusEl) statusEl.textContent = `Failed: ${err?.message || "unknown error"}`;
    if (goBtn) goBtn.disabled = false;
  }
}

export function wireAssumeIdentityExpiredListener(onExpired) {
  window.addEventListener(ASSUME_IDENTITY_EXPIRED_EVENT, () => {
    removeAssumeIdentityBanner();
    onExpired?.();
  });
}
