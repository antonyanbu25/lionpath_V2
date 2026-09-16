# ADR 002 — Org hierarchy (Director → Manager → SE)

| Status | Accepted |
|--------|----------|
| Date | 2026-07-19 |
| Context | Multi-level people hierarchy without a new `director` role |

---

## Context

MVP RBAC used a flat `Team` with one manager and SE members. `User.managerId` existed but was not used for visibility. We need:

- Multiple teams under one org lead (director)
- SE → manager → director reporting via `managerId`
- Directors see all teams in their org; team managers see one team only
- No new `director` role — directors remain `role: "manager"`

Firestore rules cannot traverse `managerId` graphs efficiently.

---

## Decision

1. Add **`Org`** entity: `{ id, name, directorId, seniorLeaderIds[], teamIds[], timestamps }`
2. Denormalize **`orgId`** on `User`, `Team`, `Lifecycle`, and all artifacts
3. **Director** = user where `user.id === org.directorId` (still `role: "manager"`)
4. **Senior managers** (org-wide leaders) = users listed in `org.seniorLeaderIds` (still `role: "manager"`)
5. **Read scope:**
   - SE: own `ownerId`
   - Team manager: `resource.teamId === user.teamId`
   - Org director **or senior manager**: `resource.orgId === user.orgId`
   - Admin: all

---

## Consequences

### Positive

- O(1) Firestore rule checks via `orgId` + org doc
- Team managers unchanged; directors and senior managers get org-wide coaching view
- Reporting chain preserved in `User.managerId`
- No new role value — senior managers stay `role: "manager"` with `seniorLeaderIds`

### Negative

- Must backfill `orgId` on existing documents
- New artifacts must set `orgId` at write time

---

## Related

- [RBAC.md](../RBAC.md)
- [RELATIONSHIPS.md](../RELATIONSHIPS.md)
- [adr/001-user-identity.md](./001-user-identity.md)
