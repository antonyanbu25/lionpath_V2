# P0 Firestore Privilege Escalation Fix — Codex Implementation Spec

**Source analysis:** /root/lionpath_V2/docs/plans/2026-08-08-firestore-rules-p0-analysis-for-glm.md
**Rules file:** /root/lionpath_V2/firestore.rules (match /users/{userId}, lines 207-223)
**Production project:** se-singha-paathi

## Summary

Any signed-in SE can self-promote to admin by writing `{ role: 'admin' }` to their own
`users/{id}` doc via the client SDK. The `allow update` self-update branch
(`currentUserId() == userId`) has no field-level guard. This spec fixes that by restricting
self-updates to non-privileged fields only, preserving the `isAdmin()` and
`canManageOrgStructureUser()` escalation paths untouched.

---

## 1. THE RULES FIX

### 1a. Codebase investigation results — self-editable fields

The profile UI (`web/profile-settings.js`) and the profile service
(`web/domain/profile-service.js`) are the ONLY client paths that let a user edit
their own `users/{id}` document:

- `updateDisplayName(userId, displayName)` — writes `displayName` + `updatedAt`
- `updateProfilePicture(userId, avatarDataUrl)` — writes `avatarDataUrl` + `updatedAt`

Both go through `store.upsertUser(updated)` in `firestore-store.js` (line 211-215), which
calls `setDoc(doc(db, "users", user.id), user, { merge: true })`. The merge sends the
entire user object, but the only fields that actually CHANGE on either path are
`displayName` and `avatarDataUrl` plus the `updatedAt` timestamp.

The `upsertFirebaseUser` function in `web/domain/user-resolve.js` (line 193-241) also
writes the user's own doc on login. It sets `displayName`, `avatarDataUrl`, `role`,
`teamId`, `orgId`, `managerId`, `jobTitle`, `status`, `createdAt`, `updatedAt` — but on
the login path these are seeded-from-existing values (`user?.field` fallbacks), NOT
user-chosen edits. The rules `allow create` clause covers initial creation. For the
update-on-login scenario, the user doc already exists so `allow update` fires. The
fix must allow `displayName` and `avatarDataUrl` changes on self-update (the legit
profile-edit fields) but block `role`, `teamId`, `orgId`, `managerId`, `status`,
`authUid`, `id`.

**Decision:** The self-update-allowed fields are: `displayName`, `avatarDataUrl`,
`updatedAt`, and `email`.

Rationale for including `email`: The `upsertFirebaseUser` login re-write path
(`web/domain/user-resolve.js` line 219-235) writes the full user object via
`{ merge: true }`, including `email` from `fbUser.email`. If the Firebase Auth email
changed (e.g., casing normalization), `email` would appear in `affectedKeys()`.
`email` is non-privileged identity metadata (not an escalation vector), so allowing
it prevents breaking the login flow.

Rationale for `affectedKeys().hasOnly()` approach: `{ merge: true }` in Firestore
writes fields even if unchanged, but the rules engine compares
`request.resource.data` (post-write doc) vs `resource.data` (pre-write doc). If the
merge sets `role: "se"` and the doc already has `role: "se"`, then
`request.resource.data.role == resource.data.role` and `affectedKeys()` does NOT flag
it. So the `upsertFirebaseUser` login re-write path (which seeds `role`, `teamId`,
etc. from existing `user?.field` values) will NOT be blocked — those keys won't appear
in `affectedKeys()` unless they actually changed.

### 1b. Helper function to add (insert BEFORE the `match /users/{userId}` block)

Add this helper function after the existing `canManageOrgStructureUser` function
(after line 86, before `isPm` or wherever convenient in the functions section):

```
function isSelfProfileUpdate(docUserId) {
  return isSignedIn()
    && currentUserId() == docUserId
    && request.resource.data.diff(resource.data)
        .affectedKeys()
        .hasOnly(['displayName', 'avatarDataUrl', 'email', 'updatedAt']);
}
```

