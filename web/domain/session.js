/** Session helpers — no auth imports to avoid cycles with domain layer. */

/** @param {{ userId?: string, uid?: string } | null | undefined} session */
export function sessionUserId(session) {
  return session?.userId || session?.uid || null;
}
