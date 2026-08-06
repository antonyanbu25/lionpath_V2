/**
 * Production-safe user/session resolution — no dev seeding or DUMMY_USERS.
 */

import { firebaseConfig } from "../firebase-config.js";
import { getStore } from "./store.js";
import { now } from "./types.js";
import { stableUserIdForEmail } from "./id.js";

/**
 * Lookup user by session authUid / email / userId.
 * @param {object} session
 * @param {object} store
 */
export async function lookupUserForSession(session, store) {
  if (!session) return null;
  if (session.authUid && store.getUserByAuthUid) {
    const byAuth = await store.getUserByAuthUid(session.authUid);
    if (byAuth) return byAuth;
  }
  const lookupId = session.userId || session.uid;
  if (lookupId && !lookupId.startsWith("usr_dummy_")) {
    const byId = await store.getUser(lookupId);
    if (byId) return byId;
  }
  if (session.email && store.getUserByEmail) {
    return store.getUserByEmail(session.email);
  }
  return null;
}

/**
 * Domain owner id for Firestore reads/writes — authIndex wins over placeholders.
 * @param {object | null | undefined} session
 * @param {object} [storeOverride]
 * @returns {Promise<string | null>}
 */
export async function resolveEffectiveOwnerId(session, storeOverride) {
  if (!session) return null;
  const raw = session.userId || session.uid;
  const isDummy = raw?.startsWith("usr_dummy_");
  const isAuthUidAsProfile = session.authUid && raw === session.authUid;
  if (raw && !isDummy && !isAuthUidAsProfile) return raw;

  if (session.authUid || session.email) {
    const store = storeOverride || getStore();
    const user = await lookupUserForSession(session, store);
    if (user?.id) return user.id;
  }

  return raw || (session.email ? stableUserIdForEmail(session.email) : null);
}

/** Load user profile from store and merge into session (production path). */
export async function enrichSessionFromStore(session) {
  const lookupId = session?.userId || session?.uid;
  if (!lookupId && !session?.email && !session?.authUid) return session;

  const store = getStore();
  const user = await lookupUserForSession(session, store);
  if (!user) return session;

  return {
    ...session,
    userId: user.id,
    uid: user.id,
    authUid: user.authUid ?? session.authUid ?? null,
    role: user.role,
    teamId: user.teamId,
    orgId: user.orgId || null,
    name: user.displayName || session.name,
    email: user.email || session.email,
  };
}

/** @param {string} email */
export function stableIdForEmail(email) {
  return stableUserIdForEmail(email);
}

export { now };

/** Firestore rules deny reads when session.userId != authIndex userId; swallow and continue. */
async function safeStoreGet(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[user-resolve] ${label} failed:`, err?.message || err);
    return null;
  }
}

/** Resolve team member emails for manager views (single team). */
export async function listTeamMemberEmails(teamId) {
  const store = getStore();
  const team = await store.getTeam(teamId);
  if (!team?.memberIds?.length) return [];

  const emails = [];
  for (const memberId of team.memberIds) {
    const user = await store.getUser(memberId);
    if (user?.email && user.role === "se") emails.push(user.email);
  }
  return emails;
}

/** Upsert Firebase user on login. internal User.id + authIndex (no dev seed). */
export async function upsertFirebaseUser(fbUser, roleHint) {
  const store = getStore();
  const ts = now();
  const email = String(fbUser.email || "").trim().toLowerCase();
  const authUid = fbUser.uid;

  let user = null;

  if (store.getUserIdByAuthUid) {
    const mappedId = await safeStoreGet("authIndex lookup", () => store.getUserIdByAuthUid(authUid));
    if (mappedId) {
      user = await safeStoreGet("getUser by authIndex", () => store.getUser(mappedId));
    }
  }

  if (!user) {
    user = await safeStoreGet("getUserByEmail", () => store.getUserByEmail(email));
  }

  if (!user) {
    const legacyByAuth = await safeStoreGet("legacy getUser by authUid", () => store.getUser(authUid));
    if (legacyByAuth?.email === email) user = legacyByAuth;
  }

  const role =
    user?.role ||
    (email.includes("vipin.") || email.startsWith("director@") ? "manager" : roleHint || "se");

  const profile = {
    id: user?.id || stableUserIdForEmail(email),
    email,
    authUid,
    displayName: fbUser.displayName || user?.displayName || email.split("@")[0],
    role,
    teamId: user?.teamId ?? null,
    orgId: user?.orgId ?? null,
    managerId: user?.managerId ?? null,
    jobTitle: user?.jobTitle ?? null,
    avatarDataUrl: user?.avatarDataUrl ?? null,
    status: user?.status ?? "active",
    createdAt: user?.createdAt ?? ts,
    updatedAt: ts,
  };

  await store.upsertUser(profile);
  if (store.upsertAuthIndex) {
    await store.upsertAuthIndex(authUid, profile.id, email);
  }

  return profile;
}
