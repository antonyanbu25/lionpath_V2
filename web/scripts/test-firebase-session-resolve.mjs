#!/usr/bin/env node
/** Firebase session resolve — authIndex must win over usr_dummy_* placeholder ids. */

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webUrl = (rel) => pathToFileURL(path.join(root, rel)).href;

const REAL_USER_ID = "usr_0a0c5e73-2618-4c90-bb1c-57a687d17a6d";
const AUTH_UID = "0l2Md0OUadhYLhEguy7jR6h8dkZ2";
const EMAIL = "sathish.kuttan@freshworks.com";
const DUMMY_ID = "usr_dummy_sathish_kuttan_freshworks_com";

function permissionDenied() {
  const err = new Error("Missing or insufficient permissions.");
  err.code = "permission-denied";
  return err;
}

const mockStore = {
  async getUser(id) {
    if (id === REAL_USER_ID) {
      return {
        id: REAL_USER_ID,
        email: EMAIL,
        authUid: AUTH_UID,
        displayName: "Sathish kuttan",
        role: "se",
        teamId: "team_nikil",
        orgId: "org_freshworks_se",
        status: "active",
      };
    }
    if (id.startsWith("usr_dummy_")) throw permissionDenied();
    return null;
  },
  async getUserIdByAuthUid(authUid) {
    return authUid === AUTH_UID ? REAL_USER_ID : null;
  },
  async getUserByEmail() {
    throw permissionDenied();
  },
};

const { lookupUserForSession, resolveEffectiveOwnerId } = await import(webUrl("domain/user-resolve.js"));

const resolved = await lookupUserForSession(
  { userId: DUMMY_ID, uid: DUMMY_ID, authUid: AUTH_UID, email: EMAIL },
  mockStore,
);
assert.equal(resolved?.id, REAL_USER_ID, "authIndex resolves real user despite dummy session id");
assert.equal(resolved?.teamId, "team_nikil");

const ownerId = await resolveEffectiveOwnerId(
  { userId: DUMMY_ID, uid: DUMMY_ID, authUid: AUTH_UID, email: EMAIL },
  mockStore,
);
assert.equal(ownerId, REAL_USER_ID, "resolveEffectiveOwnerId prefers authIndex over usr_dummy_*");

console.log("Firebase session resolve tests passed.");
