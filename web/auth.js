/**
 * Authentication — dummy credentials now; Firebase SSO can replace this module later.
 * Session is stored in sessionStorage for the tab, with a localStorage backup so reopening
 * the browser restores login and post-call history can load immediately.
 */

import { firebaseConfig } from "./firebase-config.js";

const SESSION_KEY = "se-sp-session";
const SESSION_LOCAL_KEY = "se-sp-session-local";

/** Dummy accounts for development until Firebase SSO is wired. */
export const DUMMY_USERS = {
  "se@freshworks.com": { password: "se123", role: "se", name: "Alex SE" },
  "se1@freshworks.com": { password: "se123", role: "se", name: "SE One" },
  "se2@freshworks.com": { password: "se123", role: "se", name: "SE Two" },
  "manager@freshworks.com": { password: "mgr123", role: "manager", name: "Team Manager" },
};

export function authMode() {
  return firebaseConfig.projectId ? "firebase" : "dummy";
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

function setSession(session) {
  const normalized = normalizeSession(session);
  if (!normalized) return;
  const json = JSON.stringify(normalized);
  try {
    sessionStorage.setItem(SESSION_KEY, json);
    localStorage.setItem(SESSION_LOCAL_KEY, json);
  } catch (err) {
    console.warn("Could not persist auth session:", err);
  }
  listeners.forEach((fn) => fn(normalized));
}

const listeners = new Set();

/** @param {(session: object | null) => void} fn */
export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * @param {string} email
 * @param {string} password
 * @returns {{ ok: true, session: object } | { ok: false, error: string }}
 */
export function loginDummy(email, password) {
  const key = String(email || "").trim().toLowerCase();
  const user = DUMMY_USERS[key];
  if (!user) return { ok: false, error: "Unknown account. Use a @freshworks.com SE or manager login." };
  if (user.password !== password) return { ok: false, error: "Incorrect password." };
  const session = { role: user.role, email: key, name: user.name, uid: `dummy-${key}` };
  setSession(session);
  return { ok: true, session };
}

/** Clears auth session only — post-call history stays in localStorage per email. */
export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  try {
    localStorage.removeItem(SESSION_LOCAL_KEY);
  } catch {
    // ignore private-mode / quota errors
  }
  listeners.forEach((fn) => fn(null));
}

/** Firebase user object → session shape (for future SSO). */
export function sessionFromFirebaseUser(user) {
  if (!user?.email) return null;
  const role = user.email.startsWith("manager@") ? "manager" : "se";
  return {
    role,
    email: String(user.email).trim().toLowerCase(),
    name: user.displayName || user.email.split("@")[0],
    uid: user.uid,
  };
}

export function persistFirebaseSession(user) {
  const session = sessionFromFirebaseUser(user);
  if (session) setSession(session);
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

/** All SE emails for manager team views (dummy accounts + any with stored history). */
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

/** @param {string} email */
export function displayNameForEmail(email) {
  const key = String(email || "").trim().toLowerCase();
  return DUMMY_USERS[key]?.name || key.split("@")[0] || "SE";
}
