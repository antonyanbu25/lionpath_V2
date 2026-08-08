# Security P0 Fix — Firestore Privilege Escalation (users/{id} self-update)

**Date:** 2026-08-08 · **Branch:** 2.1 · **Commit:** 18c4a18 · **Status:** ✅ FIXED & DEPLOYED

---

## What was reported

The security review flagged a **P0**: any signed-in SE could self-promote to **admin** by
writing `{ role: 'admin' }` to their own `users/{id}` document directly via the client SDK
(browser console). The `allow update` self-update branch (`currentUserId() == userId`) in
`firestore.rules` had **no field-level guard**. Because every RBAC check (`isAdmin()`,
`isManager()`, etc.) reads `role` live off Firestore, this defeated access control
**everywhere at once** — accounts, deals, org structure, everything gated on role.

## What was fixed

- Added an `isSelfProfileUpdate(docUserId)` helper to `firestore.rules`.
- Self-update is now restricted to **non-privileged fields only**:
  `displayName`, `avatarDataUrl`, `email`, `updatedAt` (via `affectedKeys().hasOnly(...)`).
- Privileged fields — `role`, `teamId`, `orgId`, `managerId`, `status`, `authUid`, `id` —
  can **no longer** be changed via self-update.
- Legit escalation paths preserved **unchanged**: `isAdmin()` and
  `canManageOrgStructureUser()` still work for admins / directors / segment leaders.
- Added regression test `rules-tests/users.test.mjs`:
  - SE self-role-escalation → **FAILS** ✅
  - SE self-displayName update → **SUCCEEDS** ✅
  - Admin role update → **SUCCEEDS** ✅
  - Director org-structure update → **SUCCEEDS** ✅
- Deployed to production Firestore (`se-singha-paathi`):
  `firebase deploy --only firestore:rules` → **"released rules firestore.rules to cloud.firestore"**.

## Verification

- Regression test passes in the Firestore emulator.
- Rules compiled clean and released to production.
- Commit `18c4a18` on branch `2.1` (pushed to `antonyanbu25/lionpath_V2`).

## Result

The privilege-escalation hole is **closed in production**. A console write of
`{ role: 'admin' }` to one's own user doc now returns **permission-denied**, while
legit profile edits (name, avatar) and admin/org-structure management still work.
