/**
 * Top-right user profile dropdown — Freshdesk-style menu.
 */

import { wireThemeMenu, syncThemeMenuState } from "./theme.js";

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

/**
 * @param {{ getSession: () => object|null, onProfileSettings: () => void, onSignOut: () => void }} opts
 */
export function initUserMenu(opts) {
  const trigger = document.getElementById("user-menu-trigger");
  const panel = document.getElementById("user-menu-panel");
  const themeToggle = document.getElementById("user-menu-theme-toggle");
  const themeSubmenu = document.getElementById("user-menu-theme-submenu");
  if (!trigger || !panel) return;

  wireThemeMenu(panel);

  function closeMenu() {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (themeSubmenu) themeSubmenu.hidden = true;
    if (themeToggle) themeToggle.setAttribute("aria-expanded", "false");
  }

  function openMenu() {
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    syncThemeMenuState(panel);
  }

  function toggleMenu() {
    if (panel.hidden) openMenu();
    else closeMenu();
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  document.getElementById("sidebar-user")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  document.getElementById("user-menu-profile")?.addEventListener("click", () => {
    closeMenu();
    opts.onProfileSettings?.();
  });

  document.getElementById("user-menu-signout")?.addEventListener("click", () => {
    closeMenu();
    opts.onSignOut?.();
  });

  themeToggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    const expanded = themeToggle.getAttribute("aria-expanded") === "true";
    themeToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
    if (themeSubmenu) themeSubmenu.hidden = expanded;
  });

  document.addEventListener("click", (e) => {
    if (panel.hidden) return;
    const menu = document.getElementById("user-menu");
    if (menu && !menu.contains(e.target)) closeMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) closeMenu();
  });

  refreshUserMenu(opts.getSession?.());
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
  if (sidebarRole) sidebarRole.textContent = "Solution Engineering";
}
