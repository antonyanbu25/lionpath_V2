#!/usr/bin/env node
/**
 * Regression for the 2026-09-08 identity-corruption incident: authIndex
 * already mapped a real user, but the profile it points to did not load
 * (transient error / Firestore-rules denial mid-login race / genuinely
 * missing doc all look identical here). Falling through to getUserByEmail
 * and then a fresh stableUserIdForEmail id used to mint a second
 * "usr_dummy_*" profile and silently rebind authIndex to it, permanently
 * orphaning the real one. upsertFirebaseUser must instead keep the existing
 * mapping and make zero Firestore writes.
 */

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webUrl = (rel) => pathToFileURL(path.join(root, rel)).href;

const storeData = new Map();
globalThis.localStorage = {
  getItem: (k) => storeData.get(k) ?? null,
  setItem: (k, v) => storeData.set(k, v),
  removeItem: (k) => storeData.delete(k),
};

const { initDomainStore, getStore } = await import(webUrl("domain/store.js"));
const { upsertFirebaseUser } = await import(webUrl("domain/user-resolve.js"));

initDomainStore(null);
const store = getStore();

const REAL_USER_ID = "usr_9a89aa39-ea98-4a96-89de-59902b2d1d3d";
const AUTH_UID = "3RVeJDv6ShgY0SRZ8nlrwO8Y1mt1";
const EMAIL = "nivedha.natarajan@freshworks.com";

// authIndex already points at a real profile, but that profile doc was
// never seeded here -- simulating the read failing on a fresh login.
await store.upsertAuthIndex(AUTH_UID, REAL_USER_ID, EMAIL);

const profile = await upsertFirebaseUser({ uid: AUTH_UID, email: EMAIL, displayName: "Nivedha Natarajan" });

assert.equal(profile.id, REAL_USER_ID, "keeps the existing authIndex mapping instead of minting a dummy id");
assert.equal(
  await store.getUserIdByAuthUid(AUTH_UID),
  REAL_USER_ID,
  "authIndex mapping must not be rebound when the existing profile could not be read",
);
assert.equal(
  await store.getUser(REAL_USER_ID),
  null,
  "must not write a fresh profile over the id authIndex already points to",
);
assert.equal(
  await store.getUserByEmail(EMAIL),
  null,
  "must not create a second usr_dummy_* profile for this email",
);

console.log("Firebase user upsert guard test passed.");
