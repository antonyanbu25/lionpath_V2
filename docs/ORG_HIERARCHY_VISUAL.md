# Org hierarchy — teams, people, and visibility (visual)

User-facing **team names** are region + motion (e.g. **International - NB**). Internal Firestore ids stay stable (`team_ajay`, `team_nikil`) — see `web/domain/constants.js` (`TEAM_DISPLAY_NAMES`).

## People tree + leaf teams

```mermaid
flowchart TB
  subgraph org["Org: CX Solution Engineering"]
    D["Director"]

    SM["Senior manager<br/>(e.g. New Business lead)"]

    D --> SM

    LM1["Line manager"]
    LM2["Line manager"]

    SM --> LM1
    SM --> LM2

    subgraph T1["Team: International - NB"]
      SE1["SE ICs"]
    end
    subgraph T2["Team: North America - NB"]
      SE2["SE ICs"]
    end

    LM1 -. manages .-> T1
    LM2 -. manages .-> T2
  end
```

## Visibility scope (target model)

Artifacts and lifecycles carry **`teamId`** (squad) and **`ownerId`** (SE).

```mermaid
flowchart LR
  subgraph se["SE"]
    A["Own work only<br/>ownerId = me"]
  end
  subgraph line["Line manager"]
    B["International - NB<br/>or North America - NB<br/>(teams I manage)"]
  end
  subgraph senior["Senior manager"]
    C["Both NB squads under<br/>my line managers"]
  end
  subgraph dir["Director"]
    D["All teams in org"]
  end
```

## Scope bubbles (ASCII)

```
                 ┌─────────────────────────────────────┐
                 │ DIRECTOR — all squads in org        │
                 │  ┌───────────────────────────────┐  │
                 │  │ SENIOR — subtree (NB example) │  │
                 │  │  ┌──────────────┐ ┌─────────┐ │  │
                 │  │  │ Intl - NB    │ │ NA - NB │ │  │
                 │  │  │  SE SE SE    │ │ SE SE   │ │  │
                 │  │  └──────────────┘ └─────────┘ │  │
                 │  └───────────────────────────────┘  │
                 └─────────────────────────────────────┘
```

## Freshdesk-style mapping

| Freshdesk | Lionpath |
|-----------|----------|
| Roles | `User.role` — se / manager / admin |
| Add to groups | `User.teamId`, `Team.managerId`, roster `memberIds` |
| Scope (tickets) | Read filter on `teamId` / `ownerId` (today: own, one team, or whole org; subtree for seniors is planned) |

## Related

- [RBAC.md](./RBAC.md)
- [adr/002-org-hierarchy.md](./adr/002-org-hierarchy.md)
