/**
 * Sidebar user profile menu — Slack-style flyout on the left edge.
 */

import { wireThemeMenu, syncThemeMenuState } from "./theme.js";

let globalEventsBound = false;
let menuScrollBound = false;
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

/** Close the profile flyout (exported for sign-out and scroll dismiss). */
export function closeUserMenu() {
  const panel = document.getElementById("user-menu-panel");
  const backdrop = document.getElementById("user-menu-backdrop");
  const trigger = document.getElementById("sidebar-user") || document.getElementById("user-menu-trigger");
  const themeSubmenu = document.getElementById("user-menu-theme-submenu");
  const themeToggle = document.getElementById("user-menu-theme-toggle");
  if (!panel) return;
  panel.hidden = true;
  if (backdrop) backdrop.hidden = true;
  restoreTeleportHome(panel);
  restoreTeleportHome(backdrop);
  trigger?.setAttribute("aria-expanded", "false");
  if (themeSubmenu) themeSubmenu.hidden = true;
  if (themeToggle) themeToggle.setAttribute("aria-expanded", "false");
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

    const signOutEl = document.getElementById("user-menu-signout");
    signOutEl?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      menuCallbacks.onSignOut?.();
    });

    panel.addEventListener("click", (e) => {
      const signOutBtn = e.target.closest("#user-menu-signout");
      if (signOutBtn) {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        menuCallbacks.onSignOut?.();
      }
    });
  }

  function closeMenu() {
    closeUserMenu();
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

  backdrop?.addEventListener("wheel", closeMenu, { passive: true });
  backdrop?.addEventListener("touchmove", closeMenu, { passive: true });

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
      closeUserMenu();
    });

    document.addEventListener("keydown", (e) => {
      const panelEl = document.getElementById("user-menu-panel");
      if (e.key === "Escape" && panelEl && !panelEl.hidden) closeUserMenu();
    });

    if (!menuScrollBound) {
      menuScrollBound = true;
      const scrollContainers = () => {
        if (typeof document.querySelector !== "function") return [];
        return [
          document.querySelector(".sidebar-nav"),
          document.querySelector(".sidebar-history"),
          document.querySelector(".sidebar-recent-work"),
          document.documentElement,
        ].filter(Boolean);
      };

      const onScrollDismiss = (e) => {
        const panelEl = document.getElementById("user-menu-panel");
        if (!panelEl || panelEl.hidden) return;
        if (panelEl.contains(e.target)) return;
        closeUserMenu();
      };
      document.addEventListener("scroll", onScrollDismiss, { capture: true, passive: true });
      window.addEventListener("scroll", onScrollDismiss, { capture: true, passive: true });
      document.addEventListener("wheel", onScrollDismiss, { capture: true, passive: true });
      document.addEventListener("touchmove", onScrollDismiss, { capture: true, passive: true });
      for (const el of scrollContainers()) {
        el.addEventListener("scroll", onScrollDismiss, { passive: true });
      }
    }
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
  const headerAvatar = document.getElementById("user-menu-header-avatar");
  if (sidebarAvatar) sidebarAvatar.textContent = initials;
  if (headerAvatar) headerAvatar.textContent = initials;
  if (sidebarName) sidebarName.textContent = name || email.split("@")[0] || "User";
  if (sidebarRole) {
    const title = session?.jobTitle || "Solution Engineer";
    const region = session?.region || session?.subRegion || "";
    sidebarRole.textContent = region ? `${title} · ${region}` : title;
  }
}