**IMPORTANT:** The path variable `userId` from `match /users/{userId}` is NOT accessible
inside functions declared at the parent `match /databases/{database}/documents` scope.
Firestore rules only make path variables visible within their own match block and nested
blocks. The existing codebase convention confirms this: `canManageOrgStructureUser(targetTeamId)`
takes its path-derived value as a parameter. So `isSelfProfileUpdate` must take `userId`
as a parameter (`docUserId`) and the caller passes it from the match block.

### 1c. The EXACT final `allow update` clause for `match /users/{userId}`

Replace the current `allow update` clause (lines 217-221):

```
      allow update: if isSignedIn() && (
        currentUserId() == userId
        || isAdmin()
        || canManageOrgStructureUser(request.resource.data.teamId)
      );
```

with:

```
      allow update: if isSignedIn() && (
        isSelfProfileUpdate(userId)
        || isAdmin()
        || canManageOrgStructureUser(request.resource.data.teamId)
      );
```

Note: `isSelfProfileUpdate(userId)` takes the path variable `userId` as a parameter and
checks `currentUserId() == docUserId` internally, replacing the bare self-update branch.
The `userId` variable is in scope inside the `match /users/{userId}` block and is passed
to the function.

### 1d. Full final match block (for reference)

```
    // --- Users (document id = internal User.id) ---
    match /users/{userId} {
      allow read: if isSignedIn() && (
        currentUserId() == userId
        || isAdmin()
        || (isManager() && sameTeam(resource.data.teamId))
        || (isManager() && isOrgLeader() && resource.data.orgId == userOrgId())
      );
      allow create: if isSignedIn()
        && request.resource.data.authUid == request.auth.uid
        && request.resource.data.id == userId;
      allow update: if isSignedIn() && (
        isSelfProfileUpdate(userId)
        || isAdmin()
        || canManageOrgStructureUser(request.resource.data.teamId)
      );
      allow delete: if isAdmin();
    }
```

### 1e. Where to place the `isSelfProfileUpdate(docUserId)` function

Insert it right after `canManageOrgStructureUser` (after line 86):

```
    function canManageOrgStructureUser(targetTeamId) {
      return isAdmin()
        || (isActualDirector() && sameOrg(userOrgId()))
        || (isManager() && leadsSegmentContainingTeam(targetTeamId));
    }

    /** Self-update limited to non-privileged profile fields only. */
    function isSelfProfileUpdate(docUserId) {
      return isSignedIn()
        && currentUserId() == docUserId
        && request.resource.data.diff(resource.data)
            .affectedKeys()
            .hasOnly(['displayName', 'avatarDataUrl', 'email', 'updatedAt']);
    }
```

---

## 2. REGRESSION TEST — rules-tests/users.test.mjs

Create the following file at `/root/lionpath_V2/rules-tests/users.test.mjs`:

