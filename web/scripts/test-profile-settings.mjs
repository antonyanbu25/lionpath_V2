/** Smoke tests for profile service and session manager fields. */

import { initDomainStore, getStore } from "../domain/store.js";
import {
  roleLabel,
  updateDisplayName,
  updateProfilePicture,
  validateAvatarDataUrl,
  loadManagerForUser,
} from "../domain/profile-service.js";
import { seedDevDomainIfNeeded, enrichSessionFromStore } from "../domain/seed-dev.js";
import { stableUserIdForEmail } from "../domain/id.js";

const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => ls.get(k) ?? null,
  setItem: (k, v) => ls.set(k, v),
  removeItem: (k) => ls.delete(k),
  key: (i) => [...ls.keys()][i] ?? null,
  get length() {
    return ls.size;
  },
};

initDomainStore(null);
await seedDevDomainIfNeeded();

const seId = stableUserIdForEmail("saketh.poruri@freshworks.com");
const store = getStore();
const seUser = await store.getUser(seId);

const session = await enrichSessionFromStore({
  email: "saketh.poruri@freshworks.com",
  userId: seId,
  role: "se",
});

const mgr = await loadManagerForUser(seUser);

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

let threw = false;
try {
  await updateDisplayName(seId, "   ");
} catch (err) {
  threw = err.message.includes("empty");
}

let invalidAvatarThrew = false;
try {
  validateAvatarDataUrl("data:text/plain;base64,YWJj");
} catch (err) {
  invalidAvatarThrew = err.message.includes("Invalid");
}

const updated = await updateDisplayName(seId, "SE Alpha Updated");
const reloaded = await store.getUser(seId);

const withAvatar = await updateProfilePicture(seId, tinyPng);
const avatarReloaded = await store.getUser(seId);
const sessionWithAvatar = await enrichSessionFromStore({
  email: "saketh.poruri@freshworks.com",
  userId: seId,
  role: "se",
});

const removed = await updateProfilePicture(seId, null);
const afterRemove = await store.getUser(seId);

const checks = [
  ["role label se", roleLabel("se") === "Solution Engineer"],
  ["role label manager", roleLabel("manager") === "Manager"],
  ["session has managerId", !!session.managerId],
  ["session has managerName", !!session.managerName],
  ["session has jobTitle", session.jobTitle === "Solution Engineer"],
  ["loadManagerForUser", !!mgr?.displayName],
  ["reject empty name", threw],
  ["update display name", updated.displayName === "SE Alpha Updated"],
  ["persisted name", reloaded.displayName === "SE Alpha Updated"],
  ["reject invalid avatar", invalidAvatarThrew],
  ["update profile picture", withAvatar.avatarDataUrl === tinyPng],
  ["persist avatar", avatarReloaded.avatarDataUrl === tinyPng],
  ["session avatar field", sessionWithAvatar.avatarDataUrl === tinyPng],
  ["remove profile picture", removed.avatarDataUrl == null],
  ["persist avatar removal", afterRemove.avatarDataUrl == null],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    console.error("FAIL:", name);
    failed++;
  } else {
    console.log("ok:", name);
  }
}

if (failed) process.exit(1);
console.log(`\n${checks.length} profile settings checks passed.`);
