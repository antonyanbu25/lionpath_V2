# Assume-Identity Feature — Design & Validation

Branch: `feat/assume-identity` (off `origin/main`)

## Purpose

Allow authorized admins to temporarily assume the identity of another user
to see exactly what that user sees — for support, debugging, and
calibration. This is a standard admin/support capability ("assume identity"
or "impersonation"). The previous implementation
(`worker/src/routes/impersonate.ts`) was a crude, insecure version gated
only by a hardcoded email allowlist. This document designs the feature
properly: secure, auditable, RLS-correct, and production-safe.

---

## PHASE 1: DESIGN

### 1.1 Admin authentication — DB role check, not email allowlist

**Problem:** The old endpoint checked `DEV_EMAILS.includes(callerEmail)` —
a hardcoded string list. Adding/removing admins required a code change, and
the check was unrelated to the DB's `app_role`/`user_role` model that RLS
uses.

**Design:** The endpoint verifies the caller's Firebase ID token
(`requireUser` → `verifyFirebaseToken`), then resolves their SQL session
(`resolveSqlSession`) which queries `user_role` JOIN `app_role` for
`ar.name = 'admin'` with temporal validity (`valid_from <= now() AND
(valid_to IS NULL OR valid_to > now())`). The `session.isAdmin` flag is
the single source of truth for admin status — same flag RLS policies use.

If `session.isAdmin` is false → 403. No email allowlist. No hardcoded
names. The DB role assignment is the gate.

**Fallback for pre-migration users:** If `resolveSqlSession` returns null
(no SQL row yet), the endpoint returns 403 — assume-identity requires the
admin to have a SQL user row with an active `admin` role. This is correct:
the feature depends on RLS, which depends on the SQL session, which
depends on the user existing in SQL.

### 1.2 Target user selection and confirmation

**Endpoint:** `POST /api/admin/assume-identity`

**Request:**
```json
{
  "targetEmail": "se.user@freshworks.com",
  "reason": "Support ticket #1234 — user reports blank dashboard"
}
```

- `targetEmail` (required): the email of the user to assume. Normalized to
  lowercase. Must match `ALLOWED_EMAIL_DOMAIN`.
- `reason` (required, min 10 chars): a free-text justification. Stored in
  the audit log. Prevents casual/useless impersonation.

**Response (success):**
```json
{
  "ok": true,
  "token": "<Firebase custom token>",
  "targetUid": "<Firebase UID>",
  "targetEmail": "se.user@freshworks.com",
  "targetDisplayName": "SE User",
  "expiresAt": "2026-08-23T15:45:00Z",
  "assumeSessionId": "asume_a1b2c3d4",
  "adminEmail": "admin@freshworks.com",
  "warning": "You are now in Assume-Identity mode. All actions are audited."
}
```

**Confirmation:** The admin must explicitly call this endpoint — there is
no implicit assumption. The `reason` field is the confirmation gate. The
response includes `warning` and `assumeSessionId` so the web client can
display a persistent banner.

### 1.3 Token minting and expiry

**Token:** A Firebase custom token minted via
`admin.auth().createCustomToken(targetUid, claims)` where `claims`
includes:
```json
{
  "assume_identity": true,
  "assume_session_id": "asume_a1b2c3d4",
  "assume_admin_uid": "<admin's Firebase UID>",
  "assume_admin_email": "admin@freshworks.com",
  "assume_reason": "Support ticket #1234",
  "assume_expires_at": "2026-08-23T15:45:00Z"
}
```

These custom claims are embedded in the Firebase custom token. When the
web client calls `signInWithCustomToken(token)`, Firebase Auth issues an
ID token for the **target user's UID** with these claims. The worker's
`verifyFirebaseToken` then:
1. Verifies the token signature (standard Firebase JWT verification).
2. Checks `email_verified` (Firebase sets this from the custom token
   claims).
3. Reads `assume_identity` from the payload — if true, the worker knows
   this is an assumed-identity session.

