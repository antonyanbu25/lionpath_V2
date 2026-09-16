/** Pure Firebase auth guard helpers — testable without browser/Firebase SDK. */

export function normalizeAuthEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/** True when cached portal session belongs to the live Firebase user. */
export function sessionMatchesFirebaseUser(cachedSession, firebaseUser) {
  if (!cachedSession?.email || !firebaseUser?.email) return false;
  return normalizeAuthEmail(cachedSession.email) === normalizeAuthEmail(firebaseUser.email);
}

/** Defer reacting to user===null until auth is settled or SSO finishes. */
export function shouldDeferNullAuth({ authResolved, ssoInFlight, signingOut }) {
  return !authResolved || ssoInFlight || signingOut;
}

/** After a grace window, sign out only when Firebase still has no user. */
export function shouldLogoutAfterNullCheck({ liveFirebaseUser, ssoInFlight, signingOut }) {
  if (ssoInFlight || signingOut) return false;
  if (liveFirebaseUser?.email) return false;
  return true;
}
