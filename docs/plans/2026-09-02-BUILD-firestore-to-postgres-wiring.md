# BUILD SPEC — Firestore → Postgres wiring

**Audience:** the engineer or LLM agent implementing this. **Companion to:** `2026-09-02-firestore-to-postgres-cutover-plan-v3.md` (the *why*). This document is the *how*.

**Date:** 2026-09-02 · **Scope:** code paths only. No historical data moves.

---

## 0. The one rule

> **Never ship a write path without its matching read path in the same PR.**

Every other instruction here is downstream of that. A write that lands in Postgres while its screen still reads Firestore produces a blank page — that is the failure this whole effort exists to prevent. If you can only do one half, do neither and say so.

---

## 1. Read this before you write any code

**The read layer is ~80% built. Most "missing" reads already exist.** I verified this by reading `read-repository.ts` end to end. If you treat the method-name diff as a to-do list you will write ~30 redundant SQL queries and fork the read model.

Three ways an apparently-missing read already works:

| Pattern | Example | What to do |
|---|---|---|
| Served by a **bulk detail** call | `listVideoFactsByCall`, `listTimelineSegmentsByCall`, `listObjectionsByCall`, `listFollowUpsByCall`, `listMomDraftsByCall`, `listMeddpiccDeltasByCall`, `listTcDeltasByCall`, `listDealSignalsByCall`, `listArrLinesByCall` — **all 9 are already projected** by `getPostCallDetail` ([`read-repository.ts:626`](../../worker/src/data/persistence/read-repository.ts:626)) via `arrayFromDetail(detail, key)` | Point the browser at `getPostCallDetail`, or add a thin wrapper that delegates to it. **Do not write new SQL.** |
| Exists but is **`private`** | `listScorecardsByPostCall` (`:655`), `listProductSignalsByDeal` (`:671`) | Make public, add to `PersistenceReadPort` in `types.ts:166`, expose a route. No new query. |
| Dead browser-side helper | several `list*By{Owner,Team,Org}` variants | Confirm no caller, then delete. Check with `grep -rn "methodName" web/ --include=*.js`. |

**Mandatory first step for every work order below:** run this and read the result before writing anything.

```bash
# Does a Postgres read already exist, public or private?
grep -n "<methodName>\|<entity>" worker/src/data/persistence/read-repository.ts

# Is it on the port contract?
grep -n "<methodName>" worker/src/data/persistence/types.ts

# Does the browser actually call it?
grep -rn "<methodName>" web/ --include=*.js
```

### The only genuine read stubs `[VERIFIED]`

Four, total. Everything else either exists or is dead:

| Stub | Location | Returns |
|---|---|---|
| `listLifecycleEvents` | `read-repository.ts:489` | `[]` unconditionally |
| `getDealDetail.technicalCommit` | `read-repository.ts:473` | `null` |
| `getDealDetail.arrLines` | `read-repository.ts:475` | `[]` |
| `getDealDetail.whatWorks` | `read-repository.ts:477` | `[]` |

### Two corrections to plan v3

1. **ARR needs no new table.** `arrLines` and `arrOverrides` are allowed keys in the `post_call.detail` v1 shape ([`shapes.ts:29`](../../worker/src/data/persistence/shapes.ts:29)) and `getPostCallDetail` already reads them. v3's open question Q2 is answered: ARR lives in `post_call.detail` JSONB. Only `getDealDetail.arrLines` is stubbed.
2. **`whatWorks` will be rejected by the validator.** It is **not** in the `post_call.detail` v1 allowed-key set. Writing it requires a shape version bump (§3.6). Do not add it to the v1 set in place — the header comment at `shapes.ts:10` forbids widening a shipped version.

---

## 2. Architecture — the layers a change must cross

**Write path** (browser → Postgres):

```
web/domain/store.js         createSplitStore picks read/write store per mode
  └─ api-store.js           POST /api/domain-write { method, args }
       └─ routes.ts:1642     handleDomainWrite
            ├─ :1695         trySqlDomainWrite  ← ADD YOUR CASE HERE
            │    ├─ :1702    gate: PERSISTENCE_MODE must be dual|sql
            │    ├─ :1705    gate: resolveSqlSession(uid) must be non-null
            │    └─ :1734    withSessionContext(session, …)  ← RLS + transaction
            │         └─ port.upsertX(client, row)   persistence/postgres-repository.ts
            │              └─ resolveInternalId(client, "app_user", publicId)  id_registry
            └─ :1667         applyDomainWrite  ← legacy Firestore fallback
```