```js
#!/usr/bin/env node
/** Firestore security rules tests — users/{userId} self-update privilege escalation. */

import { setupEnv, seedPersona, authedContext, assertFails, assertSucceeds } from "./helpers.mjs";

const ORG = "org_users";
const TEAM_A = "team_users_a";
const TEAM_B = "team_users_b";

const SE = {
  authUid: "auth_se_users",
  userId: "usr_se_users",
  email: "se.users@freshworks.com",
  role: "se",
  teamId: TEAM_A,
  orgId: ORG,
};

const ADMIN = {
  authUid: "auth_admin_users",
  userId: "usr_admin_users",
  email: "admin.users@freshworks.com",
  role: "admin",
  teamId: TEAM_A,
  orgId: ORG,
};

/** Director persona — isActualDirector() + leadsSegmentContainingTeam() path. */
const DIRECTOR = {
  authUid: "auth_director_users",
  userId: "usr_director_users",
  email: "director.users@freshworks.com",
  role: "manager",
  teamId: TEAM_B,
  orgId: ORG,
};

/** A target SE whose team is in the director's segment. */
const SE_TARGET = {
  authUid: "auth_se_target_users",
  userId: "usr_se_target_users",
  email: "se.target@freshworks.com",
  role: "se",
  teamId: TEAM_B,
  orgId: ORG,
};

export async function run() {
  const env = await setupEnv();
  await env.clearFirestore();

  // --- Seed personas ---

  await seedPersona(env, {
    ...SE,
    org: {
      id: ORG,
      name: "Users Org",
      directorId: DIRECTOR.userId,
      seniorLeaderIds: [],
      segments: [
        { id: "seg_1", name: "Seg 1", leaderId: DIRECTOR.userId, teamIds: [TEAM_B] },
      ],
      teamIds: [TEAM_A, TEAM_B],
    },
    team: {
      id: TEAM_A,
      name: "Team A",
      orgId: ORG,
      managerId: DIRECTOR.userId,
      memberIds: [SE.userId],
    },
  });

  await seedPersona(env, { ...ADMIN });
  await seedPersona(env, { ...DIRECTOR });

  await seedPersona(env, {
    ...SE_TARGET,
    team: {
      id: TEAM_B,
      name: "Team B",
      orgId: ORG,
      managerId: DIRECTOR.userId,
      memberIds: [SE_TARGET.userId],
    },
  });

  const seDb = authedContext(env, SE).firestore();
  const adminDb = authedContext(env, ADMIN).firestore();
  const directorDb = authedContext(env, DIRECTOR).firestore();

  // --- (a) P0 regression: plain SE self-promoting role to 'admin' MUST FAIL ---
  await assertFails(
    seDb.collection("users").doc(SE.userId).update({ role: "admin" }),
  );

  // --- (a.1) SE self-updating a privileged field (teamId) MUST FAIL ---
  await assertFails(
    seDb.collection("users").doc(SE.userId).update({ teamId: TEAM_B }),
  );

  // --- (a.2) SE self-updating multiple privileged fields MUST FAIL ---
  await assertFails(
    seDb.collection("users").doc(SE.userId).update({
      role: "admin",
      orgId: "org_other",
      managerId: "usr_someone_else",
    }),
  );

  // --- (b) SE self-updating own displayName MUST SUCCEED ---
  await assertSucceeds(
    seDb.collection("users").doc(SE.userId).update({ displayName: "Updated Name" }),
  );

  // --- (b.1) SE self-updating own avatarDataUrl MUST SUCCEED ---
  await assertSucceeds(
    seDb.collection("users").doc(SE.userId).update({
      avatarDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    }),
  );

  // --- (b.2) SE self-updating updatedAt MUST SUCCEED ---
  await assertSucceeds(
    seDb.collection("users").doc(SE.userId).update({ updatedAt: 9999 }),
  );

  // --- (c) Admin updating an SE's role MUST SUCCEED ---
  await assertSucceeds(
    adminDb.collection("users").doc(SE.userId).update({ role: "manager" }),
  );

  // Restore SE role for remaining tests
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("users").doc(SE.userId).update({ role: "se" });
  });

  // --- (d) Director via canManageOrgStructureUser updating SE_TARGET's team MUST SUCCEED ---
  // DIRECTOR is isActualDirector() (org.directorId == DIRECTOR.userId) and sameOrg().
  // canManageOrgStructureUser(SE_TARGET's teamId) returns true.
  // The update must include the target teamId in request.resource.data.teamId so the
  // canManageOrgStructureUser(request.resource.data.teamId) check passes.
  await assertSucceeds(
    directorDb.collection("users").doc(SE_TARGET.userId).update({
      teamId: TEAM_B,
      managerId: DIRECTOR.userId,
    }),
  );

  // --- (e) SE updating ANOTHER user's displayName MUST FAIL ---
  await assertFails(
    seDb.collection("users").doc(SE_TARGET.userId).update({ displayName: "Hacked" }),
  );

  // --- (f) Admin updating own profile displayName MUST SUCCEED (isAdmin path) ---
  await assertSucceeds(
    adminDb.collection("users").doc(ADMIN.userId).update({ displayName: "Admin Name" }),
  );

  // --- (g) Director changing SE_TARGET's role via canManageOrgStructureUser SUCCEEDS ---
  // canManageOrgStructureUser returns true for isActualDirector() && sameOrg().
  // This grants full update access (including role) — this is EXISTING behavior
  // that the fix preserves intact. Only the self-update branch is restricted.
  await assertSucceeds(
    directorDb.collection("users").doc(SE_TARGET.userId).update({ role: "admin" }),
  );

  await env.cleanup();
  console.log("users.test.mjs: ok");
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\\\/g, "/")}`) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

