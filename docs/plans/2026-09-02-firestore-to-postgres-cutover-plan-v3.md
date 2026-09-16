# Firestore → Postgres: read/write path cutover plan v3

**Status:** ready for review · **Date:** 2026-09-02
**Supersedes:** v2 (`2026-09-02-firestore-to-postgres-migration-plan-v2.md`) and the earlier LLM-authored plan.

---

## 0. Scope — read this first

**Historical data is explicitly out of scope.** No backfill, no export, no Firestore→Postgres data copy, no parity-of-old-rows harness. Postgres starts empty and the app accumulates new data.

**In scope:** every code path that currently reads or writes Firestore must read or write the correct Postgres table instead, and **reads and writes must agree**. If a write lands in Postgres while the screen still reads Firestore (or the reverse), the user sees an empty page. That asymmetry — not data loss — is the failure mode this plan exists to prevent.

**Target mode is `sql`, not `dual`.** Because Firestore is being abandoned rather than kept in sync, the `sync_outbox` projector is irrelevant. This removes the largest operational blocker in v2. Do not schedule the projector; do not run `dual` except as a brief smoke stage (§5.1).

### What changed because of this scope

| v2 said | Now |
|---|---|
| Backfill 42 collections; assemble JSONB from ~12 of them | **Dropped.** No data moves. |
| Schedule the outbox projector before anything else | **Dropped.** `sql` mode needs no projector. |
| `app_role`/`rubric` are seeded by the backfill script, so not a blocker | **Reactivated as a blocker.** The *only* thing that seeds them is the backfill script you are no longer running. §3.1 |
| Identity provisioning is one of several fixes | **Now the single hard blocker.** With no backfill, *zero* users have an `app_user` row. §3.2 |
| Timeline 4–6 weeks | Materially shorter, but gated on §4's matrix, which is larger than expected. |

**Evidence grading:** `[VERIFIED]` = I ran it or queried it, method stated. `[CODE]` = read at the cited `file:line`. `[UNVERIFIED]` = depends on unobserved production state. Do not promote `[UNVERIFIED]` to fact. The plan this replaces failed by asserting production row counts nobody had queried.

---

## 1. Executive summary

`[VERIFIED]` by diffing the browser store surface against the Postgres read repository and the SQL write switch:

- **38 of 59 browser read methods have no Postgres implementation.** They will return nothing, or fall back to Firestore, after cutover.
- **38 write methods have no SQL path** — 8 in the `applyDomainWrite` switch, 20 in `UPSERT_COLLECTIONS`, 10 in `DELETE_COLLECTIONS`. Only 12 entity writes have a SQL case.
- **Two entity groups are already broken in both directions**, today, in `dual` mode (§4.2). One of them is a hardcoded `return []`.
- **Whole feature areas are 100% Firestore** with no wiring at either end: call detail (video facts, timeline, objections, MoM drafts), technical commit, scoring, product signals, ARR.

The mapping itself is largely correct where it exists. The problem is coverage and symmetry, not modelling.

---

## 2. Method — how to reproduce this analysis

```bash
cd lionpath_V2

# SQL write cases (inside trySqlDomainWrite)
sed -n '/async function trySqlDomainWrite/,/^function toIso/p' worker/src/routes.ts | grep -oE 'case "[a-zA-Z]+"'

# Firestore-only write methods
sed -n '/async function applyDomainWrite/,/POST \/api\/domain-write/p' worker/src/routes.ts | grep -oE 'case "[a-zA-Z]+"'
grep -oE '(upsert|delete)[A-Za-z]+: *"' worker/src/routes.ts

# What Postgres can actually read
grep -nE '^\s+(async )?[a-z][A-Za-z0-9]*\(' worker/src/data/persistence/read-repository.ts

# What the browser asks for
grep -oE '^\s{2,6}(async )?[a-zA-Z][A-Za-z0-9]*\(' web/domain/api-store.js
```

---

## 3. The two blockers

### 3.1 Reference data has no seeder outside the backfill script `[VERIFIED]`