**Read path** (browser → Postgres):

```
web/domain/api-store.js     GET /api/…
  └─ routes/domain-reads.ts  authContext() → pgReadRepositoryFor(ctx, env)
       └─ :69                resolveSqlSession — null ⇒ silently falls back to Firestore
            └─ read-repository.ts  PostgresReadRepository  ← ADD YOUR METHOD HERE
                 └─ types.ts:166   PersistenceReadPort  ← AND DECLARE IT HERE
```

**Two silent-fallback gates to remember.** Both return Firestore instead of erroring:

- `trySqlDomainWrite` returns `{handled:false}` when mode is `firestore`, when the session is null, when app-layer authz fails (`:1729`), or **when JSONB shape validation throws** (`:1874`, `:1934`).
- `pgReadRepositoryFor` returns `null` when the session is null → the route uses the Firestore repository.

When debugging "my write went nowhere", check these four gates before suspecting SQL.

---

## 3. Recipes

Copy these patterns. They are taken from working code in this repo — match the surrounding style, do not invent a new one.

### 3.1 Add a SQL write case

**Where:** the `switch (method)` inside `trySqlDomainWrite`, [`routes.ts:1735`](../../worker/src/routes.ts:1735). Insert alphabetically near related cases.

```ts
case "createTask": {
  const id = stringField(doc.id);
  const ownerId = stringField(doc.ownerId);
  if (!id || !ownerId) return { handled: false as const };
  await port.upsertTask(client, {
    publicId: id,
    dealPublicId: nullableString(doc.dealId),
    ownerPublicId: ownerId,
    title: stringField(doc.title) || "Untitled task",
    status: nullableString(doc.status) ?? "open",
    dueDate: toIso(doc.dueDate ?? doc.due),
    // Value mapping, not a rename — see §4.3.
    source: taskSource(doc.source),
    taskKey: nullableString(doc.sourceKey),
  });
  return { handled: true as const, result: doc };
}
```

Rules:

- Return `{handled:false}` — never throw — when a required field is missing. That preserves the Firestore fallback.
- Legacy update signatures are `(id, patch)`, so read `args[0]`/`args[1]`, not `doc`. See `updateAccount` at `:1750`.
- Use the existing helpers: `stringField`, `nullableString`, `toIso`.
- Everything inside the `switch` already runs in one `withSessionContext` transaction. Do not open another.

### 3.2 Add a repository write method

**Where:** `postgres-repository.ts`, plus the `PersistencePort` interface at `types.ts:199`, plus a mirrored method in `dual-write-repository.ts` (which delegates to `pg` then enqueues an outbox row — keep it even though we are targeting `sql` mode, so `dual` still works as a smoke stage).

Model on `upsertProductSignal` ([`postgres-repository.ts:455`](../../worker/src/data/persistence/postgres-repository.ts:455)):

