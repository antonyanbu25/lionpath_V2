/** Session helpers. no auth imports to avoid cycles with domain layer. */

import { stableUserIdForEmail } from "./id.js";

/** @param {{ userId?: string, uid?: string } | null | undefined} session */
export function sessionUserId(session) {
  return session?.userId || session?.uid || null;
}

/** True when uid/userId is a Firebase auth uid mistakenly stored as profile id. */
function isFirebaseAuthUidAsProfile(session, id) {
  return !!(session?.authUid && id && id === session.authUid);
}

/**
 * Domain user id for RBAC/store — stable email hash when Firestore profile sync lags.
 * @param {{ userId?: string, uid?: string, email?: string, authUid?: string } | null | undefined} session
 */
export function effectiveSessionUserId(session) {
  const raw = sessionUserId(session);
  if (raw && !isFirebaseAuthUidAsProfile(session, raw)) return raw;
  const email = session?.email?.trim().toLowerCase();
  return email ? stableUserIdForEmail(email) : null;
}

/**
 * Ensure session carries a domain userId/uid (never block UI on missing Firestore profile).
 * @param {object | null | undefined} session
 */
export function withEffectiveUserId(session) {
  if (!session?.email) return session;
  const email = String(session.email).trim().toLowerCase();
  const domainId = stableUserIdForEmail(email);
  const raw = sessionUserId(session);
  if (raw && !isFirebaseAuthUidAsProfile(session, raw)) {
    if (raw === session.userId && raw === session.uid && email === session.email) return session;
    return { ...session, userId: raw, uid: raw, email };
  }
  return { ...session, userId: domainId, uid: domainId, email };
}
