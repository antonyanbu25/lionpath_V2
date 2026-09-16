/**
 * Shared assume-identity client signals (expired session, etc.).
 */

export const ASSUME_IDENTITY_EXPIRED_EVENT = "se-assume-identity-expired";

/** @param {Response} res @param {Record<string, unknown>} body */
export function dispatchAssumeIdentityExpiredIfNeeded(res, body) {
  if (res.status === 401 && body?.assumeIdentityExpired) {
    try {
      window.dispatchEvent(new CustomEvent(ASSUME_IDENTITY_EXPIRED_EVENT));
    } catch {
      /* ignore */
    }
  }
}