`app_role`, `rubric`, and `rubric_theme` are seeded **only** inside [`worker/scripts/migrate-firestore-to-sql.mjs:120-136`](../../worker/scripts/migrate-firestore-to-sql.mjs:120) — not in any `janus/schema/*.sql` DDL, and not in `apply-janus-schema.mjs`.

*Method:* queried the local Postgres after schema apply — `app_role=0, rubric=0`. Ran the backfill script; they became `app_role=4, rubric=1`.

Since you are not running the backfill, these stay empty. Consequences:

- `user_role` inserts are **impossible** — the FK to `app_role` has nothing to point at.
- `resolveSqlSession` derives `is_admin` from a join on `app_role` ([`session-context.ts:60`](../../worker/src/data/persistence/session-context.ts:60)), so **`is_admin` can only ever be `false`**. Every admin silently becomes a non-admin.
- Every `scorecard` insert fails the `rubric` FK.

**Fix (C1):** add a new idempotent migration `janus/schema/21_reference_seed.sql` containing the four `app_role` rows, `rubric_theme 'default'`, `rubric 'default'`, and the `usr_janus_ai` sentinel from the spec's prerequisites — all `ON CONFLICT DO NOTHING`. Add it to `apply-janus-schema.mjs`. Do not leave reference data owned by a script nobody runs.

### 3.2 No user will have a Postgres identity `[CODE]`

With no backfill, `app_user`/`user_identity`/`org_unit` are empty. `resolveSqlSession` is a pure `SELECT` that returns `null` on a miss and never inserts ([`session-context.ts:54`](../../worker/src/data/persistence/session-context.ts:54)). `trySqlDomainWrite` returns `{handled:false}` on a null session ([`routes.ts:1706`](../../worker/src/routes.ts:1706)).

So on day one of `sql` mode, **every request from every user misses**, and every write falls through to `applyDomainWrite` — which in `sql` mode is not guarded by the `firestoreAdminReady` check ([`routes.ts:1651`](../../worker/src/routes.ts:1651)) and will either write the abandoned Firestore or throw.

`upsertAppUser`/`upsertOrgUnit` exist ([`postgres-repository.ts:492`](../../worker/src/data/persistence/postgres-repository.ts:492)) and are called only by a test script.

**Fix (C2):** wire provisioning into the auth path, with all of:

- `app_user` + `user_identity` + **a `user_role` row**. `upsertAppUser` writes no role today. Default `se`. **Never auto-grant `admin`** — `is_admin` bypasses RLS, so making Firestore's `users.role` string the authority for it is a privilege-escalation path. Admin stays a deliberate, audited grant.
- `org_unit` with a deterministic `path` (`/{orgId}/{teamId}/`). `upsertOrgUnit` takes `path` as a **caller-supplied argument** and nothing computes it. Manager RLS is path-prefix based, so a wrong path is silently wrong visibility. The spec's "app-maintained + reconciliation job" for `org_unit.path` does not exist — write it.
- Run under `withSystemContext`, not the caller's session (a user with no row cannot pass RLS to create their own).
- Call `invalidateSqlSession(authUid)` after any role/status mutation — the 5s cache at `session-context.ts:38` otherwise serves stale authz.
- Source org/team/role from the server-read Firestore `users` doc via `resolveRequestContext` ([`scope.ts:63`](../../worker/src/data/scope.ts:63)), never from client-supplied fields.

> Until you decide where identity comes from once Firestore is gone, provisioning still reads the Firestore `users` doc. That is acceptable for cutover but is a residual dependency — track it.

---

## 4. The parity matrix — the core of this plan

### 4.1 Writes: what has a SQL path

`[VERIFIED]` **Has a SQL case (12):** `createAccount`, `updateAccount`, `createContact`, `updateContact`, `createDeal`, `updateDeal`, `createDealContact`, `setPrimaryDealContact`, `removeDealContact`, `addLifecycleEvent`, `createPrepBrief`, `upsertPostCallWithSummary`.

`[VERIFIED]` **Firestore-only writes (38):**