### 2b. Wire into run-all.mjs

Replace the `inner` command string in `/root/lionpath_V2/rules-tests/run-all.mjs`.

Current (lines 9-11):

```js
const inner = process.platform === "win32"
  ? "node accounts.test.mjs && node dealContacts.test.mjs"
  : "node accounts.test.mjs && node dealContacts.test.mjs";
```

Replace with:

```js
const inner = process.platform === "win32"
  ? "node accounts.test.mjs && node dealContacts.test.mjs && node users.test.mjs"
  : "node accounts.test.mjs && node dealContacts.test.mjs && node users.test.mjs";
```

---

## 3. DEPLOY STEPS

### 3a. Run the regression tests locally (before deploying)

```bash
cd /root/lionpath_V2/rules-tests
npm install   # first time only
npm test
# or: node run-all.mjs
```

All three test files (accounts, dealContacts, users) must pass.

### 3b. Deploy rules to production

```bash
cd /root/lionpath_V2
firebase deploy --only firestore:rules --project se-singha-paathi
```

This deploys `firestore.rules` to the production Firestore. The `--project` flag
targets the correct Firebase project explicitly.

### 3c. VPS upgrade-now.sh — NO CHANGE NEEDED

The VPS deploy script (`/opt/se-singha-paathi/deploy/vps/upgrade-now.sh`) fetches
the `2.1` branch from the `antony` remote, resets, and rebuilds the web/worker. It
does NOT deploy Firestore rules — rules deploy is a separate manual step (see 3b).

The rules fix requires:
1. Commit the `firestore.rules` change to branch `2.1` and push to remote `antony`.
2. Run `firebase deploy --only firestore:rules --project se-singha-paathi` manually.
3. (Optional) Run VPS `upgrade-now.sh` to deploy the web app — NOT required for the
   rules fix to take effect (rules are server-side, independent of web deploy). But
   commit the rules change first so the repo and production stay consistent.

### 3d. Commit and push

```bash
cd /root/lionpath_V2
git add firestore.rules rules-tests/users.test.mjs rules-tests/run-all.mjs
git commit -m "fix(P0): restrict users/{id} self-update to non-privileged fields

Prevents privilege escalation where any signed-in SE could write
{ role: 'admin' } to their own users doc. Self-update now limited to
displayName, avatarDataUrl, email, updatedAt via affectedKeys().hasOnly().
Admin and canManageOrgStructureUser escalation paths preserved unchanged.

Adds rules-tests/users.test.mjs regression test covering:
- SE self-role-escalation FAILS
- SE self-displayName update SUCCEEDS
- Admin role update SUCCEEDS
- Director org-structure update SUCCEEDS"

git push antony 2.1
```

---

## 4. FILES TO CHANGE

### File 1: /root/lionpath_V2/firestore.rules

**Change:** Add `isSelfProfileUpdate(docUserId)` helper function after `canManageOrgStructureUser`
(line 86), and replace the `allow update` clause in `match /users/{userId}` (lines 217-221)
to use `isSelfProfileUpdate(userId)` instead of bare `currentUserId() == userId`.

**Exact patch:**

Patch A — insert new function after line 86 (`canManageOrgStructureUser` closing brace):

