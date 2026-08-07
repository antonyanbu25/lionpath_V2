/**
 * Production-safe user/session resolution — no dev seeding or DUMMY_USERS.
 */

import { firebaseConfig } from "../firebase-config.js";
import { getStore } from "./store.js";
import { now } from "./types.js";
import { stableUserIdForEmail } from "./id.js";
import {
  getOrg,
  getSegmentForLeader,
  isOrgDirector,
  isOrgLeaderForUser,
} from "./org-service.js";

/** Infer manager role for known Freshworks leader emails on first Firebase login. */
function inferRoleFromEmail(email, roleHint) {
  const e = String(email || "").trim().toLowerCase();
  if (e.startsWith("manager@") || e.startsWith("director@") || e.includes("vipin.")) return "manager";
  const local = e.split("@")[0] || "";
  if (/^ajay\.|^antony\.|^vipin\./.test(local)) return "manager";
  return roleHint || "se";
}

/** Firestore rules deny reads when session.userId != authIndex userId; swallow and continue. */
async function safeStoreGet(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[user-resolve] ${label} failed:`, err?.message || err);
    return null;
  }
}

/**
 * Resolve domain user for a session. authIndex is checked first on Firebase login so a
 * placeholder usr_dummy_* id from persistFirebaseSession fallback does not throw.
 * @param {object} session
 * @param {object} store
 */
export async function lookupUserForSession(session, store) {
  if (!session) return null;
  const lookupId = session.userId || session.uid;
  let user = null;

  if (session.authUid && store.getUserIdByAuthUid) {
    const mappedId = await safeStoreGet("authIndex lookup", () =>
      store.getUserIdByAuthUid(session.authUid),
    );
    if (mappedId) {
      user = await safeStoreGet("getUser by authIndex", () => store.getUser(mappedId));
    }
  }

  if (!user && lookupId && !lookupId.startsWith("usr_dummy_") && lookupId !== session.authUid) {
    user = await safeStoreGet("getUser by session id", () => store.getUser(lookupId));
  }

  // authIndex can still point at usr_dummy_* while the canonical profile is a UUID doc.
  if (session.email && store.getUserByEmail) {
    const byEmail = await safeStoreGet("getUserByEmail", () => store.getUserByEmail(session.email));
    if (byEmail?.id && !String(byEmail.id).startsWith("usr_dummy_")) {
      user = byEmail;
    } else if (!user && byEmail) {
      user = byEmail;
    }
  }

  if (!user && session.email) {
    user = await safeStoreGet("getUser by stable id", () =>
      store.getUser(stableUserIdForEmail(session.email)),
    );
  }

  return user;
}

/**
 * Read authIndex directly (rules allow own doc) — bypasses store lookups that fail on usr_dummy_*.
 * @param {object | null | undefined} fb Firebase helpers (auth, db, getDoc, doc)
 * @param {object | null | undefined} session
 * @returns {Promise<string | null>}
 */
export async function resolveAuthIndexOwnerId(fb, session) {
  const raw = session?.userId || session?.uid;
  const isDummy = raw?.startsWith("usr_dummy_");
  const isAuthUidAsProfile = session?.authUid && raw === session.authUid;
  if (raw && !isDummy && !isAuthUidAsProfile) return raw;

  const authUid = session?.authUid || fb?.auth?.currentUser?.uid;
  if (authUid && fb?.db && fb?.getDoc && fb?.doc) {
    try {
      const snap = await fb.getDoc(fb.doc(fb.db, "authIndex", authUid));
      const userId = snap.exists() ? snap.data()?.userId : null;
      if (userId && !String(userId).startsWith("usr_dummy_")) return userId;
    } catch (err) {
      console.warn("[user-resolve] authIndex direct read failed:", err?.message || err);
    }
  }
  return null;
}

/**
 * Domain owner id for Firestore reads/writes — authIndex wins over placeholders.
 * @param {object | null | undefined} session
 * @param {object} [storeOverride]
 * @param {object} [fb] optional Firebase helpers for direct authIndex read
 * @returns {Promise<string | null>}
 */
export async function resolveEffectiveOwnerId(session, storeOverride, fb) {
  if (!session) return null;
  const raw = session.userId || session.uid;
  const isDummy = raw?.startsWith("usr_dummy_");
  const isAuthUidAsProfile = session.authUid && raw === session.authUid;
  if (raw && !isDummy && !isAuthUidAsProfile) return raw;

  const fromAuthIndex = await resolveAuthIndexOwnerId(fb, session);
  if (fromAuthIndex) return fromAuthIndex;

  if (session.authUid || session.email) {
    const store = storeOverride || getStore();
    const user = await lookupUserForSession(session, store);
    if (user?.id && !String(user.id).startsWith("usr_dummy_")) return user.id;
  }

  return isDummy ? fromAuthIndex : raw || (session.email ? stableUserIdForEmail(session.email) : null);
}

/** Load user profile from store and merge into session (production path). */
export async function enrichSessionFromStore(session) {
  const lookupId = session?.userId || session?.uid;
  if (!lookupId && !session?.email && !session?.authUid) return session;

  const store = getStore();
  const user = await lookupUserForSession(session, store);
  if (!user) return session;

  const org = user.orgId ? await getOrg(user.orgId) : null;
  const segment = getSegmentForLeader(user.id, org);
  const actualDirector = isOrgDirector(user.id, org);

  let managerName = null;
  if (user.managerId) {
    const mgr = await safeStoreGet("getUser manager", () => store.getUser(user.managerId));
    if (mgr) {
      managerName = mgr.displayName || mgr.email?.split("@")[0] || null;
    }
  }

  return {
    ...session,
    userId: user.id,
    uid: user.id,
    authUid: user.authUid ?? session.authUid ?? null,
    role: user.role,
    teamId: user.teamId,
    orgId: user.orgId || null,
    managerId: user.managerId || null,
    managerName,
    jobTitle: user.jobTitle || null,
    avatarDataUrl: user.avatarDataUrl || null,
    isOrgDirector: isOrgLeaderForUser(user.id, org, user.email || session.email, user.orgId),
    isActualDirector: actualDirector,
    isSegmentLeader: !!segment,
    segmentId: segment?.id || null,
    segmentName: segment?.name || null,
    segmentTeamIds: segment?.teamIds || [],
    name: user.displayName || session.name,
    email: user.email || session.email,
  };
}

/** @param {string} email */
export function stableIdForEmail(email) {
  return stableUserIdForEmail(email);
}

export { now };

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

  const role = user?.role || inferRoleFromEmail(email, roleHint);

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