| Group | Methods | Postgres target |
|---|---|---|
| `applyDomainWrite` switch (8) | `createLifecycle`, `updateLifecycle`, `createTask`, `updateTask`, `addContactEvent`, `deleteScorecardLinesByScorecardId`, `deleteTimelineSegmentsByVideoFactsId`, `deleteTranscriptTimelineByCall` | `deal` (lifecycle folds in), `task`, `scorecard_line`, `post_call.detail` |
| Call detail (10) | `upsertVideoFacts`, `upsertTimelineSegment`, `upsertTimelineMarker`, `upsertFollowUp`, `upsertObjection`, `upsertMomDraft`, `upsertMeddpiccDelta`, `upsertDealSignal`, `upsertWhatWorks`, + deletes | **fields inside `post_call.detail` JSONB** — not tables |
| Technical commit (2) | `upsertTechnicalCommit`, `upsertTcDelta` | **fields inside `deal.tc_detail` JSONB** |
| Scoring (2) | `upsertScorecard`, `upsertScorecardLine` | `scorecard`, `scorecard_line` — **implementations exist and are unwired** (`postgres-repository.ts:404`) |
| Product signals (2) | `upsertProductGap`, `upsertGapCluster` | `product_signal` (impl exists, unwired, `:455`), `signal_cluster` |
| ARR / pricing (2) | `upsertArrLine`, `upsertArrOverride` | **no table exists in v9** — see Q2 |
| Other (2) | `upsertCallSummary`, `upsertClusteringState` | replaced by read-model views; no table |

The call-detail and technical-commit groups are the **structural** work: in Firestore these are separate top-level collections with their own upsert methods; in v9 they are fields inside a JSONB column. A write path for them means read-modify-write on `post_call.detail` / `deal.tc_detail` with `validateJsonbShape` and the spec's per-field caps (videoFacts ≤5, timelineSegments ≤200, objections ≤100, momDrafts ≤5, …), not a new table.

### 4.2 Already broken today — fix these first

`[VERIFIED]` Both write to Postgres and read from somewhere that will never show it.

**B1 — lifecycle events. Hardcoded stub.**
`addLifecycleEvent` has a SQL write case; the Postgres read is:

```js
async listLifecycleEvents(_lifecycleId: string): Promise<DomainReadDoc[]> {
  return [];
}
```

[`read-repository.ts:489`](../../worker/src/data/persistence/read-repository.ts:489). Events are persisted and **can never be displayed**. Independently, the browser writes to the `lifecycles/{id}/events` subcollection while the worker writes a top-level `lifecycleEvents` collection ([`routes.ts:1563`](../../worker/src/routes.ts:1563)) — two paths, two locations.

**B2 — deal contacts. Write-only.**
`createDealContact`, `setPrimaryDealContact`, `removeDealContact` all have SQL cases and write `deal_contact`. Neither `findDealContact` nor `listContactsByDeal` has a Postgres implementation. Written and never surfaced.

**B3 — tasks. The inverse.**
`listTasks` and `listTasksByLifecycle` query the real `task` table ([`read-repository.ts:590`](../../worker/src/data/persistence/read-repository.ts:590), `:608`). `createTask`/`updateTask`/`deleteTask` are **Firestore-only**. So the task list reads an empty Postgres table while tasks are written elsewhere — **tasks will always appear empty.** This is the cleanest illustration of the whole problem.

Note the mapping detail: Firestore `source` is `"postcall" | "prep" | "manual"`; the target enum is `"ai_generated" | "manual"`. This needs a **value mapping** (`postcall`/`prep` → `ai_generated`), plus `sourceKey` → `task_key`.

### 4.3 Reads with no Postgres implementation (38 of 59) `[VERIFIED]`

