# RBAC — Roles, Permissions, and Org Model

Who can read and write domain data. Enforced in [`firestore.rules`](../firestore.rules) (primary) and [`web/domain/rbac.js`](../web/domain/rbac.js) (UI guards).

See [RELATIONSHIPS.md](./RELATIONSHIPS.md) for how `ownerId` and `teamId` are set on resources.

---

## Roles

| Role | Description |
|------|-------------|
| `se` | Solution Engineer — IC who runs prep and post-call for own accounts |
| `manager` | People manager — read-only view of team SE activity |
| `admin` | Platform admin — full access, user/team management |

Future roles (e.g. `pm`) get a new role value + new resource types — not new fields on existing artifacts.

---

## Permission matrix

| Action | SE | Manager | Admin |
|--------|-----|---------|-------|
| Read own lifecycles + artifacts | Yes | — | Yes |
| Read team lifecycles + artifacts | — | Yes (same `teamId`) | Yes |
| Create/update own lifecycles + artifacts | Yes | — | Yes |
| Update lifecycle stage (own) | Yes | — | Yes |
| Edit another SE's artifacts | No | No | Yes |
| Delete artifacts | No | No | Yes |
| Manage teams | No | No | Yes |
| Manage users (role, team) | No | No | Yes |
| Read/write accounts + contacts | Yes (create/update) | Yes (read) | Yes |

**Manager principle:** Managers **read** team data for coaching; they do not edit SE prep or post-call artifacts.

---

## Resource context

RBAC checks use denormalized fields on each resource:

```javascript
can(user, "read", { ownerId, teamId, orgId })
```

| Check | Rule |
|-------|------|
| Is owner? | `user.id === ownerId` |
| Same team? | `user.teamId === resource.teamId` |
| Same org? | `user.orgId === resource.orgId` |
| Is manager? | `user.role === "manager" \|\| admin` |
| Is org leader? | `user.id === org.directorId` **or** `user.id in org.seniorLeaderIds` |

Session flag `isOrgDirector` is set for **any org leader** (director + senior managers) so the org dashboard UI works without a new role.

Implementation: [`worker/src/domain-model/permissions.ts`](../worker/src/domain-model/permissions.ts), [`web/domain/types.js`](../web/domain/types.js) `can()`.

---

## Firestore rules (summary)

After ADR 001, ownership uses internal user id via auth index:

```javascript
function currentUserId() {
  return get(.../authIndex/$(request.auth.uid)).data.userId;
}

function canReadTeamResource(ownerId, teamId) {
  return currentUserId() == ownerId
      || (isManager() && userTeamId() == teamId);
}
```

User profile read: `users/{userId}` where `userId == currentUserId()` or caller is admin.

---

## Org model

### Team (primary grouping)

```
Team
  orgId      → Org.id
  managerId  → User.id of team manager
  memberIds  → User.id[] of SE ICs
```

Each User has `teamId` → Team.id and `orgId` → Org.id. Team managers see **team-scoped** data; org leaders (director + senior managers) see **org-scoped** data.

### Org (multi-team hierarchy)

```
Org
  directorId       → User.id of org director (role: manager)
  seniorLeaderIds  → User.id[] of senior managers with org-wide read (role: manager)
  teamIds[]        → Team.id[] in this org
```

**Director** and **senior managers** are not separate roles — they are managers listed on the org document. Senior managers get the same org-wide read scope as the director via `seniorLeaderIds`.

| User | Read scope |
|------|------------|
| SE | own `ownerId` |
| Team manager | `resource.teamId === user.teamId` |
| Org director or senior manager | `resource.orgId === user.orgId` |
| Admin | all |

### Direct reporting line (optional complement)

```
User.managerId → User.id
```

Use for:

- "My direct reports" filter (subset of team)
- Org chart display
- Future escalation workflows

**Not required for MVP manager dashboard** — team-wide view is sufficient initially.

When both exist:

- `teamId` = RBAC boundary (who can see what)
- `managerId` = org structure (who reports to whom)

A manager may manage a team where `Team.managerId == their userId`. Keep these in sync via admin seed/update.

---

## Session and ownerId

Artifacts are created with:

```javascript
ownerId: session.userId   // internal User.id — NOT authUid
teamId: session.teamId
```

See [adr/001-user-identity.md](./adr/001-user-identity.md).

---

## Admin operations

| Operation | How |
|-----------|-----|
| Pre-seed users | CSV via [`seed-firestore-users.mjs`](../worker/scripts/seed-firestore-users.mjs) |
| Assign role/team | Admin updates `users/{id}` |
| Deactivate user | `status: "inactive"` — do not hard-delete (orphan risk) |
| Reassign lifecycles | Admin script — change `ownerId` (rare) |

---

## UI guards

Hide create/edit actions when `can(sessionUser, action, resource)` is false. Managers see read-only lifecycle and artifact views.

Session user object for RBAC:

```javascript
{ id: session.userId, role: session.role, teamId: session.teamId }
```

---

## Related docs

- [RELATIONSHIPS.md](./RELATIONSHIPS.md)
- [ENTITY_CATALOG.md](./ENTITY_CATALOG.md)
- [adr/001-user-identity.md](./adr/001-user-identity.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
