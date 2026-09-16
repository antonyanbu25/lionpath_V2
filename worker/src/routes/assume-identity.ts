/**
 * Assume-Identity endpoints — secure admin impersonation for support/debugging.
 *
 * POST /api/admin/assume-identity
 * POST /api/admin/assume-identity/exit
 */

import { requireUser, type VerifiedUser, type AssumeIdentityClaims } from "../auth";
import { json } from "../http";
import type { Env } from "../env";
import type { RouteHandler } from "../routes";
import { resolveSqlSession } from "../data/persistence/session-context";
import { insertAuditLog, resolveAppUserIdFromAuthUid, type AuditLogEntry } from "../data/audit-log";
import { postgresReady } from "../data/persistence/postgres-pool";
import { checkRateLimit } from "../rate-limit";

const ASSUME_TTL_MS = 15 * 60 * 1000;
const ASSUME_RATE_LIMIT_PER_MIN = 5;
const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

interface LockoutEntry {
  failCount: number;
  firstFailAt: number;
  lockedUntil: number;
}
const lockoutMap = new Map<string, LockoutEntry>();

function isLockedOut(adminUid: string): boolean {
  const entry = lockoutMap.get(adminUid);
  if (!entry) return false;
  if (entry.lockedUntil > Date.now()) return true;
  if (entry.lockedUntil > 0 && entry.lockedUntil <= Date.now()) {
    lockoutMap.delete(adminUid);
  }
  return false;
}

function recordFailedAttempt(adminUid: string): void {
  const now = Date.now();
  const entry = lockoutMap.get(adminUid);
  if (!entry || now - entry.firstFailAt > LOCKOUT_WINDOW_MS) {
    lockoutMap.set(adminUid, { failCount: 1, firstFailAt: now, lockedUntil: 0 });
    return;
  }
  entry.failCount++;
  if (entry.failCount >= LOCKOUT_THRESHOLD) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS;
    console.error("[AUDIT] assume-identity lockout", { adminUid, failCount: entry.failCount });
  }
}

function clearFailedAttempts(adminUid: string): void {
  lockoutMap.delete(adminUid);
}

