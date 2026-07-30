# RBAC — Roles, Permissions, and Org Model

Who can read and write domain data. Enforced in [`firestore.rules`](../firestore.rules) (primary) and [`web/domain/rbac.js`](../web/domain/rbac.js) (UI guards).

See [RELATIONSHIPS.md](./RELATIONSHIPS.md) for how `ownerId` and `teamId` are set on resources.

### Registered collections (spec ↔ Firestore)

| Spec name | Firestore collection | RBAC scope |
|-----------|---------------------|------------|
| `scorecards` | `scorecards` | owner / team / org rollup |
| `scorecard_lines` | `scorecardLines` | owner / team / org rollup |
| `score_overrides` | `scoreOverrides` | owner creates; manager reads team |
| `rubrics` | `rubrics` | org-wide read; admin write |
| `rubric_themes` | `rubricThemes` | org-wide read; admin write |
| `meddpicc_deltas` | `meddpiccDeltas` | owner / team |
| `technical_commit` | `technicalCommits` | owner / team / org pipeline review |
| `tc_deltas` | `tcDeltas` | owner / team |
| `deal_signals` | `dealSignals` | owner / team / org pipeline review |
| `product_gaps` | `productGaps` | owner / team / org-wide (pm) |
| `what_works` | `whatWorks` | owner / team / org-wide (pm) |
| `gap_clusters` | `gapClusters` | org-wide (pm) |
| `clustering_state` | `clusteringState` | org-wide (pm) — async pipeline cursor |
| `deal_summaries` | `dealSummaries` | owner / team / org pipeline review |
| `account_summaries` | `accountSummaries` | owner / team / org pipeline review |
| `price_book` | `priceBooks` | org-wide read; admin write |
| `addon_price_book` | `addonPriceBooks` | org-wide read; admin write |
| `assumptions_book` | `assumptionsBooks` | org-wide read; admin write |
| `arr_lines` | `arrLines` | owner / team / org pipeline review |
| `arr_overrides` | `arrOverrides` | owner creates; manager reads team |

---

## Roles

| Role | Description |
|------|-------------|
| `se` | Solution Engineer — IC who runs prep and post-call for own accounts |
| `manager` | People manager — read-only view of team SE activity |
| `pm` | Product manager — org-wide read of product gaps and what landed; curation publish (ADR-006) |
| `admin` | Platform admin — full access, user/team management |

Future roles (e.g. dedicated `enablement`) get a new role value + new resource types — not new fields on existing artifacts. Until `pm` users exist, **admin** operates the product-signal dashboard.

---

## Permission matrix

| Action | SE | Manager | PM | Admin |
|--------|-----|---------|-----|-------|
| Read own lifecycles + artifacts | Yes | — | — | Yes |
| Read team lifecycles + artifacts | — | Yes (same `teamId`) | — | Yes |
| Create/update own lifecycles + artifacts | Yes | — | — | Yes |
| Update lifecycle stage (own) | Yes | — | — | Yes |
| Edit another SE's artifacts | No | No | No | Yes |
| Delete artifacts | No | No | No | Yes |
| Manage teams | No | No | No | Yes |
| Manage users (role, team) | No | No | No | Yes |
| Read/write accounts + contacts | Yes (create/update) | Yes (read) | Yes (read) | Yes |
| Read rubrics + rubric themes | Yes | Yes | Yes | Yes |
| Manage rubrics + rubric themes | No | No | No | Yes |
| Read price book + add-on price book + assumptions book | Yes | Yes | Yes | Yes |
| Manage price book + add-on price book + assumptions book | No | No | No | Yes |
| Read own scorecards + lines | Yes | — | — | Yes |
| Read team scorecards + lines | — | Yes (same `teamId`) | — | Yes |
| Read org scorecard rollups | — | Yes (org director / senior leader) | — | Yes |
| Create/update own scorecards + lines | Yes (via worker pass) | — | — | Yes |
| Create score override (own call) | Yes | — | — | Yes |
| Read score overrides (team scope) | Own + team if manager | Yes | — | Yes |
| Read own call's productGaps + whatWorks | Yes | — | — | Yes |
| Read team productGaps + whatWorks | — | Yes (same `teamId`) | — | Yes |
| Read org-wide productGaps + whatWorks | — | — | **Yes** | Yes |
| Create draft productGaps + whatWorks (Pass 6) | Yes (via own calls) | — | — | Yes |
| Update curation fields on productGaps (status, gapType, clusterId) | No | No | **Yes** | Yes |
| Publish / dismiss / merge productGaps | No | No | **Yes** | Yes |
| Read org-wide gapClusters | — | — | **Yes** | Yes |
| Publish gapClusters | — | — | **Yes** | Yes |
| Run gap clustering job | — | — | **Yes** | Yes |
| Read own videoFacts + timelineSegments + timelineMarkers | Yes | — | — | Yes |
| Read team videoFacts + timelineSegments + timelineMarkers | — | Yes (same `teamId`) | — | Yes |
| Create/update own videoFacts + timelineSegments | Yes (via Pass 2) | — | — | Yes |
| Create/update own timelineMarkers | Yes (via Pass 3 derivation) | — | — | Yes |
| Delete own timelineSegments + timelineMarkers | Yes (re-run replaces derived rows) | — | — | Yes |
| Read own followUps + objections + momDrafts | Yes | — | — | Yes |
| Read team followUps + objections + momDrafts | — | Yes (same `teamId`) | — | Yes |
| Create/update own followUps + objections | Yes (via Pass 7) | — | — | Yes |
| Create/update own momDrafts (edit before send) | Yes | — | — | Yes |
| Mark MoM sent (`sentAt` / `sentBy`) | Yes (own call) | — | — | Yes |
| Auto-send MoM | **Never** | **Never** | **Never** | **Never** |
| Read own meddpiccDeltas | Yes | — | — | Yes |
| Read team meddpiccDeltas | — | Yes (same `teamId`) | — | Yes |
| Create/update own meddpiccDeltas | Yes (via Pass 4 qualify) | — | — | Yes |
| Read own technicalCommits + tcDeltas | Yes | — | — | Yes |
| Read team technicalCommits + tcDeltas | — | Yes (same `teamId`) | — | Yes |
| Read org technicalCommits (pipeline review) | — | Yes (org director / senior leader) | — | Yes |
| Create/update own technicalCommits + tcDeltas | Yes (via Pass 5 commit) | — | — | Yes |
| Read own dealSignals | Yes | — | — | Yes |
| Read team dealSignals | — | Yes (same `teamId`) | — | Yes |
| Read org dealSignals (pipeline review) | — | Yes (org director / senior leader) | — | Yes |
| Create/update own dealSignals | Yes (via Pass 8 traction rollup) | — | — | Yes |
| Read own dealSummaries + accountSummaries | Yes | — | — | Yes |
| Read team dealSummaries + accountSummaries | — | Yes (same `teamId`) | — | Yes |
| Read org dealSummaries + accountSummaries (pipeline review) | — | Yes (org director / senior leader) | — | Yes |
| Create/update own dealSummaries + accountSummaries | Yes (via Pass 9 summaries) | — | — | Yes |
| Read own arrLines | Yes | — | — | Yes |
| Read team arrLines | — | Yes (same `teamId`) | — | Yes |
| Read org arrLines (pipeline review) | — | Yes (org director / senior leader) | — | Yes |
| Create/update own arrLines | Yes (via post-call ARR compute) | — | — | Yes |
| Create own arrOverrides (append-only) | Yes (deal ARR module) | — | — | Yes |
| Read team arrOverrides | — | Yes (same `teamId`) | — | Yes |

