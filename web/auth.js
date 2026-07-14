/**
 * Authentication — dummy credentials now; Firebase SSO can replace this module later.
 * Session is stored in sessionStorage as { role, email, name }.
 */

import { firebaseConfig } from "./firebase-config.js";

const SESSION_KEY = "se-sp-session";

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

/** @returns {{ role: string, email: string, name: string, uid?: string } | null} */
export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.email || !s?.role) return null;
    return s;
  } catch {
    return null;
  }
}

function setSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  listeners.forEach((fn) => fn(session));
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
