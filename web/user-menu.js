/**
 * Sidebar user profile menu — Slack-style flyout on the left edge.
 */

import { wireThemeMenu, syncThemeMenuState } from "./theme.js";

let globalEventsBound = false;
let menuCallbacks = {
  onProfileSettings: null,
  onSignOut: null,
  getSession: null,
};

function initialsFromName(name, email) {
  const n = String(name || "").trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return n.slice(0, 2).toUpperCase();
  }
  const local = String(email || "").split("@")[0];
  return local ? local.slice(0, 2).toUpperCase() : "U";
}

function sidebarWidthPx() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return 240;
  return sidebar.getBoundingClientRect().width || 240;
}

function positionFlyout(panel) {
  if (!panel) return;
  panel.style.left = `${Math.round(sidebarWidthPx())}px`;
  panel.style.bottom = "18px";
  panel.style.top = "auto";
  panel.style.right = "auto";
}

function rememberTeleportHome(el) {
  if (!el || el.dataset.teleportHome) return;
  el.dataset.teleportHome = "1";
  el._teleportParent = el.parentNode;
  el._teleportNext = el.nextSibling;
}

function teleportToBody(el) {
  if (!el) return;
  rememberTeleportHome(el);
  document.body.appendChild(el);
}

function restoreTeleportHome(el) {
  if (!el?._teleportParent) return;
  if (el._teleportNext) el._teleportParent.insertBefore(el, el._teleportNext);
  else el._teleportParent.appendChild(el);
}

/**
 * @param {{ getSession: () => object|null, onProfileSettings: () => void, onSignOut: () => void }} opts
 */
export function initUserMenu(opts) {
  menuCallbacks = {
    getSession: opts.getSession || null,
    onProfileSettings: opts.onProfileSettings || null,
    onSignOut: opts.onSignOut || null,
  };

  const trigger = document.getElementById("sidebar-user") || document.getElementById("user-menu-trigger");
  const panel = document.getElementById("user-menu-panel");
  const backdrop = document.getElementById("user-menu-backdrop");
  const themeToggle = document.getElementById("user-menu-theme-toggle");
  const themeSubmenu = document.getElementById("user-menu-theme-submenu");
  if (!trigger || !panel) return;

  wireThemeMenu(panel);

  if (panel.dataset.userMenuWired !== "1") {
    panel.dataset.userMenuWired = "1";

    panel.addEventListener("click", (e) => {
      const signOutBtn = e.target.closest("#user-menu-signout");
      if (signOutBtn) {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        menuCallbacks.onSignOut?.();
        return;
      }
      const profileBtn = e.target.closest("#user-menu-profile");
      if (profileBtn) {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        menuCallbacks.onProfileSettings?.();
      }
    });
  }

  function closeMenu() {
    panel.hidden = true;
    if (backdrop) backdrop.hidden = true;
    restoreTeleportHome(panel);
    restoreTeleportHome(backdrop);
    trigger.setAttribute("aria-expanded", "false");
    if (themeSubmenu) themeSubmenu.hidden = true;
    if (themeToggle) themeToggle.setAttribute("aria-expanded", "false");
  }

  function openMenu() {
    teleportToBody(backdrop);
    teleportToBody(panel);
    positionFlyout(panel);
    panel.hidden = false;
    if (backdrop) backdrop.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    syncThemeMenuState(panel);
  }

  function toggleMenu() {
    if (panel.hidden) openMenu();
    else closeMenu();
  }

  backdrop?.addEventListener("click", closeMenu);

  if (trigger.dataset.userMenuTriggerWired !== "1") {
    trigger.dataset.userMenuTriggerWired = "1";
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu();
    });
  }

  themeToggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    const expanded = themeToggle.getAttribute("aria-expanded") === "true";
    themeToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
    if (themeSubmenu) themeSubmenu.hidden = expanded;
  });

  if (!globalEventsBound) {
    globalEventsBound = true;
    window.addEventListener("resize", () => {
      if (!panel.hidden) positionFlyout(panel);
    });

    document.addEventListener("click", (e) => {
      const panelEl = document.getElementById("user-menu-panel");
      if (!panelEl || panelEl.hidden) return;
      const triggerEl = document.getElementById("sidebar-user");
      const backdropEl = document.getElementById("user-menu-backdrop");
      if (panelEl.contains(e.target)) return;
      if (triggerEl?.contains(e.target)) return;
      if (backdropEl?.contains(e.target)) return;
      panelEl.hidden = true;
      if (backdropEl) backdropEl.hidden = true;
      restoreTeleportHome(panelEl);
      restoreTeleportHome(backdropEl);
      triggerEl?.setAttribute("aria-expanded", "false");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !panel.hidden) closeMenu();
    });
  }

  refreshUserMenu(menuCallbacks.getSession?.());
}

/** @param {object|null|undefined} session */
export function refreshUserMenu(session) {
  const avatar = document.getElementById("user-menu-avatar");
  const nameEl = document.getElementById("user-menu-name");
  const emailEl = document.getElementById("user-menu-email");
  const name = session?.name || "";
  const email = session?.email || "";
  const initials = initialsFromName(name, email);
  if (avatar) {
    const url = session?.avatarDataUrl;
    if (url) {
      avatar.classList.add("has-image");
      avatar.innerHTML = `<img src="${String(url).replace(/"/g, "&quot;")}" alt="" class="user-menu-avatar-img" />`;
    } else {
      avatar.classList.remove("has-image");
      avatar.textContent = initials;
    }
  }
  if (nameEl) nameEl.textContent = name || email.split("@")[0] || "User";
  if (emailEl) emailEl.textContent = email;

  const sidebarAvatar = document.getElementById("sidebar-user-avatar");
  const sidebarName = document.getElementById("sidebar-user-name");
  const sidebarRole = document.getElementById("sidebar-user-role");
  if (sidebarAvatar) sidebarAvatar.textContent = initials;
  if (sidebarName) sidebarName.textContent = name || email.split("@")[0] || "User";
  if (sidebarRole) {
    const title = session?.jobTitle || "Solution Engineer";
    const region = session?.region || session?.subRegion || "";
    sidebarRole.textContent = region ? `${title} · ${region}` : title;
  }
}