**TTL:** The custom token itself is short-lived (Firebase custom tokens
expire after 1 hour by default). Additionally, the `assume_expires_at`
claim is set to **15 minutes** from mint time. The worker checks this
claim on every request from an assumed-identity session — if expired, the
worker returns 401 with a clear "assume-identity session expired" message,
even if the Firebase ID token is still valid.

**Why 15 minutes:** Long enough to diagnose a support issue, short enough
to limit abuse. The admin can re-assume if needed (another audit event).

**No token reuse:** Each assume-identity call mints a new custom token
with a new `assume_session_id`. The web client must call
`signInWithCustomToken` to use it — the old token is not reusable after
the admin exits (see 1.5).

### 1.4 How the admin tells they're in assume-identity mode

**Worker-side:** Every API response from an assumed-identity session
includes two headers:
- `X-Assume-Identity: true`
- `X-Assume-Identity-Target: <target email>`
- `X-Assume-Identity-Expires-At: <ISO timestamp>`

The response body includes `_assumeIdentity` metadata when the response is
JSON:
```json
{
  "_assumeIdentity": {
    "active": true,
    "targetEmail": "se.user@freshworks.com",
    "expiresAt": "2026-08-23T15:45:00Z",
    "adminEmail": "admin@freshworks.com"
  },
  ...actual response data...
}
```

**Web client:** The web client reads the `assume_identity` claim from the
Firebase ID token (or the response header) and displays a persistent,
non-dismissable banner: "⚠ ASSUME-IDENTITY MODE — You are viewing as
se.user@freshworks.com. Actions are audited. [Exit]". The banner stays
until the admin clicks "Exit" or the session expires.

### 1.5 How to EXIT assume-identity mode

**Endpoint:** `POST /api/admin/assume-identity/exit`

**Request:** The admin's current (assumed-identity) Firebase ID token is
sent as `Authorization: Bearer`. The worker records the exit in
`audit_log` and returns **no admin custom token** (prevents stolen
assumed JWT from being exchanged for admin access):
```json
{
  "ok": true,
  "requireReauth": true,
  "adminUid": "<admin's Firebase UID>",
  "adminEmail": "admin@freshworks.com",
  "assumeSessionId": "asume_a1b2c3d4",
  "durationSeconds": 842,
  "message": "Assume-identity session ended. Sign in with your admin account."
}
```

The web client clears assume UI state, signs out of Firebase, and
prompts the admin to sign in again with their own credentials. The audit
log records the exit with the duration.

**Automatic exit:** If the `assume_expires_at` claim is expired, the
worker returns 401 on the next request. The web client detects the
`assume-identity-expired` error, displays "Assume-identity session
expired", and prompts the admin to sign in again with their own
credentials (or re-assume).

**Token invalidation:** Firebase custom tokens are stateless — they
cannot be revoked. The 15-minute TTL is the revocation mechanism. After
exit, the web client discards the assumed-identity token and signs in
with the admin's own token. The old assumed-identity ID token will still
verify until its Firebase TTL (1 hour), but the worker's
`assume_expires_at` check (15 minutes) rejects it.

### 1.6 Audit trail

**Decision: SQL `audit_log` table, not a structured log store.**

**Justification:**
- The `audit_log` table exists in the schema (`03_phase3_ai_pipeline.sql`)
  with partitioning, `REVOKE UPDATE, DELETE` (append-only), and an
  `audit_action_enum`. It was dead (no inserts) — this feature activates
  it for assume-identity events.
- SQL is tamper-resistant: `janus_app` cannot UPDATE or DELETE
  (`REVOKE`), and the `ALTER ROLE janus_app SET app.is_admin = 'false'`
  default (from `feat/security-hardening`) prevents direct-connection
  bypass. Console logs can be lost or tampered with.
- Queryable: admins can `SELECT * FROM audit_log WHERE action =
  'override' AND payload->>'assume_session_id' = '...'` to review
  assume-identity history.

**What's logged:** Every assume-identity action inserts a row into
`audit_log`:
- `user_id`: the **admin's** `app_user.id` (the actor, not the target)
- `entity_type`: `'assume_identity'`
- `entity_id`: the `assume_session_id`
- `action`: `'override'` (using the existing enum — closest match; the
  enum is `create|update|delete|anonymize|override|merge`, and
  assume-identity is an access override)
