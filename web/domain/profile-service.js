/**
 * Profile updates — display name and manager lookup.
 */

import { getStore } from "./store.js";
import { now } from "./types.js";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Validate a data URL for profile avatar storage.
 * @param {string|null|undefined} dataUrl
 * @returns {string|null}
 */
export function validateAvatarDataUrl(dataUrl) {
  if (dataUrl == null || dataUrl === "") return null;

  const str = String(dataUrl);
  const match = str.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error("Invalid image format. Use JPEG, PNG, GIF, or WebP.");

  const mime = match[1].toLowerCase();
  if (!ALLOWED_AVATAR_MIME.has(mime)) throw new Error("Unsupported image type.");

  const b64 = match[2];
  const padding = (b64.match(/=+$/) || [""])[0].length;
  const bytes = Math.floor((b64.length * 3) / 4) - padding;
  if (bytes > MAX_AVATAR_BYTES) throw new Error("Image must be 2 MB or smaller.");

  return str;
}

/** Human-readable role label for profile UI. */
export function roleLabel(role) {
  switch (role) {
    case "manager":
      return "Manager";
    case "admin":
      return "Admin";
    case "se":
    default:
      return "Solution Engineer";
  }
}

/** @param {import("./types.js").User|null|undefined} user */
export async function loadManagerForUser(user) {
  if (!user?.managerId) return null;
  const store = getStore();
  const mgr = await store.getUser(user.managerId);
  if (!mgr) return null;
  return {
    id: mgr.id,
    displayName: mgr.displayName || mgr.email?.split("@")[0] || "Manager",
    email: mgr.email,
  };
}

/**
 * Update the signed-in user's display name.
 * @param {string} userId
 * @param {string} displayName
 */
export async function updateDisplayName(userId, displayName) {
  const trimmed = String(displayName || "").trim();
  if (!userId) throw new Error("Not signed in.");
  if (!trimmed) throw new Error("Display name cannot be empty.");

  const store = getStore();
  const user = await store.getUser(userId);
  if (!user) throw new Error("User profile not found.");

  const updated = {
    ...user,
    displayName: trimmed,
    updatedAt: now(),
  };
  await store.upsertUser(updated);
  return updated;
}

/**
 * Update or remove the signed-in user's profile photo.
 * @param {string} userId
 * @param {string|null|undefined} avatarDataUrl data URL, or null/empty to remove
 */
export async function updateProfilePicture(userId, avatarDataUrl) {
  if (!userId) throw new Error("Not signed in.");

  const validated = validateAvatarDataUrl(avatarDataUrl);

  const store = getStore();
  const user = await store.getUser(userId);
  if (!user) throw new Error("User profile not found.");

  const updated = {
    ...user,
    avatarDataUrl: validated,
    updatedAt: now(),
  };
  await store.upsertUser(updated);
  return updated;
}
