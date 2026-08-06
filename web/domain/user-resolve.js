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