- `payload`: JSONB with:
  ```json
  {
    "action_type": "assume" | "exit",
    "admin_email": "admin@freshworks.com",
    "admin_uid": "<Firebase UID>",
    "target_email": "se.user@freshworks.com",
    "target_uid": "<Firebase UID>",
    "target_user_id": <SQL app_user.id>,
    "reason": "Support ticket #1234",
    "assume_session_id": "asume_a1b2c3d4",
    "expires_at": "2026-08-23T15:45:00Z",
    "duration_seconds": 842,
    "timestamp": "2026-08-23T15:30:00Z"
  }
  ```

**Insert mechanism:** The audit insert runs in its own
`withUnrestrictedSystemContext` transaction (sentinel, admin scope) —
audit logging must not fail due to RLS, and the admin may be assuming a
target in a different org. The insert is fire-and-forget (logged on
failure, never blocks the response).

### 1.7 RLS interaction — target user's scope

**This is the core of the feature.** When the admin assumes identity, the
worker's session resolution must use the **target user's** RLS scope, not
the admin's.

**How it works:**

1. The web client calls `signInWithCustomToken(token)` → Firebase issues
   an ID token for the target user's UID.
2. The web client calls API endpoints with `Authorization: Bearer
   <target's ID token>`.
3. The worker's `requireUser` → `verifyFirebaseToken` verifies the token
   and extracts `uid` (the target's Firebase UID) and the
   `assume_identity` claim.
4. The worker's `resolveSqlSession(targetUid)` resolves the **target's**
   SQL session — `user_id`, `org_unit_path`, `is_admin` (which will be
   false for the target, unless the target is also an admin — see
   validation §2.2).
5. `withSessionContext(targetSession, fn)` sets `app.user_id`,
   `app.org_unit_path`, `app.is_admin` to the **target's** values. RLS
   policies evaluate against the target's scope — the admin genuinely
   sees only what the target sees.

**No RLS bypass:** The admin's own `is_admin=true` is NOT carried into
the assumed session. The `resolveSqlSession` call uses the target's
`auth_uid`, so the query returns the target's `is_admin` flag (typically
false). The admin does not get `is_admin=true` in the assumed session.

### 1.8 Rate limiting and lockout

**Rate limit:** The assume-identity endpoint is rate-limited at
**5 requests per minute per admin** (vs. the default 120/min). This is
enforced via the existing `checkRateLimit` function with a dedicated
bucket key `assume-identity:<adminUid>` and a lower limit. The standard
rate limiter (120/min) still applies as a second layer.

**Lockout:** After **10 failed assume-identity attempts in 10 minutes**
(wrong target, unauthorized, etc.), the admin is locked out for 15
minutes. This is an in-memory counter (same pattern as `rate-limit.ts`)
with the key `assume-identity-lockout:<adminUid>`. A locked-out admin
gets 429 with `Retry-After`.

### 1.9 Production safety

**Boot guard:** The worker checks at boot that `FIREBASE_PROJECT_ID` is
set (existing guard). The assume-identity feature requires Firebase Auth
(custom token minting via `firebase-admin`), so it is implicitly gated by
the Firebase boot guard. If Firebase is not configured, the endpoint
returns 503.

**Role check, not email:** The admin check uses `resolveSqlSession` →
`user_role` JOIN `app_role WHERE ar.name = 'admin'`. A non-admin user
cannot assume identity even if they know the endpoint URL — the SQL
session's `isAdmin` flag is false, and the endpoint returns 403.

**No new env vars for enabling the feature:** The feature is always
available to real admins (as determined by the DB role). There is no
`ASSUME_IDENTITY_ENABLED` flag that could be accidentally left on or off.
The security boundary is the DB role assignment, not an env var.

**Domain restriction:** The target email must match `ALLOWED_EMAIL_DOMAIN`
(checked in the endpoint), preventing assuming identity of external users.

---

## PHASE 2: VALIDATION

