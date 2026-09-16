# Assume-Identity — Build Notes

Branch: `feat/assume-identity` (off `origin/main`)

## What was built

A secure admin impersonation ("assume-identity") feature that replaces the
crude, insecure `impersonate.ts` endpoint. An admin can temporarily assume
a non-admin user's identity to see exactly what that user sees — with
proper role-based authorization, RLS-correct session scoping, audit
logging, TTL enforcement, and rate limiting.

## Files changed

| File | Change |
|------|--------|
| `worker/src/routes/assume-identity.ts` **(new)** | The two endpoints: `handleAssumeIdentity` (assume) + `handleAssumeIdentityExit` (exit). Admin role check, target non-admin check, rate limiting, lockout, token minting with claims, audit logging. |
| `worker/src/data/audit-log.ts` **(new)** | `insertAuditLog` helper — writes to the SQL `audit_log` table via `withSystemContext` (sentinel, admin scope). `resolveAppUserIdFromAuthUid` helper. |
| `worker/src/auth.ts` | Extended `VerifiedUser` with `assumeIdentity` claims. `verifyFirebaseToken` now reads `assume_identity` custom claims and enforces the 15-minute `assume_expires_at` TTL. `requireUser` stamps claims into the request context. |
| `worker/src/request-context.ts` | Added `setAssumeIdentityForRequest` / `getAssumeIdentityForRequest` — module-level request-scoped storage for assume-identity claims, so `withCorrelationHeader` can stamp `X-Assume-Identity` headers on every response. |
| `worker/src/index.ts` | Imported and registered the two new routes. `withCorrelationHeader` now adds `X-Assume-Identity` and `X-Assume-Identity-Expires-At` headers when the request is from an assumed session. |

## Endpoints

### POST /api/admin/assume-identity

Assumes the identity of a target user. Returns a Firebase custom token
for the target's UID with assume-identity claims.

**Headers:** `Authorization: Bearer <admin's Firebase ID token>`

**Body:**
```json
{
  "targetEmail": "se.user@freshworks.com",
  "reason": "Support ticket #1234 — user reports blank dashboard"
}
```

**Response (200):**
```json
{
  "ok": true,
  "token": "<Firebase custom token for target's UID>",
  "targetUid": "<Firebase UID>",
  "targetEmail": "se.user@freshworks.com",
  "targetDisplayName": "SE User",
  "expiresAt": "2026-08-23T15:45:00Z",
  "assumeSessionId": "asume_a1b2c3d4",
  "adminEmail": "admin@freshworks.com",
  "warning": "You are now in Assume-Identity mode. All actions are audited."
}
```

**Error responses:**
- 401: Not signed in.
- 403: Not an admin / target is an admin / domain mismatch.
- 404: Target user not found in Firebase Auth or has no SQL profile.
- 429: Rate limited (5/min) or locked out (10 fails in 10 min → 15-min lockout).
- 503: Firebase or PostgreSQL not configured.

### POST /api/admin/assume-identity/exit

Exits assume-identity mode. Returns a Firebase custom token for the
admin's own UID (from the `assume_admin_uid` claim in the current
assumed-identity token).

**Headers:** `Authorization: Bearer <assumed-identity Firebase ID token>`

**Response (200):**
```json
{
  "ok": true,
  "token": "<Firebase custom token for admin's own UID>",
  "adminUid": "<admin's Firebase UID>",
  "adminEmail": "admin@freshworks.com",
  "assumeSessionId": "asume_a1b2c3d4",
  "durationSeconds": 842
}
```

## How to use it (web client)

1. Admin signs in normally (Firebase SSO).
2. Admin calls `POST /api/admin/assume-identity` with their ID token,
   `targetEmail`, and `reason`.
3. The response contains a `token` (Firebase custom token for the target).
4. The web client calls `firebase.auth().signInWithCustomToken(token)`.
5. Firebase issues a new ID token for the target's UID. Subsequent
   `getIdToken()` calls return the target's token.