**MoM principle (spec §9):** MoM is the only customer-facing output. Human edits before send. Never auto-send. `sentAt == null` (drafted-but-never-sent) is a first-class metric.

**Summaries principle (spec §5 Pass 9, §11.5–§11.6):** Generated deal and account summaries are evidence-grounded AI **writes** — they live in `dealSummaries` / `accountSummaries` and render alongside human CRM fields. They never overwrite Account or Deal metadata. Pre-call brief outputs are speculation-grounded **proposals** until confirmed on a call.

**Scorecard principle (spec §12.5):** QIP is SE-scoped on the call. SE reads own; manager reads team; leadership reads org rollups. Never blend weighted composites across call types.

**Product signal principle (spec §8, ADR-006):** Gaps and what landed live in `productGaps` and
`whatWorks` — not in `PostCall.analysis`. Pass 6 creates **draft** rows. `se_didnt_know` routes to
enablement (`gapType: enablement_gap`), not the PM backlog. `arrTouched` is frozen from
`PostCall.arrSnapshot` at analysis time. PM (`pm` role) reads org-wide and publishes; admin until
PM users are seeded.

**Technical commit principle (spec §2.2, §11.9):** TC current state is deal-scoped (`technicalCommits`); per-call movement is call-scoped (`tcDeltas`). `aiAttach` is a first-class metric — queryable for pipeline review and deal-list columns, not a boolean in metadata.

**Traction principle (spec §9):** Deal traction is hot / warm / cold — never a 0–100 score. Always with visible reasons and one recommended action. Lives in `dealSignals` (Pass 8 rollup), not on `PostCall.analysis.momentum` (per-call hero unchanged).

**Manager principle:** Managers **read** team data for coaching; they do not edit SE prep or post-call artifacts.

**Rubric principle:** Rubrics are org-wide reference config. All signed-in users read; only admins create or update (seed script uses admin credentials).

**Price book principle (spec §7.3):** Base and add-on prices plus ARR assumptions are org-wide
reference data. All signed-in users read for ARR display; only admins insert or close rows (never
overwrite — set `effectiveTo` on the old row, insert a successor). Deal-level overrides live on
the deal, not in these collections.

**ARR principle (spec §7.7, ADDON_ARR §4):** Derived estimate lives on `Deal` (`arrEstimatePoint`
and band columns). Line breakdown is queryable in `arrLines`. `arrActual` is Salesforce-only and
never overwritten by compute. `PostCall.arrSnapshot` freezes point value and lines at analysis
time. Account 500-session allowance is once per account — `Account.metadata.arrSessionAllowanceDealId`
records the consuming deal.

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
| Is PM? | `user.role === "pm" \|\| admin` |
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
| PM (product signal) | `user.role === "pm"` → org-wide read on `productGaps` + `whatWorks` |
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