| Area | Missing reads | Disposition |
|---|---|---|
| Call detail | `listVideoFactsByCall`, `listTimelineSegmentsByCall`, `listTimelineMarkersByCall`, `listObjectionsByCall`, `listFollowUpsByCall`, `listMomDraftsByCall`, `listMeddpiccDeltasByCall`, `listDealSignalsByCall`, `listDealSignalsByDeal`, `listDealSignalsForDeals`, `listWhatWorksByDeal` | Read out of `post_call.detail` JSONB — one query, then project in code. Do **not** add tables. |
| Technical commit | `listTcDeltasByCall`, `listTechnicalCommitsByOrg` | Read out of `deal.tc_detail`. |
| Scoring | `listScorecardsByCall` | `scorecard` + `scorecard_line`. |
| Product signals | `listProductGapsByDeal` | `product_signal`. |
| Post-call | `getPostCall`, `getCall`, `listPostCallsByOwner`, `listPostCallsByTeam`, `listPostCallsByOrg` | Partly covered at route level by `getPostCallDetail` / `listCallSummariesForScope` / `listPostCallsInContext`. **Verify per route before writing new code** — some of these may be dead browser-side helpers. |
| Call summaries | `listCallSummariesByAccount/Deal/Org/Owner/Team` | `listCallSummariesForScope` exists; confirm the scope variants are reachable. |
| Deal/contact | `findDealContact`, `listContactsByDeal`, `findAccountsByName`, `findWonNbDealInGrace`, `findActiveLifecycleByDeal`, `findLifecycleByDealAndOwner`, `listActiveLifecyclesForAccount` | Straight SQL against `deal`/`contact`/`deal_contact`. |
| Read models | `getReadModel`, `getReadModels` | Replaced by `v_team_metrics` / `v_org_metrics` / `v_deal_traction` / `v_account_rollup` / `v_se_launchpad` (`janus/schema/12_read_model_views.sql`). Re-point, don't reimplement. |
| ARR | `listArrLinesByCall/ByDeal/ForDeals` | **No table.** Blocked on Q2. |
| Plumbing | `get`, `set`, `putDetail`, `invalidateDetail`, `warnDeprecatedReadPath` | Not entity reads; ignore. |

---

## 5. Plan

### Phase 1 — Unblock the session *(C1 + C2, ~2–3 days)*

Reference-data migration (§3.1) and identity provisioning (§3.2).

**Gate:** on a **fresh empty database**, a never-seen user signs in and `app_user` + `user_identity` + `user_role` + `org_unit` rows appear, with a `path` matching `/{orgId}/{teamId}/`. Then `resolveSqlSession` returns non-null for that user, and `is_admin` is correct for a seeded admin. Verify with a direct `SELECT`, not an HTTP 200 — repo rule, [`docs/SQL_AGENT_VERIFICATION.md`](../SQL_AGENT_VERIFICATION.md).

### Phase 2 — Fix the three live breaks *(B1–B3, ~2 days)*

Implement `listLifecycleEvents` for real; add Postgres reads for `findDealContact`/`listContactsByDeal`; add SQL write cases for `createTask`/`updateTask`/`deleteTask` with the `source` value mapping.

**Gate:** create a task in the UI, then see it in the task list. Add a lifecycle event, then see it on the timeline. Attach a contact to a deal, then see it on the deal. All three currently fail; all three must pass.

### Phase 3 — Close the parity matrix *(largest phase)*

Work §4.1 and §4.3 together, **one feature area at a time, write and read in the same PR.** Suggested order by user-visible value:

1. Scoring (`scorecard`, `scorecard_line`) — implementations already exist, just unwired
2. Product signals (`product_signal`, `signal_cluster`) — same
3. Call detail → `post_call.detail` JSONB (the big one; 10 writes + 11 reads)
4. Technical commit → `deal.tc_detail`
5. Read models → re-point at the v9 views
6. Remaining deal/contact finders

**Gate per area:** write through the real UI, read back through the real UI, and confirm the row with a direct `SELECT` (`SET app.is_admin='true';` first — these tables are RLS-protected). A feature area is not done until its read and write are both on Postgres in the same release.

### Phase 4 — Flip the mode