function generateSessionId(): string {
  return `asume_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Firebase ID token custom claims (snake_case — must match auth.ts verify). */
export function buildAssumeIdentityFirebaseClaims(
  sessionId: string,
  adminUid: string,
  adminEmail: string,
  reason: string,
  expiresAtIso: string,
): Record<string, string | boolean> {
  return {
    assume_identity: true,
    assume_session_id: sessionId,
    assume_admin_uid: adminUid,
    assume_admin_email: adminEmail,
    assume_reason: reason,
    assume_expires_at: expiresAtIso,
  };
}

export function addAssumeIdentityHeaders(
  headers: Record<string, string>,
  verified: VerifiedUser,
): Record<string, string> {
  if (!verified.assumeIdentity) return headers;
  return {
    ...headers,
    "X-Assume-Identity": "true",
    "X-Assume-Identity-Target": verified.email,
    "X-Assume-Identity-Expires-At": verified.assumeIdentity.assumeExpiresAt,
  };
}

/** Capabilities payload for GET /api/admin/assume-identity/capabilities */
export function buildAssumeIdentityCapabilitiesResponse(canAssumeIdentity: boolean): {
  canAssumeIdentity: boolean;
} {
  return { canAssumeIdentity };
}

async function writeAssumeAuditOrError(
  env: Env,
  cors: Record<string, string>,
  adminAuthUid: string,
  entry: Omit<AuditLogEntry, "userId">,
): Promise<Response | null> {
  const adminAppUserId = await resolveAppUserIdFromAuthUid(adminAuthUid, env);
  if (!adminAppUserId) {
    return json({ error: "Assume-identity audit unavailable." }, 503, cors);
  }
  const ok = await insertAuditLog(env, { userId: adminAppUserId, ...entry });
  if (!ok) {
    return json({ error: "Assume-identity audit unavailable." }, 503, cors);
  }
  return null;
}

export const handleAssumeIdentityCapabilities: RouteHandler = async (request, env, _url, cors) => {
  if (!postgresReady(env)) {
    return json(buildAssumeIdentityCapabilitiesResponse(false), 200, cors);
  }
  const caller = await requireUser(request, env);
  if (!caller) {
    return json(buildAssumeIdentityCapabilitiesResponse(false), 200, cors);
  }
  const adminSession = await resolveSqlSession(caller.uid, env);
  return json(buildAssumeIdentityCapabilitiesResponse(!!adminSession?.isAdmin), 200, cors);
};

export const handleAssumeIdentity: RouteHandler = async (request, env, _url, cors) => {
  if (!firebaseAdminReady(env)) {
    return json({ error: "Assume-identity requires Firebase Auth." }, 503, cors);
  }
  if (!postgresReady(env)) {
    return json({ error: "Assume-identity requires PostgreSQL (role check + audit log)." }, 503, cors);
  }

  const caller = await requireUser(request, env);
  if (!caller) {
    return json({ error: "Sign-in required." }, 401, cors);
  }

  if (caller.assumeIdentity) {
    return json(
      { error: "Cannot start assume-identity while already in assume mode. Exit first." },
      400,
      cors,
    );
  }

  const rateAdminUid = caller.uid;

  const rateResult = checkRateLimit(
    `assume-identity:${rateAdminUid}`,
    undefined,
    {
      RATE_LIMIT_ENABLED: "1",
      RATE_LIMIT_PER_MINUTE: String(ASSUME_RATE_LIMIT_PER_MIN),
      RATE_LIMIT_BURST: String(ASSUME_RATE_LIMIT_PER_MIN),
    } as Env,
  );
  if (rateResult) {
    return json(
      { error: "Too many assume-identity requests. Please wait.", retryAfter: rateResult.retryAfter },
      429,
      { ...cors, "Retry-After": String(rateResult.retryAfter) },
    );
  }

  if (isLockedOut(rateAdminUid)) {
    const entry = lockoutMap.get(rateAdminUid);
    const retryAfter = entry ? Math.ceil((entry.lockedUntil - Date.now()) / 1000) : 60;
    return json(
      { error: "Assume-identity locked out due to repeated failures.", retryAfter },
      429,
      { ...cors, "Retry-After": String(retryAfter) },
    );
  }

  const adminSession = await resolveSqlSession(caller.uid, env);
  if (!adminSession) {
    recordFailedAttempt(caller.uid);
    return json({ error: "Your SQL user profile was not found. Migration may be incomplete." }, 403, cors);
  }
  if (!adminSession.isAdmin) {
    recordFailedAttempt(caller.uid);
    return json({ error: "Assume-identity is only available to admins." }, 403, cors);
  }

  const body = (await request.json()) as { targetEmail?: string; reason?: string };
  const targetEmail = String(body.targetEmail || "").trim().toLowerCase();
  const reason = String(body.reason || "").trim();

  if (!targetEmail) {
    recordFailedAttempt(caller.uid);
    return json({ error: "targetEmail is required." }, 400, cors);
  }
  if (reason.length < 10) {
    recordFailedAttempt(caller.uid);
    return json({ error: "reason is required (min 10 chars)." }, 400, cors);
  }

  const domain = (env.ALLOWED_EMAIL_DOMAIN || "").trim().toLowerCase();
  if (domain && !targetEmail.endsWith(`@${domain}`)) {
    recordFailedAttempt(caller.uid);
    return json({ error: `Target must be a @${domain} account.` }, 403, cors);
  }

  let targetUid: string;
  let targetDisplayName: string;
  try {
    const adminMod = await import("firebase-admin");
    const admin = adminMod.default ?? adminMod;
    const targetUser = await admin.auth().getUserByEmail(targetEmail);
    targetUid = targetUser.uid;
    targetDisplayName = targetUser.displayName || targetEmail.split("@")[0];
  } catch {
    recordFailedAttempt(caller.uid);
    return json({ error: `User ${targetEmail} not found in Firebase Auth.` }, 404, cors);
  }

  const targetSession = await resolveSqlSession(targetUid, env);
  if (!targetSession) {
    recordFailedAttempt(caller.uid);
    return json({ error: "Target user has no SQL profile (pre-migration)." }, 404, cors);
  }
  if (targetSession.isAdmin) {
    recordFailedAttempt(caller.uid);
    return json({ error: "Cannot assume identity of an admin account." }, 403, cors);
  }

  const now = Date.now();
  const expiresAt = new Date(now + ASSUME_TTL_MS).toISOString();
  const assumeSessionId = generateSessionId();

  const firebaseClaims = buildAssumeIdentityFirebaseClaims(
    assumeSessionId,
    caller.uid,
    caller.email,
    reason,
    expiresAt,
  );

  const auditErr = await writeAssumeAuditOrError(env, cors, caller.uid, {
    entityType: "assume_identity",
    entityId: assumeSessionId,
    action: "override",
    payload: {
      action_type: "assume",
      admin_email: caller.email,
      admin_uid: caller.uid,
      target_email: targetEmail,
      target_uid: targetUid,
      target_user_id: targetSession.userId,
      reason,
      assume_session_id: assumeSessionId,
      expires_at: expiresAt,
      timestamp: new Date(now).toISOString(),
    },
  });
  if (auditErr) {
    recordFailedAttempt(caller.uid);
    return auditErr;
  }

  let token: string;
  try {
    const adminMod = await import("firebase-admin");
    const admin = adminMod.default ?? adminMod;
    token = await admin.auth().createCustomToken(targetUid, firebaseClaims);
  } catch {
    recordFailedAttempt(caller.uid);
    return json({ error: "Token minting failed." }, 500, cors);
  }

  clearFailedAttempts(caller.uid);

  const claimsForClient: AssumeIdentityClaims = {
    assumeIdentity: true,
    assumeSessionId,
    assumeAdminUid: caller.uid,
    assumeAdminEmail: caller.email,
    assumeReason: reason,
    assumeExpiresAt: expiresAt,
  };

  return json({
    ok: true,
    token,
    targetUid,
    targetEmail,
    targetDisplayName,
    expiresAt,
    assumeSessionId,
    adminEmail: caller.email,
    assumeIdentity: claimsForClient,
    warning: "You are now in Assume-Identity mode. All actions are audited.",
  }, 200, cors);
};

export const handleAssumeIdentityExit: RouteHandler = async (request, env, _url, cors) => {
  if (!firebaseAdminReady(env)) {
    return json({ error: "Assume-identity requires Firebase Auth." }, 503, cors);
  }

  const verified = await requireUser(request, env);
  if (!verified) {
    return json({ error: "Sign-in required." }, 401, cors);
  }
  if (!verified.assumeIdentity) {
    return json({ error: "You are not in an assume-identity session." }, 400, cors);
  }

  const claims = verified.assumeIdentity;
  const now = Date.now();
  const assumeStartedAt = new Date(claims.assumeExpiresAt).getTime() - ASSUME_TTL_MS;
  const durationSeconds = Math.max(0, Math.round((now - assumeStartedAt) / 1000));

  const auditErr = await writeAssumeAuditOrError(env, cors, claims.assumeAdminUid, {
    entityType: "assume_identity",
    entityId: claims.assumeSessionId,
    action: "override",
    payload: {
      action_type: "exit",
      admin_email: claims.assumeAdminEmail,
      admin_uid: claims.assumeAdminUid,
      target_email: verified.email,
      target_uid: verified.uid,
      reason: claims.assumeReason,
      assume_session_id: claims.assumeSessionId,
      duration_seconds: durationSeconds,
      timestamp: new Date(now).toISOString(),
    },
  });
  if (auditErr) return auditErr;

  return json({
    ok: true,
    requireReauth: true,
    adminUid: claims.assumeAdminUid,
    adminEmail: claims.assumeAdminEmail,
    assumeSessionId: claims.assumeSessionId,
    durationSeconds,
    message: "Assume-identity session ended. Sign in with your admin account.",
  }, 200, cors);
};

function firebaseAdminReady(env: Env): boolean {
  return !!(env.FIREBASE_PROJECT_ID || "").trim() && !!(env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
}
