/**
 * Profile settings view — editable display name, profile photo, read-only role and manager.
 */

import {
  updateDisplayName,
  updateProfilePicture,
  roleLabel,
  MAX_AVATAR_BYTES,
} from "./domain/profile-service.js";
import { setSession } from "./auth.js";
import { refreshUserMenu } from "./user-menu.js";
import { readFieldValue } from "./crayons-ui.js";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

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

function renderAvatarPreview(el, session) {
  if (!el) return;
  const url = session?.avatarDataUrl;
  if (url) {
    el.classList.add("has-image");
    el.innerHTML = `<img src="${esc(url)}" alt="" class="profile-avatar-img" />`;
    return;
  }
  el.classList.remove("has-image");
  el.textContent = initialsFromName(session?.name, session?.email);
}

/**
 * @param {HTMLElement} container
 * @param {object} session
 * @param {{ onSaved?: (session: object) => void }} [opts]
 */
export function renderProfileSettings(container, session, opts = {}) {
  if (!container || !session) return;

  let currentSession = { ...session };
  const managerDisplay = currentSession.managerName || "—";
  const role = roleLabel(currentSession.role);
  const hasAvatar = !!currentSession.avatarDataUrl;

  container.innerHTML = `
    <div class="profile-settings-page">
      <div class="profile-settings-head">
        <h1 class="profile-settings-title">Profile settings</h1>
        <p class="muted">Update how your name and photo appear across the portal.</p>
      </div>
      <fw-card class="profile-settings-card">
        <form id="profile-settings-form" class="profile-settings-form" action="javascript:void(0)" novalidate>
          <div class="profile-avatar-section">
            <span class="profile-field-label">Profile photo</span>
            <div class="profile-avatar-row">
              <div id="profile-avatar-preview" class="profile-avatar-preview" aria-hidden="true"></div>
              <div class="profile-avatar-actions">
                <input
                  id="profile-avatar-input"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  hidden
                />
                <fw-button id="profile-avatar-upload-btn" type="button">Upload photo</fw-button>
                <fw-button
                  id="profile-avatar-remove-btn"
                  type="button"
                  color="secondary"
                  ${hasAvatar ? "" : "hidden"}
                >Remove photo</fw-button>
                <span class="profile-field-hint muted">JPEG, PNG, GIF, or WebP. Max 2 MB.</span>
              </div>
            </div>
          </div>
          <fw-input
            id="profile-display-name"
            label="Display name"
            type="text"
            value="${esc(currentSession.name || "")}"
            required
            clear-input
          ></fw-input>
          <div class="profile-readonly-field">
            <span class="profile-field-label">Email</span>
            <span class="profile-field-value">${esc(currentSession.email || "")}</span>
          </div>
          <div class="profile-readonly-field">
            <span class="profile-field-label">Role</span>
            <span class="profile-field-value profile-field-badge">${esc(role)}</span>
            <span class="profile-field-hint muted">Assigned by your administrator — not editable here.</span>
          </div>
          ${currentSession.jobTitle ? `
          <div class="profile-readonly-field">
            <span class="profile-field-label">Job title</span>
            <span class="profile-field-value">${esc(currentSession.jobTitle)}</span>
          </div>` : ""}
          <div class="profile-readonly-field">
            <span class="profile-field-label">Reporting manager</span>
            <span class="profile-field-value">${esc(managerDisplay)}</span>
          </div>
          <div class="profile-settings-actions">
            <fw-button id="profile-save-btn" type="button" color="primary">Save changes</fw-button>
          </div>
          <fw-inline-message id="profile-save-msg" type="success" closable="false" hidden></fw-inline-message>
          <fw-inline-message id="profile-save-err" type="error" closable="false" hidden></fw-inline-message>
        </form>
      </fw-card>
    </div>`;

  const form = container.querySelector("#profile-settings-form");
  const nameInput = container.querySelector("#profile-display-name");
  const saveBtn = container.querySelector("#profile-save-btn");
  const msgOk = container.querySelector("#profile-save-msg");
  const msgErr = container.querySelector("#profile-save-err");
  const avatarPreview = container.querySelector("#profile-avatar-preview");
  const avatarInput = container.querySelector("#profile-avatar-input");
  const avatarUploadBtn = container.querySelector("#profile-avatar-upload-btn");
  const avatarRemoveBtn = container.querySelector("#profile-avatar-remove-btn");

  renderAvatarPreview(avatarPreview, currentSession);

  function showOk(text) {
    msgOk.textContent = text;
    msgOk.hidden = false;
    msgErr.hidden = true;
  }

  function showErr(text) {
    msgErr.textContent = text;
    msgErr.hidden = false;
    msgOk.hidden = true;
  }

  function applySession(nextSession) {
    currentSession = nextSession;
    setSession(nextSession);
    refreshUserMenu(nextSession);
    renderAvatarPreview(avatarPreview, nextSession);
    if (avatarRemoveBtn) avatarRemoveBtn.hidden = !nextSession.avatarDataUrl;
    opts.onSaved?.(nextSession);
  }

  async function saveName() {
    const displayName = readFieldValue(nameInput).trim();
    msgOk.hidden = true;
    msgErr.hidden = true;

    try {
      const updated = await updateDisplayName(currentSession.userId || currentSession.uid, displayName);
      applySession({ ...currentSession, name: updated.displayName });
      showOk("Profile updated.");
    } catch (err) {
      showErr(err?.message || "Could not save profile.");
    }
  }

  async function saveAvatar(dataUrl) {
    msgOk.hidden = true;
    msgErr.hidden = true;

    try {
      const updated = await updateProfilePicture(
        currentSession.userId || currentSession.uid,
        dataUrl
      );
      applySession({ ...currentSession, avatarDataUrl: updated.avatarDataUrl || null });
      showOk(dataUrl ? "Profile photo updated." : "Profile photo removed.");
    } catch (err) {
      showErr(err?.message || "Could not update profile photo.");
    }
  }

  avatarUploadBtn?.addEventListener("fwClick", (e) => {
    e?.preventDefault?.();
    avatarInput?.click();
  });

  avatarInput?.addEventListener("change", () => {
    const file = avatarInput.files?.[0];
    avatarInput.value = "";
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      showErr("Use a JPEG, PNG, GIF, or WebP image.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      showErr("Image must be 2 MB or smaller.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") void saveAvatar(reader.result);
    };
    reader.onerror = () => showErr("Could not read the selected image.");
    reader.readAsDataURL(file);
  });

  avatarRemoveBtn?.addEventListener("fwClick", (e) => {
    e?.preventDefault?.();
    void saveAvatar(null);
  });

  saveBtn?.addEventListener("fwClick", (e) => {
    e?.preventDefault?.();
    void saveName();
  });
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    void saveName();
  });
}
