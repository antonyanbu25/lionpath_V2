# Analysis for GLM-5.2: Firestore privilege escalation via users/{id} self-update (P0)

## My investigation (Gideon) — verified against actual source, not prose

### The finding (from boss's security review)
Any signed-in SE can currently grant themselves admin by writing `{ role: "admin" }` to their own `users/{id}` doc directly via the client SDK (browser console). No code exploit needed — just a Firestore write the rules don't block. This defeats RBAC everywhere at once (accounts, deals, org structure, everything gated on role).

### Confirmed: NOT FIXED in current branch 2.1

The `match /users/{userId}` block in `/root/lionpath_V2/firestore.rules` (lines 207-223):

```
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
    currentUserId() == userId
    || isAdmin()
    || canManageOrgStructureUser(request.resource.data.teamId)
  );
  allow delete: if isAdmin();
}
```

The `allow update` clause's **self-update branch** (`currentUserId() == userId`) has **NO field-level restriction**. There is no `diff()` / `affectedKeys()` guard anywhere in the entire rules file (I grepped — confirmed none exists).

`isAdmin()` (line 33-35) reads `userDoc().role` live on every request:
```
function isAdmin() {
  return isSignedIn() && userRole() == 'admin';
}
```

So the exploit is real and live: any signed-in SE runs
`updateDoc(doc(db, 'users', myUserId), { role: 'admin' })` from the browser console and immediately gets `isAdmin() === true` on every other collection's rules.

### Existing escalation paths that must stay intact
- `isAdmin()` — admin can update any user doc (legit).
- `canManageOrgStructureUser(request.resource.data.teamId)` (line 82-86) — director/segment-leader org-structure management. This is the legit path for managers to change team/org/manager fields.

### Existing test infrastructure
- `rules-tests/` exists with `accounts.test.mjs`, `dealContacts.test.mjs`, `helpers.mjs`, `run-all.mjs`, `package.json`.
- Uses `@firebase/rules-unit-testing` + firebase emulators:exec.
- `helpers.mjs` has `seedPersona`, `authedContext`, `assertFails`, `assertSucceeds`.
- **NO test currently asserts self-role-escalation fails** — this is the regression test the boss wants added.

### Production deploy facts
- Production Firebase project: `se-singha-paathi` (from web/firebase-config.js).
- Rules deploy command (per docs/FIREBASE_SETUP.md): `firebase deploy --only firestore:rules,firestore:indexes` — manual, not in CI.
- Branch 2.1 pushes to remote `antony` = `antonyanbu25/lionpath_V2` (VPS deploy source). Do NOT push to `origin` for deploy.
- VPS deploy: `cd /opt/se-singha-paathi/deploy/vps && bash upgrade-now.sh` (fetches origin/2.1, resets, rebuilds worker + web). NOTE: upgrade-now.sh does NOT deploy firestore rules — rules deploy is a separate manual `firebase deploy` step.

## What I need from you (GLM-5.2)

Produce a complete, code-literal implementation plan that Codex (gpt-5.6-sol) can execute without asking questions. Cover:

1. **The exact firestore.rules change** to the `allow update` clause of `match /users/{userId}`:
   - Restrict the self-update branch (`currentUserId() == userId`) to non-privileged fields only: `displayName`, `jobTitle`, `avatarDataUrl` (and any other genuinely self-editable profile fields you find in the codebase).
   - Require `role`, `teamId`, `orgId`, `managerId`, `status`, `authUid`, `id` to stay unchanged unless the caller is already `isAdmin()` or passes `canManageOrgStructureUser(request.resource.data.teamId)`.
   - Use `request.resource.data.diff(resource.data).affectedKeys()` or explicit equality checks — pick the cleanest, most readable approach that's valid Firestore rules syntax.
   - Keep the `isAdmin()` and `canManageOrgStructureUser()` escalation paths fully intact.
   - Give the EXACT final `allow update` clause text.

2. **A regression test** in `rules-tests/` (e.g. `users.test.mjs`) that asserts:
   - A plain SE self-updating their own `role` to `admin` FAILS.
   - A plain SE self-updating their own `displayName` SUCCEEDS.
   - An admin updating an SE's role SUCCEEDS.
   - A manager/director via `canManageOrgStructureUser` path updating team/org SUCCEEDS (if feasible to seed).
   - Wire it into `run-all.mjs` so it runs with the existing tests.

3. **Deploy steps**: exact commands to deploy the rules to production (`firebase deploy --only firestore:rules` against project `se-singha-paathi`), and note whether the VPS upgrade-now.sh needs any change (it should NOT — rules deploy is separate).

4. **Files to change** and per-file summary.

Be concrete and code-literal. This goes straight to a coding agent.