6. The web client displays a persistent banner: "ASSUME-IDENTITY MODE —
   viewing as se.user@freshworks.com. Expires at 15:45. [Exit]".
7. Every API response includes `X-Assume-Identity: true` and
   `X-Assume-Identity-Expires-At` headers.
8. After 15 minutes, the worker rejects the assumed-identity token with
   401 `assumeIdentityExpired`. The web client prompts re-login.
9. To exit early: call `POST /api/admin/assume-identity/exit` with the
   assumed-identity token. The response contains a new custom token for
   the admin's own UID. The web client calls
   `signInWithCustomToken(adminToken)` to restore the admin's session.

## How to review it

### Security review checklist

1. **Admin check is DB-based, not email-based:**
   `assume-identity.ts:97-103` — `resolveSqlSession(caller.uid)` queries
   `user_role` JOIN `app_role WHERE ar.name = 'admin'`. If
   `session.isAdmin === false`, 403.

2. **Target must be non-admin (V2 fix):**
   `assume-identity.ts:140-144` — `resolveSqlSession(targetUid)` resolves
   the target's session. If `targetSession.isAdmin === true`, 403.

3. **RLS scope is the target's:**
   The custom token is for the target's Firebase UID. When the web client
   signs in with it, `getIdToken()` returns the target's token. The
   worker's `requireUser` → `verifyFirebaseToken` extracts the target's
   `uid`. `resolveSqlSession(targetUid)` returns the target's
   `user_id`, `org_unit_path`, `is_admin=false`. `withSessionContext`
   sets RLS vars to the target's scope. The admin sees what the target
   sees.

4. **15-minute TTL enforced on every request:**
   `auth.ts:72-79` — `verifyFirebaseToken` checks `assume_expires_at`
   when `assume_identity === true`. If expired, throws 401 with
   `assumeIdentityExpired: true`.

5. **Audit trail:**
   `audit-log.ts:28-48` — `insertAuditLog` writes to `audit_log` via
   `withSystemContext` (sentinel, admin scope). The insert is
   fire-and-forget (errors logged, never blocks). `REVOKE UPDATE, DELETE`
   on `audit_log` makes it tamper-resistant at the `janus_app` level.

6. **Rate limiting + lockout:**
   `assume-identity.ts:82-90` — 5 requests/min per admin via
   `checkRateLimit`. `assume-identity.ts:35-65` — lockout after 10 failed
   attempts in 10 minutes → 15-minute lockout.

7. **Response headers:**
   `index.ts:60-66` — `withCorrelationHeader` adds
   `X-Assume-Identity: true` and `X-Assume-Identity-Expires-At` headers
   on every response when the request is from an assumed session.

8. **No auto-create:**
   `assume-identity.ts:128-133` — `getUserByEmail` only; if the target
   doesn't exist, 404. No `createUser` fallback.

### What was NOT built (deferred)

- **Web client banner UI:** The response headers and `_assumeIdentity`
  metadata are available for the web client to display the banner, but
  the client-side `signInWithCustomToken` + banner code is not in this
  branch. It requires changes to `web/auth.js` and `web/app.js` which are
  out of scope for this server-side build.
- **Per-request audit logging:** Individual API requests during the
  assumed session are not logged to `audit_log` — only the assume and
  exit events. The `assume_session_id` can be correlated with Cloud Run
  request logs if per-action auditing is needed.
- **Server-side session revocation:** Firebase custom tokens are
  stateless (cannot be revoked). The 15-minute TTL is the revocation
  mechanism. A server-side session store is a future enhancement.

### Claim keys (Firebase custom token)

Custom claims use **snake_case** in the JWT (`assume_identity`, `assume_expires_at`, …).
`buildAssumeIdentityFirebaseClaims()` in `assume-identity.ts` must stay aligned with
`parseAssumeIdentityClaims()` in `auth.ts`.

Run: `npx tsx scripts/test-assume-identity-claims.mjs`

## Verification

- `tsc --noEmit`: 0 errors
- Unit tests: 83/84 passed (1 pre-existing port-bind failure, unrelated)
- Janus phase tests: 36/36 passed