old_string:
```
    function canManageOrgStructureUser(targetTeamId) {
      return isAdmin()
        || (isActualDirector() && sameOrg(userOrgId()))
        || (isManager() && leadsSegmentContainingTeam(targetTeamId));
    }

    function isPm() {
```

new_string:
```
    function canManageOrgStructureUser(targetTeamId) {
      return isAdmin()
        || (isActualDirector() && sameOrg(userOrgId()))
        || (isManager() && leadsSegmentContainingTeam(targetTeamId));
    }

    /** Self-update limited to non-privileged profile fields only. */
    function isSelfProfileUpdate(docUserId) {
      return isSignedIn()
        && currentUserId() == docUserId
        && request.resource.data.diff(resource.data)
            .affectedKeys()
            .hasOnly(['displayName', 'avatarDataUrl', 'email', 'updatedAt']);
    }

    function isPm() {
```

Patch B — replace the `allow update` clause:

old_string:
```
      allow update: if isSignedIn() && (
        currentUserId() == userId
        || isAdmin()
        || canManageOrgStructureUser(request.resource.data.teamId)
      );
```

new_string:
```
      allow update: if isSignedIn() && (
        isSelfProfileUpdate(userId)
        || isAdmin()
        || canManageOrgStructureUser(request.resource.data.teamId)
      );
```

### File 2: /root/lionpath_V2/rules-tests/users.test.mjs (NEW FILE)

**Change:** Create new test file with the full contents from section 2 above. Tests:
- (a) SE self-promoting role to 'admin' FAILS
- (a.1) SE self-updating teamId FAILS
- (a.2) SE self-updating multiple privileged fields FAILS
- (b) SE self-updating displayName SUCCEEDS
- (b.1) SE self-updating avatarDataUrl SUCCEEDS
- (b.2) SE self-updating updatedAt SUCCEEDS
- (c) Admin updating SE's role SUCCEEDS
- (d) Director via canManageOrgStructureUser updating SE_TARGET's team/manager SUCCEEDS
- (e) SE updating another user's displayName FAILS
- (f) Admin updating own displayName SUCCEEDS
- (g) Director changing SE_TARGET's role to admin SUCCEEDS (canManageOrgStructureUser path preserved — existing behavior, not a regression)

### File 3: /root/lionpath_V2/rules-tests/run-all.mjs

**Change:** Add `&& node users.test.mjs` to both the win32 and non-win32 `inner` command
strings. See section 2b above for exact old/new strings.

### Files NOT changed:

- `web/domain/profile-service.js` — no change needed. `updateDisplayName` and
  `updateProfilePicture` already only modify `displayName`/`avatarDataUrl`/`updatedAt`.
- `web/domain/user-resolve.js` — no change needed. `upsertFirebaseUser` writes the full
  user doc with `{ merge: true }`, but on the login re-write path the privileged fields
  are seeded from existing doc values (`user?.role`, `user?.teamId`, etc.), so they
  match the existing values and `affectedKeys()` will not flag them as changed.
- `web/domain/firestore-store.js` — no change needed. `upsertUser` uses `{ merge: true }`
  which is compatible with the new rules.
- VPS `upgrade-now.sh` — no change needed. Rules deploy is separate.

---

## 5. VERIFICATION CHECKLIST

After implementation, verify:

1. `cd /root/lionpath_V2/rules-tests && npm test` — all three test files pass.
2. The `isSelfProfileUpdate(docUserId)` function is placed in the functions section (between
   `canManageOrgStructureUser` and `isPm`).
3. The `allow update` clause in `match /users/{userId}` uses `isSelfProfileUpdate(userId)`
   (not the bare `currentUserId() == userId`).
4. The `allow read`, `allow create`, and `allow delete` clauses are unchanged.
5. `isAdmin()` and `canManageOrgStructureUser()` functions are unchanged.
6. `run-all.mjs` includes `users.test.mjs` in the command string.
7. Deploy: `firebase deploy --only firestore:rules --project se-singha-paathi`
