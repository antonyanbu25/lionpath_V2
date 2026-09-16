# Janus — Identity Field-by-Field Pass (Workstream 2)

> **Repo note (added when this document was landed in the repo).**
> Reproduced unchanged. The §6 draft migration has been landed as
> [`janus/schema/21_identity_relationships.sql`](../../janus/schema/21_identity_relationships.sql)
> with two changes made under decisions taken after this document was written: the avatar is a
> separate `app_user_avatar` table rather than a column on `app_user`, and `job_level` gains a
> derivation helper rather than relying on `upsertAppUser`'s `'IC'` default. §7's open question
> is now answered. See [BUILD_PLAN.md §2](./BUILD_PLAN.md#2-corrections-to-the-source-audits).

**Date:** 2026-09-03 · **Verified against:** the launch branch
**Status:** field inventory verified. Migration SQL below is a **draft — unapplied and untested.**
No database was contacted.

Scope: the identity workstream only — `org_unit`, `app_user`, `user_identity`, `user_role`,
`app_role`. The same pass is still owed for `call_participant` and the scoring tables.

---

## 1. `User` → `app_user` + `user_identity` + `user_role`

Firestore source: `web/domain/types.js:7` (unchanged on the branch).
SQL target: `janus/schema/00_phase0_infra_and_org.sql:109-171`.

| Firestore field | SQL destination | Transform | Notes |
|---|---|---|---|
| `id` | `app_user.public_id` | DIRECT | UNIQUE |
| `email` | `app_user.email` | DIRECT | `idx_app_user_email_active` is UNIQUE where `deleted_at IS NULL` |
| `authUid` | `user_identity.auth_uid` | **SEPARATE TABLE** | with `auth_provider='firebase'`; `uq_user_identity_provider_uid` UNIQUE |
| `displayName` | `app_user.display_name` | DIRECT | |
| `role` | `user_role` → `app_role` | **TEMPORAL** | see §4 — GIST exclusion constraint |
| `teamId` | `app_user.org_unit_id` | DIRECT | points at the **deepest** unit the person belongs to |
| `orgId` | — | **DERIVABLE** | from `org_unit.path`; no column needed |
| `managerId` | — | **MISSING** | → `app_user.manager_user_id` |
| `jobTitle` | `app_user.job_title` | DIRECT | free text |
| `status` | `app_user.status` | DIRECT | CHECK `('active','inactive')` matches `UserStatus` exactly |
| `avatarDataUrl` | — | **MISSING** | → decide: add a column or drop avatars |
| `createdAt` | `app_user.created_at` | TYPE-COERCE | epoch ms → `timestamptz` |
| `updatedAt` | `app_user.updated_at` | TYPE-COERCE | |

**SQL columns with no Firestore source:** `id` (identity), `external_ref` (CRM — deferred per
D21), `sync_state`, `last_synced_at`, `deleted_at`, and **`job_level`**.

**`job_level` is a data-quality problem.** It is `CHECK ('IC','manager','director','VP')` with
**no Firestore equivalent** — `jobTitle` is free text ("Senior Manager - Solution Engineering").
`upsertAppUser` defaults it to `'IC'` (`postgres-repository.ts:504`). So on the seed roster
**Vipin Thomas, a Senior Director, would be provisioned as `IC`.** It is derivable from `role`
or from `jobTitle`, and the reconcile must do so rather than accept the default.

---

## 2. `Team` → `org_unit` (`unit_type='team'`)

Firestore source: `types.js:8`.

| Firestore field | SQL destination | Notes |
|---|---|---|
| `id` | `org_unit.id` | |
| `name` | `org_unit.name` | |
| `orgId` | `org_unit.parent_id` | ⚠️ **not a field copy** — the parent must be the team's **segment**, looked up from `Org.segments[].teamIds`. Only when a team is in no segment is the parent the org |
| `managerId` | — | **MISSING** → `org_unit_leader` kind `team_manager` |
| `memberIds` | — | **DERIVABLE** — reverse of `app_user.org_unit_id` |
| `createdAt` / `updatedAt` | `created_at` / `updated_at` | |
| — | `unit_type` | SYNTHESIZED `'team'` |
| — | `path` | SYNTHESIZED from the parent chain |

**The `parent_id` lookup is the highest-risk transform in this workstream.** `path` is built
from the parent chain and **every RLS policy is a path prefix match**. A team parented to the org
instead of its segment produces a path one level short, and a segment leader silently sees
nothing — or, if a path prefix accidentally overlaps, too much.

---

## 3. `Org` → `org_unit` (`unit_type='org'`) and `Segment` → `org_unit` (`unit_type='region'`)

| Firestore field | SQL destination | Notes |
|---|---|---|
| `Org.id` / `.name` | `org_unit.id` / `.name` | |
| `Org.directorId` | — | **MISSING** → `org_unit_leader` kind `director` |
| `Org.seniorLeaderIds[]` | — | **MISSING** → `org_unit_leader` kind `senior_leader`, many rows |
| `Org.teamIds[]` | — | DERIVABLE from children |
| `Org.segments[]` | child `org_unit` rows, `unit_type='region'` | the level I missed on the first pass |
| `Segment.id` / `.name` | `org_unit.id` / `.name` | |
| `Segment.leaderId` | — | **MISSING** → `org_unit_leader` kind `segment_leader` |
| `Segment.teamIds[]` | children's `parent_id` | drives §2's lookup |
| — | `Segment` timestamps | Firestore segments have none (they inherit the org document's); SQL gives each its own |
| — | `org_unit.default_se_motion` | **MISSING** → D14/D15 |

`region` is the schema's name for what the business calls a segment. `squad` stays unused (D4).

---

## 4. `role` → `user_role`: the temporal constraint

`user_role` carries
`ex_user_role_no_overlap EXCLUDE USING gist (user_id WITH =, role_id WITH =, tstzrange(valid_from, COALESCE(valid_to,'infinity')) WITH &&)`
(`00_…:166-170`).

**A role change cannot be an `UPDATE` or a second `INSERT`** — an overlapping grant is rejected.
The reconcile must close the current row (`valid_to = now()`) and then insert the new one.
`upsertAppUser` does **not** touch `user_role` at all, so this is entirely new code.

`app_role` needs its four rows seeded (`admin`, `manager`, `se`, `pm`) or the admin check in
`resolveSqlSession` is permanently unsatisfiable.

---

## 5. The verified gap list — seven items, not five

| # | Missing | Destination |
|---|---|---|
| 1 | `User.managerId` | `app_user.manager_user_id` |
| 2 | `User.avatarDataUrl` | `app_user.avatar_data_url`, or drop |
| 3 | `Team.managerId` | `org_unit_leader` (`team_manager`) |
| 4 | `Org.directorId` | `org_unit_leader` (`director`) |
| 5 | `Org.seniorLeaderIds[]` | `org_unit_leader` (`senior_leader`) |
| 6 | `Segment.leaderId` | `org_unit_leader` (`segment_leader`) |
| 7 | motion default (D14/D15) | `org_unit.default_se_motion` |

Items 3–6 are one shape — *this unit is led by this person, in this capacity* — so they collapse
into one table. **Two columns, one column, one table.** The count moved from 5 to 7 because the
pass caught `avatarDataUrl` and `default_se_motion`; the *structure* did not change, which is the
reassurance the pass was meant to provide.

---

## 6. Draft migration — `21_identity_relationships.sql`

**UNAPPLIED AND UNTESTED.** Requires registration in `worker/scripts/apply-janus-schema.mjs`
`PHASE_FILES` **and** `janus/schema/init_all.sql` — two divergent orderings exist.

```sql
-- ============================================================================
-- Janus Data Model - Phase H: identity relationships
-- Closes the seven gaps in the Firestore identity → SQL mapping.
-- Idempotent. Run after 20_history_tasks_feedback.sql.
-- ============================================================================

-- 1. Reporting line (person → person)
ALTER TABLE app_user
    ADD COLUMN IF NOT EXISTS manager_user_id bigint REFERENCES app_user(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_app_user_manager ON app_user(manager_user_id);

COMMENT ON COLUMN app_user.manager_user_id IS
    'Reporting line, from Firestore users.managerId. Distinct from org_unit leadership.';

-- 2. Avatar (drop this block if avatars are retired)
ALTER TABLE app_user
    ADD COLUMN IF NOT EXISTS avatar_data_url text;

-- 3. Motion default, on segment rows (D14/D15)
ALTER TABLE org_unit
    ADD COLUMN IF NOT EXISTS default_se_motion text;

ALTER TABLE org_unit
    DROP CONSTRAINT IF EXISTS chk_org_unit_default_se_motion,
    ADD CONSTRAINT chk_org_unit_default_se_motion
        CHECK (default_se_motion IS NULL
               OR default_se_motion IN ('new_business', 'expansion'));

COMMENT ON COLUMN org_unit.default_se_motion IS
    'QIP catalog default for SEs under this unit. Set on segment (region) rows; '
    'resolved by walking up the parent chain. Replaces the hardcoded team/segment '
    'id sets in domain-model/se-motion.ts. NULL means inherit from the parent.';

-- 4. Unit leadership (unit → person, four capacities)
CREATE TABLE IF NOT EXISTS org_unit_leader (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_unit_id text   NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    user_id     bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    leader_kind text   NOT NULL CHECK (leader_kind IN
                    ('director', 'senior_leader', 'team_manager', 'segment_leader')),
    valid_from  timestamptz NOT NULL DEFAULT now(),
    valid_to    timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_org_unit_leader UNIQUE (org_unit_id, user_id, leader_kind, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_oul_unit ON org_unit_leader(org_unit_id);
CREATE INDEX IF NOT EXISTS idx_oul_user ON org_unit_leader(user_id);

-- One current director per org, one current manager per team, one current leader
-- per segment. senior_leader is deliberately many-per-unit.
CREATE UNIQUE INDEX IF NOT EXISTS idx_oul_singleton_current
    ON org_unit_leader(org_unit_id, leader_kind)
    WHERE valid_to IS NULL AND leader_kind <> 'senior_leader';

COMMENT ON TABLE org_unit_leader IS
    'Unit leadership: Org.directorId, Org.seniorLeaderIds[], Segment.leaderId, '
    'Team.managerId. Temporal so leadership changes are auditable (D7).';

-- 5. Reference data the admin check depends on
INSERT INTO app_role (id, name, description, role_type) VALUES
    ('role_admin',   'admin',   'Full access across orgs',        'permission'),
    ('role_manager', 'manager', 'Team and subtree visibility',    'permission'),
    ('role_se',      'se',      'Own records only',               'permission'),
    ('role_pm',      'pm',      'Product signal curator',         'permission')
ON CONFLICT (id) DO NOTHING;
```

**Two notes on the draft.** `valid_to` is included on `org_unit_leader` because D7 requires
leadership changes to be auditable, and a leadership change alters what someone can see. And
`default_se_motion` is nullable with inheritance up the parent chain, so a team can override its
segment later without a schema change — which the hardcoded sets in `se-motion.ts` cannot do.

---

## 7. Open question the pass surfaced

**`avatarDataUrl`** — a base64 data URL stored inline. Keeping it means image bytes in a column
read on every profile query. Dropping it means avatars disappear at cutover. It never came up
because it is not a table, and it is genuinely your call. Low stakes; needs an answer before
this migration is final.

---

## 8. Next

- Field-by-field pass for `call_participant` (five kinds, four additions per D9)
- Field-by-field pass for the scoring tables — the largest, and the one where the inventory has
  moved most
- The rubric loader, and `22_scoring_reshape.sql`
- Acceptance tests AT-1…AT-5 as runnable files

**None of the above can be verified without a database.** The migration in §6 is a draft until
it is applied and `janus/tests/rls_fails_closed.test.mjs` passes against the result.