### V1. Can a non-admin escalate to admin via this endpoint?

**Attack:** A non-admin calls `POST /api/admin/assume-identity` with
`targetEmail: "admin@freshworks.com"`.

**Defense:**
1. `requireUser` verifies the caller's Firebase ID token — the caller
   must be authenticated.
2. `resolveSqlSession(callerUid)` resolves the caller's SQL session. If
   the caller is not an admin (`session.isAdmin === false`), the endpoint
   returns 403 before looking at the target email.
3. Even if the caller somehow passes the admin check, the minted custom
   token is for the **target's** UID — the caller would need to call
   `signInWithCustomToken` to use it, which replaces their Firebase
   session. They cannot mint a token for themselves.

**Verdict: SAFE.** The admin check is the first gate; it uses the DB
role, not client input.

### V2. Can an admin assume identity into a HIGHER-privilege account?

**Attack:** Admin A (role=admin, org=X) assumes identity of Admin B
(role=admin, org=Y) to access org Y's data.

**Defense:**
1. When Admin A assumes Admin B's identity, `resolveSqlSession(B's uid)`
   resolves B's session with `isAdmin: true`. RLS policies for admin
   (`is_admin()`) would then grant A (as B) access to all rows —
   including org Y's data.

**This IS a real issue.** An admin can assume another admin's identity
and get the other admin's RLS scope. Since `is_admin()` bypasses all
org-path restrictions, assuming any admin's identity grants universal
access.

**Fix in design:** The endpoint **refuses to assume the identity of any
user with `is_admin = true`**. The target must be a non-admin (SE or
manager). This is checked by resolving the target's SQL session and
verifying `targetSession.isAdmin === false`. If the target is an admin,
the endpoint returns 403 with "Cannot assume identity of an admin
account." This limits assume-identity to non-admin users — the purpose is
to see what an SE/manager sees, not to become another admin.

**Revised design (§1.2):** Added a check: resolve the target's SQL
session; if `targetSession.isAdmin === true`, return 403.

### V3. What stops the impersonated session from being confused with the admin's real session?

**Risk:** The admin forgets they're in assume-identity mode and takes an
action (creates a deal, edits a scorecard) thinking they're themselves.

**Defense:**
1. **Response headers** on every API response: `X-Assume-Identity: true`,
   `X-Assume-Identity-Target: <email>`.
2. **Response body marker**: `_assumeIdentity` metadata in JSON
   responses.
3. **15-minute TTL**: the session auto-expires, forcing re-assumption.
4. **Web client banner**: persistent, non-dismissable banner (client-side
   change, not in this build but documented).
5. **Audit trail**: every action during the session is logged with the
   admin's identity in `audit_log`, so even if the admin forgets, the
   audit trail records who did what.

**Residual risk:** The admin can still take write actions (create deals,
edit contacts) while in assume-identity mode. The writes are attributed
to the target user (RLS scope is the target's). The audit log records the
admin as the actor. This is acceptable for a support tool — the admin is
responsible for their actions, and the audit trail provides
accountability. A future enhancement could make assume-identity read-only
(block writes), but that would prevent the admin from testing "can this
user save a deal?" which is a legitimate support use case.

### V4. Is the audit trail tamper-resistant / complete?

**Tamper resistance:**
- `audit_log` has `REVOKE UPDATE, DELETE FROM janus_app` — the app role
  cannot modify or delete rows.
- `ALTER ROLE janus_app SET app.is_admin = 'false'` (from
  `feat/security-hardening`) prevents direct-connection RLS bypass.
- The insert runs via `withUnrestrictedSystemContext` (sentinel, admin)
  — RLS does not block the insert.
- A `SUPERUSER` (postgres) can still tamper, but that's the inherent
  trust boundary — `SUPERUSER` is the DBA, not the app.

**Completeness:**
- Every `assume` action is logged (before the token is minted — if the
  log fails, the token is not minted).
- Every `exit` action is logged (after the exit token is minted — if the
  log fails, the exit still succeeds, but the log gap is visible in
  Cloud Run logs).
- What's NOT logged: individual API requests during the session. The
  audit trail records the assume and exit events (who, target, when,
  duration, reason). Individual actions during the session are
  attributed to the target user's RLS scope (so they appear in
  `deal_stage_history`, `updated_at` timestamps, etc. as the target's
  actions). The audit log entry's `payload` includes the
  `assume_session_id`, which can be correlated with Cloud Run request
  logs if needed.

**Verdict: ADEQUATE.** The audit trail is tamper-resistant at the
`janus_app` level and complete for assume/exit events. Per-request
logging is a future enhancement (would require a middleware that stamps
every request with the `assume_session_id`).

### V5. TTL and token reuse risks

**Risk:** The admin shares the custom token with someone else, or reuses
it after the session should have ended.

**Defense:**
1. The custom token expires after 1 hour (Firebase default). The
   `assume_expires_at` claim (15 minutes) is a second, stricter TTL
   enforced by the worker on every request.
2. After exit, the web client discards the assumed-identity token. The
   old token will still verify at the Firebase level (stateless JWT),
   but the worker's `assume_expires_at` check rejects it.
3. The `assume_session_id` is unique per session. The worker does not
   maintain a server-side session store (stateless), so it cannot
   revoke a specific session — the TTL is the revocation.

**Residual risk:** If the admin shares the custom token within 15
minutes, a third party can use it. This is the same risk as sharing any
auth token. The 15-minute TTL limits the window. A future enhancement
could maintain a server-side set of active `assume_session_id`s and
reject unknown ones, but that adds statefulness and is not needed for
the current threat model (the admin is trusted, the risk is accidental
misuse not malicious sharing).

### V6. RLS bypass risk — does assuming identity ever grant MORE than the target could see?

**Risk:** The assumed session gets `is_admin = true` (the admin's flag)
instead of the target's flag, granting universal access.

**Defense:**
1. `resolveSqlSession` is called with the **target's** Firebase UID (from
   the verified ID token). The query joins `user_identity` → `app_user`
   → `user_role` → `app_role` for the target's UID. It returns the
   target's `is_admin` flag, not the admin's.
2. The `assume_identity` claim in the token does NOT carry `is_admin`.
   The worker does not set `app.is_admin = true` for assumed sessions
   unless the target is actually an admin — which is blocked by the
   design fix in V2.

**Verdict: SAFE.** The assumed session runs under the target's RLS scope
exactly. The admin sees what the target sees — no more, no less.

### V7. What happens on exit — is the session fully restored?

**Risk:** After exit, the admin's session retains some target-scope
residue (cached session, stale RLS vars).

**Defense:**
1. Exit mints a new custom token for the admin's own UID (from the
   `assume_admin_uid` claim). The web client calls
   `signInWithCustomToken` → Firebase issues a new ID token for the
   admin's UID.
2. The worker's `resolveSqlSession(adminUid)` resolves the admin's own
   session (with `is_admin = true`). RLS vars are set to the admin's
   scope.
3. The 60s `sessionCache` in `session-context.ts` may serve a stale
   cached session for the admin's UID — but the cache is keyed by
   `authUid` (Firebase UID), and the admin's UID is different from the
   target's UID, so the cache key is different. No stale residue.

**Residual risk:** If the admin's own session was cached before the
assume-identity (60s TTL), and the admin exits within 60s, the cached
session is the admin's original session — which is correct. No residue.

### Validation summary

| Probe | Result | Fix applied |
|-------|--------|-------------|
| V1: Non-admin escalation | SAFE | DB role check is the first gate |
| V2: Admin→admin escalation | FIXED | Target must be non-admin (is_admin=false) |
| V3: Session confusion | MITIGATED | Headers, body marker, TTL, audit trail |
| V4: Audit tamper-resistance | ADEQUATE | REVOKE + role defaults + SECURITY DEFINER insert |
| V5: Token reuse | MITIGATED | 15-min TTL + stateless JWT |
| V6: RLS bypass | SAFE | resolveSqlSession uses target's UID |
| V7: Exit residue | SAFE | Different cache keys per UID |