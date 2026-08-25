/**
 * Admin endpoint: mint a Firebase custom token to impersonate any user.
 *
 * SECURITY (C1 fix from security review):
 *   - Hard-gated to non-production: refuses to run when NODE_ENV=production.
 *   - Requires an additional X-Impersonate-Secret header matching
 *     IMPERSONATE_SECRET env var, so a compromised dev token alone is not
 *     enough — the attacker also needs the secret.
 *   - No longer auto-creates Firebase users (removed the createUser
 *     fallback — impersonation is for existing users only).
 *   - Logs every impersonation event to console.error (structured) so it
 *     shows in Cloud Run logs. SQL audit_log logging is queued for when
 *     the audit_log table becomes operational (it is currently dead — see
 *     janus_unutilized_tables.md).
 *
 * POST /api/admin/impersonate-token
 * Headers: Authorization: Bearer <caller Firebase token>
 *          X-Impersonate-Secret: <IMPERSONATE_SECRET env value>
 * Body: { targetEmail }
 * Returns: { token, uid, email }
 */

import { requireUser } from "../auth";
import { json } from "../http";
import type { Env } from "../env";
import type { RouteHandler } from "../routes";

const DEV_EMAILS = [
  "sathish.kuttan@freshworks.com",
  "antony.sagayaraj@freshworks.com",
  "sowrav.sunil@freshworks.com",
];

function isProduction(): boolean {
  return (process.env.NODE_ENV || "").toLowerCase() === "production";
}

function impersonateSecret(env: Env): string {
  return (env.IMPERSONATE_SECRET || process.env.IMPERSONATE_SECRET || "").trim();
}

export const handleImpersonateToken: RouteHandler = async (
  request,
  env,
  _url,
  cors,
) => {
  // C1 fix: hard-gate — impersonation must never be reachable in production.
  if (isProduction()) {
    return json({ error: "Impersonation endpoint is disabled in production." }, 403, cors);
  }

  const caller = await requireUser(request, env);
  if (!caller?.email) {
    return json({ error: "Sign-in required." }, 401, cors);
  }

  const callerEmail = caller.email.trim().toLowerCase();
  if (!DEV_EMAILS.includes(callerEmail)) {
    return json({ error: "Access denied." }, 403, cors);
  }

  // C1 fix: require a separate secret header so a stolen Firebase token alone
  // is not enough to impersonate.
  const secret = impersonateSecret(env);
  if (!secret) {
    return json({ error: "Impersonation is not configured (set IMPERSONATE_SECRET)." }, 403, cors);
  }
  const provided = request.headers.get("X-Impersonate-Secret") || "";
  if (!provided || provided !== secret) {
    return json({ error: "Invalid impersonation secret." }, 403, cors);
  }

  const body = (await request.json()) as { targetEmail?: string };
  const targetEmail = String(body.targetEmail || "").trim().toLowerCase();
  if (!targetEmail) {
    return json({ error: "targetEmail is required." }, 400, cors);
  }

  // C1 fix: structured audit log (always visible in Cloud Run logs).
  console.error("[AUDIT] impersonation", {
    action: "impersonate_token_minted",
    callerEmail,
    targetEmail,
    timestamp: new Date().toISOString(),
  });

  try {
    const adminMod = await import("firebase-admin");
    const admin = adminMod.default ?? adminMod;

    // C1 fix: only impersonate EXISTING users — never auto-create.
    let targetUid: string;
    try {
      const targetUser = await admin.auth().getUserByEmail(targetEmail);
      targetUid = targetUser.uid;
    } catch {
      return json({ error: `User ${targetEmail} not found in Firebase Auth.` }, 404, cors);
    }

    const token = await admin.auth().createCustomToken(targetUid, {
      email: targetEmail,
      email_verified: true,
    });

    return json({ token, uid: targetUid, email: targetEmail }, 200, cors);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Impersonation failed.";
    return json({ error: message }, 500, cors);
  }
};