Staging → `dual` for a short smoke (it exercises the SQL path while leaving Firestore writable as a safety net), then staging → `sql`, then production. Move browser reads off Firestore (`resolveReadMode` in [`web/domain/store.js:36`](../../web/domain/store.js:36) can still return `"firestore"`) **before** flipping — otherwise writes go to Postgres and the UI reads a store nothing is updating.

**Gate:** with `PERSISTENCE_MODE=sql` and Firestore admin **unconfigured**, exercise every screen. Any code path that still needs Firestore will throw rather than silently degrade — that is the point. Zero fallbacks logged.

### Phase 5 — Cleanup

Delete `applyDomainWrite`'s Firestore branches, `UPSERT_COLLECTIONS`, `DELETE_COLLECTIONS`, `web/domain/firestore-store.js`, and the projector route. Fix the `activities` collection's missing `firestore.rules` entry **before** this if Firestore lingers at all (currently unguarded — security finding).

---

## 6. Open questions

| # | Question | Blocks |
|---|---|---|
| Q1 | Is the deployed worker in `firestore`, `dual`, or `sql` mode today, per environment? | Whether B1–B3 are already corrupting production. `resolvePersistencePort` returns `null` for `firestore` mode ([`dual-write-repository.ts:245`](../../worker/src/data/persistence/dual-write-repository.ts:245)), so in `firestore` mode none of the SQL path runs at all. |
| Q2 | ARR / pricing (`arrLines`, `arrOverrides`, `priceBooks`, `addonPriceBooks`, `assumptionsBooks`) — keep or drop? **No v9 table exists.** | Phase 3. Either the schema grows or the feature is retired. |
| Q3 | Are the lowercase `postcalls` and `preps` collections live, or dead twins of `postCalls`/`prepBriefs`? | Phase 5 cleanup scope. |
| Q4 | Is `web/domain/firestore-store.js` (direct browser→Firestore writes) enabled for any production user? | If yes, those writes bypass the worker entirely and no server-side change captures them. |
| Q5 | Where does identity come from after Firestore is gone? Provisioning currently reads the Firestore `users` doc. | Post-cutover. Not a phase-1 blocker. |
| Q6 | `score_override`: the dead builder in `domain-model/scorecard.ts`, or the `localStorage`+Freshdesk flow in `web/score-disputes.js`? | Whether `score_override` is in scope at all. |

---

## 7. Out of scope

- Any historical data movement. `worker/scripts/export-firestore.mjs` and `migration-preflight.mjs` exist and work, but are **not needed for this plan** — keep them for a future backfill if one is ever wanted.
- The `sync_outbox` projector and its scheduling.
- `notification`, `coaching_focus`, `coaching_reflection`, `coaching_recommendation` — green-field features with no Firestore source. `coaching_reflection` RLS must stay `se_user_id = current_user_id() OR is_admin()`; managers are deliberately excluded — do not loosen.
- `audit_log` writes (nothing writes it today; no `audit_action_enum` value fits impersonation).
- Integration tables (`integration_token`, `sync_job`, `sync_error`, `sync_conflict`, `webhook_event`) — the spec phases these behind Salesforce/ChurnZero.

---

## 8. Anti-patterns

1. **Never ship a write without its read in the same release.** That is the entire failure mode. A green write path plus a Firestore read equals a blank screen.
2. **Don't create tables for `post_call.detail` / `deal.tc_detail` sub-shapes.** They are JSONB fields by design. Ten new tables would be a schema fork.
3. **Don't trust HTTP 200.** Confirm with `SELECT`.
4. **Don't auto-grant `admin`** during login provisioning.
5. **Don't leave reference data to a script nobody runs.** §3.1.
6. **Don't assume a missing read method needs new code** — check whether the route already serves it via `getPostCallDetail` / `listCallSummariesForScope` / `*InContext`. §4.3 flags these.
7. **Don't let `ensureAccountProvisioned`/`ensureDealRef` ([`routes.ts`](../../worker/src/routes.ts)) substitute for a real write path.** They manufacture shadow accounts/deals from unresolvable ids.
8. **Don't cite a row count you didn't query,** and state the host you queried. The prior plan asserted production counts that matched no reachable database.
