/**
 * Admin endpoint: mint a Firebase custom token to impersonate any user.
 * Only accessible to 3 dev accounts (sathish.kuttan, antony.sagayaraj, sowrav.sunil).
 * POST /api/admin/impersonate-token  body: { targetEmail }
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

export const handleImpersonateToken: RouteHandler = async (
  request,
  env,
  _url,
  cors,
) => {
  const caller = await requireUser(request, env);
  if (!caller?.email) {
    return json({ error: "Sign-in required." }, 401, cors);
  }

  const callerEmail = caller.email.trim().toLowerCase();
  if (!DEV_EMAILS.includes(callerEmail)) {
    return json({ error: "Access denied." }, 403, cors);
  }

  const body = (await request.json()) as { targetEmail?: string };
  const targetEmail = String(body.targetEmail || "").trim().toLowerCase();
  if (!targetEmail) {
    return json({ error: "targetEmail is required." }, 400, cors);
  }

  // Use firebase-admin to look up the user & mint a custom token
  const { getDb } = await import("../data/firestore-admin");
  try {
    // We need the admin auth module — use the same initialized app
    const adminMod = await import("firebase-admin");
    const admin = adminMod.default ?? adminMod;

    // Find the target user by email
    let targetUid: string;
    try {
      const targetUser = await admin.auth().getUserByEmail(targetEmail);
      targetUid = targetUser.uid;
    } catch {
      // User doesn't exist in Firebase Auth — create one
      targetUid = (
        await admin.auth().createUser({
          email: targetEmail,
          emailVerified: true,
          displayName: targetEmail.split("@")[0],
        })
      ).uid;
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
