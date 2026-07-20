# Entity Catalog — First-Class Records vs Value Objects

This document locks which domain objects receive a **unique internal ID** and which data stays **embedded** inside a parent record. See also [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) and [RELATIONSHIPS.md](./RELATIONSHIPS.md).

---

## Decision rule

Give an object its **own unique ID** if **any** of these is true:

| Question | If yes → own ID |
|----------|-----------------|
| Will another record reference it by FK? | Yes |
| Will you query it directly? | Yes |
| Can it be created/updated/deleted independently? | Yes |
| Does RBAC apply to it separately? | Yes |
| Can there be many over time? | Yes |

If data is **only nested inside a parent** and never referenced elsewhere → **no global ID**.

---

## First-class entities (unique ID required)

| Entity | Firestore path | ID prefix | Natural key (lookup only) |
|--------|----------------|-----------|---------------------------|
| **User** | `users/{id}` | `usr_` | `email` (unique, normalized) |
| **Org** | `orgs/{id}` | `org_` | — |
| **Team** | `teams/{id}` | `team_` | — |
| **Account** | `accounts/{id}` | `acc_` | `slug` |
| **Contact** | `contacts/{id}` | `con_` | `(accountId, email)` |
| **Lifecycle** | `lifecycles/{id}` | `lc_` | `(ownerId, accountId, status=active)` |
| **PrepBrief** | `prepBriefs/{id}` | `prep_` | — |
| **PostCall** | `postCalls/{id}` | `call_` | `(ownerId, callIdentityKey)` |
| **Task** | `tasks/{id}` | `task_` | — |
| **LifecycleEvent** | `lifecycles/{lcId}/events/{id}` | `evt_` | — |
| **ContactEvent** | `contacts/{contactId}/events/{id}` | `cevt_` | — |

**Auth index (not a domain entity):** `authIndex/{firebaseUid}` → `{ userId: "usr_..." }` — maps Firebase auth to internal User.id for Firestore rules.

---

## Value objects (no global ID)

These are stored **inside** a parent document. They are never queried or secured independently.

| Data | Parent | Notes |
|------|--------|-------|
| Prep JSON (`prep`, `input`) | PrepBrief | Generated research brief; schema in `worker/src/schema.ts` |
| Post-call analysis JSON | PostCall | Summary, coach scores; schema in `worker/src/postcall-schema.ts` |
| Quality dimension scores | PostCall.analysis | Derived display data |
| Event `payload` | LifecycleEvent | Context for that event only |
| Form snapshots | PrepBrief.input | Input at generation time |
| Enums | Various | `role`, `stage`, `status`, `source` — not separate tables |

---

## Entity field summary

### User

```typescript
{
  id: string;              // usr_* — domain primary key; used as ownerId everywhere
  email: string;
  authUid: string | null;  // Firebase uid after SSO login
  displayName: string;
  role: "se" | "manager" | "admin";
  jobTitle?: string | null;   // optional display title (read-only in profile UI)
  teamId: string | null;
  orgId: string | null;
  managerId: string | null;
  status: "active" | "inactive";
  createdAt: number;
  updatedAt: number;
}
```

### Team

```typescript
{
  id: string;              // team_*
  name: string;
  orgId: string | null;
  managerId: string;       // User.id of team manager
  memberIds: string[];     // User.id of SE members
  createdAt: number;
  updatedAt: number;
}
```

### Org

```typescript
{
  id: string;              // org_*
  name: string;
  directorId: string;         // User.id of org director (role: manager)
  seniorLeaderIds: string[];  // User.id[] with org-wide read (senior managers)
  teamIds: string[];
  createdAt: number;
  updatedAt: number;
}
```

### Account

```typescript
{
  id: string;              // acc_*
  name: string;
  domain: string | null;
  slug: string;
  industry?: string;
  metadata?: {
    research?: object;
    firmographics?: object;
    meddpicc?: {
      metrics?: FieldSlot;
      economicBuyer?: FieldSlot;
      decisionCriteria?: FieldSlot;
      decisionProcess?: FieldSlot;
      paperProcess?: FieldSlot;
      identifyPain?: FieldSlot;
      champion?: FieldSlot;
      competition?: FieldSlot;
      lastUpdatedAt?: number;
      completionScore?: number;
    };
  };
  createdAt: number;
  updatedAt: number;
}
// FieldSlot = { value?, status: "unknown"|"partial"|"confirmed", source?, updatedAt?, contactId? }
```

### Contact

```typescript
{
  id: string;              // con_*
  accountId: string;
  email: string;
  name?: string;
  title?: string;
  role?: string;
  metadata?: {
    research?: object;
    disc?: { primary?, secondary?, confidence?, evidence?, assessedAt?, source? };
    influence?: { level?, decisionRole?, source?, updatedAt? };
  };
  createdAt: number;
  updatedAt: number;
}
```

### ContactEvent (append-only)

```typescript
{
  id: string;              // cevt_*
  contactId: string;
  type: "contact_created" | "field_updated" | "disc_updated" | "influence_updated" | "linked_from_prep" | "linked_from_postcall";
  actorId: string;
  timestamp: number;
  payload: object;         // { field?, fields?, source?, lifecycleId?, artifactId? }
}
```

### Lifecycle (aggregate root)

```typescript
{
  id: string;              // lc_*
  ownerId: string;         // User.id
  teamId: string;
  accountId: string;
  primaryContactId: string | null;
  stage: LifecycleStage;
  status: "active" | "paused" | "archived";
  title: string;
  prepCount: number;
  postCallCount: number;
  openTaskCount: number;
  latestQualityScore: number | null;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
}
```

### Artifacts (PrepBrief, PostCall, Task)

All artifacts carry:

- `id` — entity ID with prefix
- `lifecycleId` — parent lifecycle
- `ownerId`, `teamId`, `accountId` — denormalized for queries and RBAC

See [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) for full artifact shapes.

---

## ID generation

All entity IDs are created via the centralized module:

- Browser: [`web/domain/id.js`](../web/domain/id.js) — `newId("user")`, `newId("lifecycle")`, etc.
- Worker: [`worker/src/domain-model/id.ts`](../worker/src/domain-model/id.ts)

See [ID_STANDARDS.md](./ID_STANDARDS.md) for format and usage rules.

---

## What is explicitly not an entity (future)

These may become entities later; do **not** add IDs until the feature exists:

| Future concept | When to add |
|----------------|-------------|
| ProductInsight | PM curation workflow is scoped |
| teamMembers join | SE on multiple teams is required |
| InsightTheme / tags | Tagging feature is scoped |
| orgId | Multi-tenant SaaS is required |

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [ID_STANDARDS.md](./ID_STANDARDS.md) | Prefix format, generator API |
| [RELATIONSHIPS.md](./RELATIONSHIPS.md) | FK fields, cardinalities |
| [adr/001-user-identity.md](./adr/001-user-identity.md) | Internal User.id vs Firebase auth |
| [RBAC.md](./RBAC.md) | Role permissions |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Core vs extension boundaries |
