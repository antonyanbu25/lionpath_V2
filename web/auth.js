/**
 * Authentication — dummy credentials now; Firebase SSO can replace this module later.
 * Session is stored in sessionStorage for the tab, with a localStorage backup so reopening
 * the browser restores login and post-call history can load immediately.
 */

import { firebaseConfig } from "./firebase-config.js";
import { DUMMY_USERS } from "./dummy-users.js";
import { DEMO_TEAM_ID } from "./domain/constants.js";
import { stableUserIdForEmail } from "./domain/id.js";
import { enrichSessionFromStore, listTeamMemberEmails, upsertFirebaseUser } from "./domain/seed-dev.js";
import { listVisibleSeEmails } from "./domain/org-service.js";

export { DUMMY_USERS };

const SESSION_KEY = "se-sp-session";
const SESSION_LOCAL_KEY = "se-sp-session-local";

/** Domain user id from session (internal usr_*. not Firebase auth uid). */
export {
  sessionUserId,
  effectiveSessionUserId,
  withEffectiveUserId,
} from "./domain/session.js";

export function authMode() {
  return firebaseConfig.projectId ? "firebase" : "dummy";
}

/** Canonical auth flag. import from auth.js so stale firebase-config.js cannot break app boot. */
export function isFirebaseAuthEnabled() {
  return !!firebaseConfig.projectId;
}

export function isDummyAuth() {
  return authMode() === "dummy";
}

function normalizeSession(session) {
  if (!session?.email || !session?.role) return null;
  return {
    ...session,
    email: String(session.email).trim().toLowerCase(),
    name: session.name || session.email.split("@")[0],
  };
}

function readStoredSession(storage) {
  try {
    const raw = storage.getItem(SESSION_KEY) ?? storage.getItem(SESSION_LOCAL_KEY);
    if (!raw) return null;
    return normalizeSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** @returns {{ role: string, email: string, name: string, uid?: string } | null} */
export function getSession() {
  let session = readStoredSession(sessionStorage);
  if (session) return session;

  session = readStoredSession(localStorage);
  if (!session) return null;

  // Browser was closed — sessionStorage cleared; restore tab session from localStorage.
  try {
    const json = JSON.stringify(session);
    sessionStorage.setItem(SESSION_KEY, json);
  } catch (err) {
    console.warn("Could not restore sessionStorage session:", err);
  }
  return session;
}

export function setSession(session, opts = {}) {
  const normalized = normalizeSession(session);
  if (!normalized) return;
  const json = JSON.stringify(normalized);
  try {
    sessionStorage.setItem(SESSION_KEY, json);
    localStorage.setItem(SESSION_LOCAL_KEY, json);
  } catch (err) {
    console.warn("Could not persist auth session:", err);
  }
  if (opts.notify === false) return;
  listeners.forEach((fn) => fn(normalized, opts));
}

const listeners = new Set();

/** @param {(session: object | null, opts?: object) => void} fn */
export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * @param {string} email
 * @param {string} password
 * @returns {{ ok: true, session: object } | { ok: false, error: string }}
 */
export function loginDummy(email, password, opts = {}) {
  const key = String(email || "").trim().toLowerCase();
  const user = DUMMY_USERS[key];
  if (!user) return { ok: false, error: "Unknown account. Use a @freshworks.com SE or manager login." };
  if (user.password !== password) return { ok: false, error: "Incorrect password." };
  const userId = stableUserIdForEmail(key);
  const session = {
    userId,
    uid: userId,
    authUid: null,
    role: user.role,
    email: key,
    name: user.name,
    teamId: user.teamId || DEMO_TEAM_ID,
  };
  if (opts.persist !== false) setSession(session);
  return { ok: true, session };
}

/** Clears auth session only. post-call history stays in localStorage per email. */
export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  try {
    localStorage.removeItem(SESSION_LOCAL_KEY);
  } catch {
    // ignore private-mode / quota errors
  }
  listeners.forEach((fn) => fn(null));
}

/** Firebase user object → session shape (for SSO). */
export function sessionFromFirebaseUser(user) {
  if (!user?.email) return null;
  const role = user.email.startsWith("manager@") ? "manager" : "se";
  return {
    role,
    email: String(user.email).trim().toLowerCase(),
    name: user.displayName || user.email.split("@")[0],
    authUid: user.uid,
    teamId: DEMO_TEAM_ID,
  };
}

export async function persistFirebaseSession(user, opts = {}) {
  const base = sessionFromFirebaseUser(user);
  if (!base) return null;
  let session = base;
  try {
    const profile = await upsertFirebaseUser(user, base.role);
    session = {
      ...base,
      userId: profile.id,
      uid: profile.id,
      role: profile.role,
      teamId: profile.teamId,
      name: profile.displayName,
    };
  } catch (err) {
    console.warn("Could not sync Firebase user to domain store:", err);
    const fallbackId = stableUserIdForEmail(base.email);
    session = {
      ...base,
      userId: fallbackId,
      uid: fallbackId,
    };
  }
  if (opts.persist !== false) {
    setSession(session, opts);
  }
  return session;
}

/** Enrich session with role/teamId from domain store (dummy or Firestore). */
export async function syncSessionWithDomainStore(session) {
  if (!session) return null;
  try {
    const enriched = await enrichSessionFromStore(session);
    setSession(enriched, { notify: false });
    return enriched;
  } catch (err) {
    console.warn("Could not enrich session from domain store:", err);
    return session;
  }
}

/** @param {{ role?: string, email?: string } | null | undefined} session */
export function isManagerRole(session) {
  if (!session) return false;
  if (session.role === "manager") return true;
  return String(session.email || "").toLowerCase().startsWith("manager@");
}

/** @param {{ role?: string, email?: string } | null | undefined} session */
export function isSeRole(session) {
  return !!session && !isManagerRole(session);
}

/** Sync fallback: dummy accounts + localStorage history scan. */
export function listTeamSeEmails() {
  const fromAccounts = Object.entries(DUMMY_USERS)
    .filter(([, u]) => u.role === "se")
    .map(([email]) => email);

  const seen = new Set(fromAccounts);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("se-singha-history:")) continue;
      const email = key.slice("se-singha-history:".length).toLowerCase();
      if (email && !email.startsWith("manager@") && !seen.has(email)) {
        seen.add(email);
        fromAccounts.push(email);
      }
    }
  } catch {
    // ignore private-mode errors
  }
  return fromAccounts;
}

/** Preferred: team member emails from domain store (Firestore or local shim). */
export async function listTeamSeEmailsAsync(session) {
  if (session?.isOrgDirector) {
    try {
      const emails = await listVisibleSeEmails(session);
      if (emails.length) return emails;
    } catch (err) {
      console.warn("Could not load org-visible SEs from domain store:", err);
    }
  }

  const teamId = session?.teamId || DEMO_TEAM_ID;
  try {
    const emails = await listTeamMemberEmails(teamId);
    if (emails.length) return emails;
  } catch (err) {
    console.warn("Could not load team members from domain store:", err);
  }
  return listTeamSeEmails();
}

/** @param {string} email */
export function displayNameForEmail(email) {
  const key = String(email || "").trim().toLowerCase();
  return DUMMY_USERS[key]?.name || key.split("@")[0] || "SE";
}