```ts
async upsertTask(client: PgClient, row: TaskRow): Promise<number> {
  const ownerId = await resolveInternalId(client, "app_user", row.ownerPublicId);
  const dealId = row.dealPublicId
    ? await resolveInternalId(client, "deal", row.dealPublicId)
    : null;
  return upsertReturningId(
    client,
    "task",          // id_registry entity_type
    "task",          // table
    `INSERT INTO task (public_id, deal_id, owner_user_id, title, status, due_date, source, task_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (public_id) DO UPDATE SET
       title = EXCLUDED.title, status = EXCLUDED.status,
       due_date = EXCLUDED.due_date, updated_at = now()
     RETURNING id`,
    [row.publicId, dealId, ownerId, row.title, row.status, row.dueDate, row.source, row.taskKey],
    row.publicId,
  );
}
```

Rules:

- **Always** resolve FKs with `resolveInternalId` — never guess or pass a `public_id` into a `bigint` column. It throws 409 on a miss by design ([`id-registry.ts:25`](../../worker/src/data/persistence/id-registry.ts:25)).
- **Always** use `upsertReturningId` so the `id_registry` mapping is written in the same transaction.
- `task` requires `task_key` whenever `source='ai_generated'` (`chk_task_ai_key`, `02_phase2_activities.sql:144`). Enforce in code or the insert aborts the transaction.
- `entity_type` must be one of the union in `id-registry.ts:10`. **`task` is not currently in that union — add it.**

### 3.3 Write into a JSONB detail field (the hard one)

Applies to: `upsertVideoFacts`, `upsertTimelineSegment`, `upsertTimelineMarker`, `upsertFollowUp`, `upsertObjection`, `upsertMomDraft`, `upsertMeddpiccDelta`, `upsertDealSignal`, `upsertArrLine`, `upsertArrOverride`, `upsertWhatWorks`, and the two `delete*` variants.

**Do not create tables for these.** They are array fields inside `post_call.detail`. Ten new tables would fork the schema — this is anti-pattern #2 in plan v3.

Element-level upsert requires read-modify-write. Do it inside the transaction with a row lock:

```ts
/**
 * Upsert one element into a post_call.detail array field, keyed by `id`.
 * Locks the row so two concurrent AI passes cannot clobber each other's array.
 */
async upsertDetailArrayItem(
  client: PgClient,
  postCallPublicId: string,
  key: DetailArrayKey,      // union type — must be an allowed shape key
  item: Record<string, unknown>,
  cap: number,              // per-field cap from the spec's detail shape table
): Promise<void> {
  const res = await client.query(
    `SELECT detail, detail_shape_version FROM post_call
     WHERE public_id = $1 FOR UPDATE`,
    [postCallPublicId],
  );
  if (!res.rows[0]) {
    throw Object.assign(new Error(`post_call ${postCallPublicId} not found`), { status: 404 });
  }
  const detail = (res.rows[0].detail as Record<string, unknown>) ?? {};
  const list = Array.isArray(detail[key]) ? [...(detail[key] as Record<string, unknown>[])] : [];

  const idx = item.id ? list.findIndex((x) => x?.id === item.id) : -1;
  if (idx >= 0) list[idx] = { ...list[idx], ...item };
  else list.push(item);

  // Caps are contractual (spec detail shape table). Drop oldest, keep newest.
  const capped = list.length > cap ? list.slice(list.length - cap) : list;

  const next = { ...detail, [key]: capped };
  // Validate BEFORE writing — an unknown key must fail here, loudly, not drift.
  const version = validateJsonbShape("post_call.detail", next);

  await client.query(
    `UPDATE post_call
     SET detail = $2::jsonb, detail_shape_version = $3, updated_at = now()
     WHERE public_id = $1`,
    [postCallPublicId, JSON.stringify(next), version],
  );
}
```

Caps from the spec's `post_call.detail` shape table: `videoFacts` 5, `timelineSegments` 200, `timelineMarkers` 200, `tcDeltas` 50, `meddpiccDeltas` 50, `objections` 100, `followUps` 100, `momDrafts` 5, `dealSignals` 5, `productGaps` 100, `whatWorks` 100.

`deal.tc_detail` (for `upsertTechnicalCommit`, `upsertTcDelta`) uses the same pattern against `deal`, but note `tc_detail` is **not** in the `JsonbShape` union in `shapes.ts:14` — either add it with its own key set, or document explicitly why it is unvalidated. Do not silently skip validation.

**Deletes** (`deleteTimelineSegmentsByVideoFactsId`, `deleteTranscriptTimelineByCall`) become array filters through the same lock-modify-write path.

### 3.4 Expose an existing private read

```ts
// 1. read-repository.ts — drop `private`
async listScorecardsByPostCall(postCallId: string): Promise<DomainReadDoc[]> { … }

// 2. types.ts:166 — add to the port contract
listScorecardsByPostCall(postCallId: string): Promise<DomainReadDoc[]>;

// 3. routes/domain-reads.ts — add a route, following handleCallGetById at :98
const repo = await pgReadRepositoryFor(ctx, env);
const rows = repo ? await repo.listScorecardsByPostCall(id) : await legacyFirestoreFn(id, fsEnv(env));
```

Keep the `repo ? … : legacyFirestoreFn(…)` ternary. It is the established idiom in `domain-reads.ts` and it is what keeps `firestore` mode working during the transition.

### 3.5 Add a new Postgres read

Only after §1's audit proves none exists. Model on `listAccountsInContext` (`:274`):

```ts
async listContactsByDeal(dealId: string): Promise<DomainReadDoc[]> {
  if (!dealId) return [];
  return this.read(async (client) => {
    const res = await client.query(
      `SELECT c.*, acc.public_id AS account_public_id, dc.role AS deal_role, dc.is_primary
       FROM deal_contact dc
       JOIN contact c ON c.id = dc.contact_id
       JOIN account acc ON acc.id = c.account_id
       JOIN deal d ON d.id = dc.deal_id
       WHERE d.public_id = $1 AND c.deleted_at IS NULL
       ORDER BY dc.is_primary DESC, c.name`,
      [dealId],
    );
    return (res.rows as Row[]).map(contactDoc);
  });
}
```

Rules:

- Wrap in `this.read(…)` so the RLS session context is applied. A bare `pool.query` bypasses scoping and will return wrong rows.
- Return `[]` / `null` early on empty input — the file does this consistently.
- Map rows through an existing `*Doc` mapper (`accountDoc`, `contactDoc`, `dealDoc`, `postCallDoc`, `taskDoc`, `scorecardDoc`). Extend a mapper rather than inlining a new object shape; the browser depends on these camelCase keys.
- Filter `deleted_at IS NULL` — soft deletes are the convention.

### 3.6 Bump a JSONB shape version

Required for `whatWorks` (§1). Never widen a shipped version in place.

1. Add version `"2"` to the relevant `SHAPES` entry in `shapes.ts:17`, copying v1's set and adding the new keys.
2. Set `CURRENT_SHAPE_VERSION["post_call.detail"] = "2"` (`:65`).
3. Confirm readers tolerate both versions — `arrayFromDetail` is version-agnostic, so reads are safe.
4. Add a migration note; the `*_shape_version` columns come from `janus/schema/10_shape_version.sql`.

### 3.7 Reference-data seed migration

New file `janus/schema/21_reference_seed.sql`, then register it in the phase list in `worker/scripts/apply-janus-schema.mjs` (see `:29`).

```sql
-- Reference data required before any app write. Idempotent.
-- Previously seeded ONLY by migrate-firestore-to-sql.mjs, which is not run
-- in the code-only cutover — leaving app_role empty, which makes user_role
-- inserts impossible and forces is_admin to false for everyone.
INSERT INTO app_role (id, name, description, role_type) VALUES
  ('admin',   'admin',   'Workspace administrator', 'permission'),
  ('manager', 'manager', 'Front-line manager',      'job_function'),
  ('se',      'se',      'Solutions engineer',      'job_function'),
  ('pm',      'pm',      'Product manager',         'job_function')
ON CONFLICT (id) DO NOTHING;

INSERT INTO rubric_theme (id, name, display_order) VALUES ('default', 'Default', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO rubric (id, rubric_theme_id, name, version, effective_from) VALUES
  ('default', 'default', 'Default discovery rubric', '1', CURRENT_DATE)
ON CONFLICT (id) DO NOTHING;

-- AI pipeline sentinel (spec prerequisites §Seed sentinel).
INSERT INTO app_user (public_id, email, display_name, job_level, status, sync_state, org_unit_id)
VALUES ('usr_janus_ai', 'ai@janus.internal', 'Janus AI', 'IC', 'active', 'synced', NULL)
ON CONFLICT (public_id) DO NOTHING;
```

### 3.8 Identity provisioning at login

**Where:** call from the authenticated request path, after `requireUser` succeeds and `resolveSqlSession` returns `null`. `worker/src/data/scope.ts` already loads the Firestore `users` doc, so provision there or immediately after.

```ts
/**
 * Provision a Postgres identity for a Firebase user on first authenticated
 * request. Runs as the system role: a user with no app_user row cannot pass
 * RLS to create their own.
 */
export async function ensureSqlIdentity(ctx: RequestContext, env: Env): Promise<void> {
  if (!postgresReady(env)) return;
  if (await resolveSqlSession(ctx.authUid, env)) return;   // already provisioned

  await withSystemContext(async (client) => {
    // Org first — app_user.org_unit_id references it.
    if (ctx.orgId) {
      await upsertOrgUnit(client, {
        id: ctx.orgId, name: ctx.orgName ?? ctx.orgId,
        parentId: null, unitType: "org", path: `/${ctx.orgId}/`,
      });
    }
    if (ctx.teamId) {
      await upsertOrgUnit(client, {
        id: ctx.teamId, name: ctx.teamName ?? ctx.teamId,
        parentId: ctx.orgId ?? null, unitType: "team",
        // MUST match the backfill's format exactly — manager RLS is prefix-based.
        path: ctx.orgId ? `/${ctx.orgId}/${ctx.teamId}/` : `/${ctx.teamId}/`,
      });
    }
    const userId = await upsertAppUser(client, {
      publicId: ctx.userId,
      email: ctx.email,
      displayName: ctx.displayName ?? null,
      jobLevel: ctx.role === "manager" ? "manager" : "IC",
      orgUnitId: ctx.teamId ?? ctx.orgId ?? null,
      authUid: ctx.authUid,
    });

    // NEVER auto-grant admin: is_admin bypasses RLS, so deriving it from a
    // Firestore string would be a privilege-escalation path. Admin is a
    // deliberate, audited grant.
    const roleId = ctx.role === "manager" ? "manager" : "se";
    await client.query(
      `INSERT INTO user_role (user_id, role_id, valid_from)
       SELECT $1, $2, now()
       WHERE NOT EXISTS (
         SELECT 1 FROM user_role WHERE user_id = $1 AND role_id = $2 AND valid_to IS NULL
       )`,
      [userId, roleId],
    );
  }, env);

  invalidateSqlSession(ctx.authUid);   // 5s cache would otherwise serve the null
}
```

Rules:

- `upsertOrgUnit` takes `path` as a **caller-supplied argument** and nothing computes it. Getting it wrong is a silent visibility bug, not an error.
- `upsertAppUser` writes **no `user_role`** row — you must add it, or `is_admin` and every role-branching RLS policy misbehave.
- Call `invalidateSqlSession` at the end, and also after any role or status mutation elsewhere (`org-structure.ts` role edits).
- Provisioning must never fail the request. Wrap in try/catch, log, and let the Firestore fallback carry that request.

---

## 4. Work orders

Do them in this order. Each is one PR. Each must satisfy §5 before merge.

### WO-1 — Reference data seed  *(blocker, ~2h)*

Recipe 3.7. Nothing else works without it: `app_role` is empty, so `user_role` cannot be inserted and `is_admin` is permanently `false`.

**Gate:** on a fresh database, `SELECT count(*) FROM app_role` = 4 and `FROM rubric` = 1 after `apply-janus-schema.mjs`, with no backfill script run.

### WO-2 — Identity provisioning  *(blocker, ~1d)*

Recipe 3.8. Depends on WO-1 (the `user_role` insert needs `app_role`).

**Gate:** a never-seen user signs in; `app_user`, `user_identity`, `user_role`, and `org_unit` rows appear; `org_unit.path` is `/{orgId}/{teamId}/`; `resolveSqlSession` returns non-null. Verify by `SELECT`, not HTTP 200.

### WO-3 — Tasks, end to end  *(~1d)*

The canonical case: reads are done, writes are missing. `listTasks`/`listTasksByLifecycle` already query the real `task` table (`:590`, `:608`); `createTask`/`updateTask`/`deleteTask` are Firestore-only.

- Add `"task"` to the `EntityType` union, `id-registry.ts:10`
- `TaskRow` in `types.ts`; `upsertTask` per recipe 3.2; mirror in `dual-write-repository.ts`
- SQL cases for `createTask`, `updateTask`, `deleteTask` per recipe 3.1
- `source` value mapping (§4.3 below)

**Gate:** create a task in the UI → it appears in the task list → confirmed by `SELECT * FROM task`. This currently fails.

### WO-4 — Lifecycle events  *(~0.5d)*

`addLifecycleEvent` writes Postgres; `listLifecycleEvents` is a hardcoded `return []` (`:489`). Implement it against whatever `applyLifecycleEvent` ([`persistence/lifecycle-events.ts`](../../worker/src/data/persistence/lifecycle-events.ts)) actually writes — read that file first.

Also fix the split write path: the browser writes the `lifecycles/{id}/events` subcollection while the worker writes a top-level `lifecycleEvents` collection ([`routes.ts:1563`](../../worker/src/routes.ts:1563)).

**Gate:** add a lifecycle event → it renders on the timeline → confirmed by `SELECT`.

### WO-5 — Deal contacts  *(~0.5d)*

Three SQL writes exist (`createDealContact`, `setPrimaryDealContact`, `removeDealContact`); no Postgres read does. Add `listContactsByDeal` and `findDealContact` per recipe 3.5.

**Gate:** attach a contact to a deal → it shows on the deal → `SELECT * FROM deal_contact` confirms.

### WO-6 — Scoring  *(~0.5d)*

Pure exposure work. `upsertScorecard` ([`postgres-repository.ts:404`](../../worker/src/data/persistence/postgres-repository.ts:404)) and `listScorecardsByPostCall` (`:655`) both exist; neither is reachable. Add the SQL write case + expose the read per recipe 3.4. Depends on WO-1 (rubric FK).

**Gate:** a scored call shows its scorecard, read from `scorecard`/`scorecard_line`.

### WO-7 — Product signals  *(~0.5d)*

Same shape: `upsertProductSignal` (`:455`) and `listProductSignalsByDeal` (`:671`) exist and are unreachable. Add `listProductGapsByDeal` as a public wrapper. `gapClusters` → `signal_cluster` is separate and can follow.

**Gate:** a product gap surfaces on the deal from `product_signal`.

### WO-8 — Call detail JSONB writes  *(largest, ~3–5d)*

11 upserts + 2 deletes → `post_call.detail`, per recipe 3.3. **Reads are already done** by `getPostCallDetail` — your job is writes plus pointing the browser at the bulk read.

Sub-order: `videoFacts` → `timelineSegments`/`timelineMarkers` → `objections`/`followUps`/`momDrafts` → `meddpiccDeltas`/`dealSignals` → `arrLines`/`arrOverrides` → `whatWorks` (needs the shape bump, recipe 3.6).

**Gate per field:** write through the UI → read back through the UI → `SELECT detail->'<key>' FROM post_call WHERE public_id = …` shows it.

### WO-9 — Technical commit  *(~1d)*

`upsertTechnicalCommit`, `upsertTcDelta` → `deal.tc_detail`. Un-stub `getDealDetail.technicalCommit` (`:473`). Decide and document the `tc_detail` validation question in recipe 3.3.

### WO-10 — Remaining stubs and read models  *(~1d)*

Un-stub `getDealDetail.arrLines` (`:475`) and `.whatWorks` (`:477`). Re-point `getReadModel`/`getReadModels` at the v9 views (`v_team_metrics`, `v_org_metrics`, `v_deal_traction`, `v_account_rollup`, `v_se_launchpad` — `janus/schema/12_read_model_views.sql`); do not reimplement them in code.

### WO-11 — Dead code sweep  *(~0.5d)*

For each remaining unimplemented read, prove no caller (`grep -rn "<name>" web/ --include=*.js`) and delete. Candidates: `listPostCallsBy{Owner,Team,Org}`, `listCallSummariesBy{Account,Deal,Org,Owner,Team}`, `findAccountsByName`, `findWonNbDealInGrace`, `findActiveLifecycleByDeal`, `findLifecycleByDealAndOwner`, `listActiveLifecyclesForAccount`, `getPostCall`, `getCall`.

### WO-12 — Mode flip

Move browser reads off Firestore (`resolveReadMode`, [`web/domain/store.js:36`](../../web/domain/store.js:36), can still return `"firestore"`) **before** flipping. Then staging `dual` → staging `sql` → production.

**Gate:** with `PERSISTENCE_MODE=sql` and Firestore admin **unconfigured**, walk every screen. Anything still needing Firestore throws instead of silently degrading — that is the point. Zero fallback warnings in logs.

---

## 4.3 Value mappings (not renames)

| Entity | Firestore | Postgres | Rule |
|---|---|---|---|
| `task.source` | `"postcall"` \| `"prep"` \| `"manual"` | `"ai_generated"` \| `"manual"` | `postcall`/`prep` → `ai_generated`; `manual` → `manual`. `ai_generated` **requires** `task_key` (`chk_task_ai_key`). |
| `task.sourceKey` | `sourceKey` | `task_key` | Rename, but load-bearing: it is the AI dedup key in `idx_task_ai_dedup`. |
| `task.due` / `dueDate` | either | `due_date` (**date**, not timestamptz) | Truncate to date. |
| `deal.title`/`name` | `title` | `name` | Fall back `title || name || "Untitled deal"`. |
| `deal.teamId`/`orgId` | either | `org_unit_id` | `teamId || orgId`, as `createDeal` does at `:1797`. |
| `account.health` | `health` | `health_data` | Rename. |
| `se_motion` | 4 possible locations | `se_motion` | Use `canonicalizeSeMotion` from `domain-model/se-motion`. Never hand-roll. |

---

## 5. Definition of done — every PR

1. **Write and read both on Postgres**, in this PR. §0.
2. **Verified by `SELECT`**, not HTTP 200. Repo rule: [`docs/SQL_AGENT_VERIFICATION.md`](../SQL_AGENT_VERIFICATION.md). RLS-protected tables need `SET app.is_admin='true';` first in a SQL console.
3. **Exercised through the real UI**, not curl alone. The browser store layer (`createSplitStore`) is part of the path and has its own routing.
4. **Fallback check:** grep the run's logs for `no SQL session` and `Firestore fallback`. Zero occurrences for the path you just wired.
5. **RLS check for anything owner- or org-scoped:** confirm as an SE (own rows only), a manager (own org subtree, nothing above), and an admin. A read that returns *more* than it should is a security bug, not a feature.
6. **Idempotency:** run the write twice with the same input. Second run must not duplicate. Every `upsert*` uses `ON CONFLICT` for this reason.
7. **Shape validation:** any JSONB write must pass `validateJsonbShape` and stamp the version column. If you needed a new key, you bumped the version (3.6) rather than widening v1.

---

## 6. Gotchas that will bite you

1. **`PERSISTENCE_MODE` is checked before the session** (`routes.ts:1701-1706`). In `firestore` mode none of your SQL code runs, no matter how correct it is. Local `.dev.vars` currently says `firestore`. Set it to `dual` or `sql` while developing, or you will debug the wrong layer for hours.
2. **`resolveSqlSession` caches for 5 seconds**, including negative results (`session-context.ts:38`). After provisioning or a role change, call `invalidateSqlSession(authUid)` or wait it out.
3. **Shape-validation failures fall back to Firestore silently** (`routes.ts:1874`, `:1934`) — a `console.warn`, then the legacy path. Your write appears to succeed. Watch for `shape validation failed`.
4. **`resolveInternalId` throws HTTP 409, not 500.** `id_registry: no mapping for X/Y` means the parent was never registered — usually a missing `upsertReturningId` call upstream.
5. **`ensureAccountProvisioned` / `ensureDealRef`** (`routes.ts`) auto-create accounts and deals from unresolvable ids. Convenient, but they manufacture shadow rows from typos. Do not extend this pattern to new entities.
6. **`this.read(…)` is mandatory** in the read repository. A bare `pool.query` skips the RLS session context and silently returns unscoped rows.
7. **The local database at `127.0.0.1:5432` is an embedded scratch Postgres**, not Cloud SQL — `worker/scripts/start-local-postgres.mjs`, data in `worker/.local-pg`. Never report its contents as production. Print the host before quoting any count.
8. **Tables in the local database are owned by `postgres`**, not `janus_owner`. Superusers bypass RLS entirely, so RLS tests that pass locally may prove nothing. Verify RLS using the `janus_app` URL (`DATABASE_URL`), not the migrations URL.
9. **`listLifecycleEvents` returning `[]` is a stub, not a bug in your code.** Same for three fields in `getDealDetail`. Check §1's table before debugging.
10. **`whatWorks` is not a valid `post_call.detail` v1 key.** It will throw `ShapeValidationError` → silent Firestore fallback. Bump the shape version first.

---

## 7. Quick reference — file map

| Concern | File |
|---|---|
| SQL write routing | `worker/src/routes.ts:1695` (`trySqlDomainWrite`) |
| Firestore write fallback | `worker/src/routes.ts` (`applyDomainWrite`, `UPSERT_COLLECTIONS:1499`) |
| Postgres writes | `worker/src/data/persistence/postgres-repository.ts` |
| Dual-write + outbox | `worker/src/data/persistence/dual-write-repository.ts` |
| Postgres reads | `worker/src/data/persistence/read-repository.ts` |
| Port contracts | `worker/src/data/persistence/types.ts:166` (read), `:199` (write) |
| Session / RLS context | `worker/src/data/persistence/session-context.ts` |
| public_id ↔ bigint | `worker/src/data/persistence/id-registry.ts` |
| JSONB shape contracts | `worker/src/data/persistence/shapes.ts` |
| Read routes | `worker/src/routes/domain-reads.ts` |
| Browser store routing | `web/domain/store.js`, `web/domain/api-store.js` |
| Schema DDL | `janus/schema/00`–`20`, applied by `worker/scripts/apply-janus-schema.mjs` |
| Read-model views | `janus/schema/12_read_model_views.sql` |
| Verification rules | `docs/SQL_AGENT_VERIFICATION.md` |
| Cutover stages | `docs/CUTOVER_SQL.md` |
