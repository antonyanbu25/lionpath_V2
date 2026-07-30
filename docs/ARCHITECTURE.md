# Architecture — Core Domain vs Extension Lanes

High-level structure for Lionpath domain data. Detailed entity definitions: [ENTITY_CATALOG.md](./ENTITY_CATALOG.md).

---

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│  AUTH LAYER                                                 │
│  Firebase Google SSO · authIndex/{firebaseUid} → User.id    │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  CORE DOMAIN (operational — stable, change rarely)          │
│  User · Team · Account · Contact · Lifecycle                │
│  PrepBrief · PostCall · Task · LifecycleEvent               │
└───────────────────────────┬─────────────────────────────────┘
                            │ references by ID + domain events
┌───────────────────────────▼─────────────────────────────────┐
│  EXTENSION LANES (add when feature is scoped — not in MVP)  │
│  Derived insights · analytics rollups · integrations        │
└─────────────────────────────────────────────────────────────┘
```

---

## Core domain

**Purpose:** SE engagement tracking — prep, post-call, tasks, account timeline.

| Entity | Role |
|--------|------|
| User | Authenticated actor; `ownerId` on all owned resources |
| Team | RBAC boundary for manager visibility |
| Account | Shared company record (dedupe by slug) |
| Contact | Person at account |
| Lifecycle | Engagement aggregate (today) — one active SE × account thread; evolves toward **Deal** + optional SE lens — see [adr/003-account-deal-engagement.md](./adr/003-account-deal-engagement.md) |
| PrepBrief | Pre-call artifact |
| PostCall | Post-call artifact |
| Task | Action item from prep/post-call/manual |
| LifecycleEvent | Append-only audit timeline |

**Navigation backbone:** **Account** (contacts, deal team, merged timeline). **Lifecycle** still owns pipeline stage and artifacts in the MVP; **Deal/Opportunity** will sit between Account and artifacts for NB → expansion (ADR 003).

---

## Extension lanes (provisioned, not built)

Future features **reference core by ID** — they do not extend PostCall/PrepBrief with dozens of new fields.

| Future capability | Extension pattern |
|-------------------|-------------------|
| PM product insights from calls | New entity `ProductInsight { sourcePostCallId, ... }` |
| Cross-call theme rollups | Read from events or warehouse; not arrays on Lifecycle |
| CRM sync | Integration job reads/writes via `accountId`, `contactId` |
| Exec dashboards | Analytics projection over core entities |
| Multi-team SE | Join table `teamMembers` when requirement is real |
| Multi-tenant SaaS | Top-level `orgId` on User, Team, Lifecycle |

### Extension rules

1. **New audience** → new entity type + new role — not new columns on PostCall
2. **Derived data** → separate collection from source artifact
3. **Cross-entity aggregation** → async pipeline or warehouse — not unbounded Firestore arrays
4. **All FKs** → core entity IDs (`postCallId`, `lifecycleId`, `accountId`)

Example future shape (not implemented):

```typescript
// Extension — does not modify PostCall
interface ProductInsight {
  id: string;              // insight_*
  sourcePostCallId: string;
  accountId: string;
  status: "draft" | "published";
  category: string;
  summary: string;
  curatedBy: string;       // User.id
  createdAt: number;
}
```

---

## Worker / LLM boundary

The worker API is **stateless** for generation:

```
Browser → POST /api/generate-prep | /api/analyze-call → Gemini
Browser → domain store (Firestore) for persistence + lifecycle linking
```

Worker does not own domain entities. Optional logging may include `lifecycleId` for traceability.

---

## Storage modes

| Mode | Domain store | Auth |
|------|--------------|------|
| Dummy dev | localStorage shim | Email/password |
| Firebase prod | Firestore | Google SSO + authIndex |

Same entity shapes in both modes via [`web/domain/store.js`](../web/domain/store.js).

---

## Dual-write (migration period)

Legacy per-email history (`localStorage`, worker `/api/history`) runs parallel to domain store via [`dual-write.js`](../web/domain/dual-write.js).

Cutover checklist in [DOMAIN_MODEL.md](./DOMAIN_MODEL.md#migration-runbook).

---

## Documentation map

| Doc | Contents |
|-----|----------|
| [HLD.md](./HLD.md) | High-level design — context, layers, deploy, NFRs |
| [LLD.md](./LLD.md) | Low-level design — flows, modules, APIs per feature |
| [APP_AND_DOMAIN_CONTEXT.md](./APP_AND_DOMAIN_CONTEXT.md) | Product overview |
| [ENTITY_CATALOG.md](./ENTITY_CATALOG.md) | Entities vs value objects |
| [ID_STANDARDS.md](./ID_STANDARDS.md) | ID generation |
| [RELATIONSHIPS.md](./RELATIONSHIPS.md) | FKs and cardinalities |
| [RBAC.md](./RBAC.md) | Roles and permissions |
| [adr/001-user-identity.md](./adr/001-user-identity.md) | User.id vs Firebase uid |
| [adr/003-account-deal-engagement.md](./adr/003-account-deal-engagement.md) | Account + Deal + engagement (expansion path) |
| [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) | Firestore collections, indexes, migration |

---

## Success criteria

Architecture supports future scale when:

1. New features add **new entity types** referencing core IDs
2. Core PrepBrief/PostCall schema stays stable
3. `ownerId` is always internal `User.id`
4. **Account** is the customer backbone; **Deal** + engagement aggregate (Lifecycle today) own pursuit stage and artifacts per [adr/003](./adr/003-account-deal-engagement.md)
5. RBAC extends via new roles + resource types, not ad-hoc flags
