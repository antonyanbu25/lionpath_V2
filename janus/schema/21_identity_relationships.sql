-- ============================================================================
-- Janus Data Model - Phase H: Identity relationships
--
-- Closes the seven gaps in the Firestore identity -> SQL mapping (D1), and
-- moves the D14/D15 motion mapping out of TypeScript into data.
--
-- Firestore users/teams/orgs are NOT copied here. Postgres starts empty (D6);
-- this migration only creates the shape the ~14 roster rows are provisioned
-- into. There is no backfill in this file by design.
--
-- Idempotent. Run after 20_history_tasks_feedback.sql.
-- Field-by-field derivation: docs/datamodel/IDENTITY_FIELD_PASS.md
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Reporting line (person -> person)
--
-- Firestore users.managerId. Deliberately distinct from org_unit leadership:
-- a person's manager is not always the manager of their unit (an SE on
-- team_ajay can report to a different lead during a transition), and the two
-- answer different questions. Leadership lives in org_unit_leader below.
-- ----------------------------------------------------------------------------
ALTER TABLE app_user
    ADD COLUMN IF NOT EXISTS manager_user_id bigint
        REFERENCES app_user(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_app_user_manager ON app_user(manager_user_id);

-- A person cannot be their own manager. Deeper cycles are not expressible as
-- a CHECK; the provisioning path must reject them.
ALTER TABLE app_user
    DROP CONSTRAINT IF EXISTS chk_app_user_manager_not_self;
ALTER TABLE app_user
    ADD CONSTRAINT chk_app_user_manager_not_self
        CHECK (manager_user_id IS NULL OR manager_user_id <> id);

COMMENT ON COLUMN app_user.manager_user_id IS
    'Reporting line, from Firestore users.managerId. Distinct from org_unit leadership.';

-- ----------------------------------------------------------------------------
-- 2. Avatar, in its own table
--
-- Firestore users.avatarDataUrl is a base64 data URL held inline. app_user is
-- read on every request (resolveSqlSession), so image bytes must never be in
-- its row. One row per user, joined only by the profile screen.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user_avatar (
    user_id     bigint PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
    data_url    text NOT NULL,
    content_type text,
    byte_size   int,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_app_user_avatar_data_url CHECK (data_url LIKE 'data:image/%')
);

COMMENT ON TABLE app_user_avatar IS
    'Firestore users.avatarDataUrl. Separate table so image bytes never load '
    'on the per-request identity read. Absent row = fall back to initials.';

GRANT SELECT, INSERT, UPDATE, DELETE ON app_user_avatar TO janus_app;
GRANT SELECT ON app_user_avatar TO janus_readonly;

-- ----------------------------------------------------------------------------
-- 3. Motion default on the hierarchy (D14, D15)
--
-- Replaces the hardcoded team/segment id sets duplicated across
-- worker/src/domain-model/se-motion.ts:52 and web/domain/se-motion.js:56 --
-- where team_akshita already appears in code but not in
-- worker/scripts/seed-users.example.csv, so roster and code can diverge.
--
-- NULL means "inherit from parent", so a team can override its segment later
-- without a schema change. Set on segment (unit_type='region') rows per D15:
--   seg_new_business -> new_business
--   seg_digital      -> expansion
--   seg_nurture      -> expansion
-- The rows themselves are provisioning data, not schema, and are not seeded
-- here -- the org tree does not exist yet.
-- ----------------------------------------------------------------------------
ALTER TABLE org_unit
    ADD COLUMN IF NOT EXISTS default_se_motion text;

ALTER TABLE org_unit
    DROP CONSTRAINT IF EXISTS chk_org_unit_default_se_motion;
ALTER TABLE org_unit
    ADD CONSTRAINT chk_org_unit_default_se_motion
        CHECK (default_se_motion IS NULL
               OR default_se_motion IN ('new_business', 'expansion'));

COMMENT ON COLUMN org_unit.default_se_motion IS
    'QIP catalog default for SEs under this unit (D14/D15). Set on segment '
    '(region) rows; resolved by walking up the parent chain. NULL = inherit.';

-- Resolve the effective motion for a unit by walking up the parent chain.
-- Returns NULL when no ancestor sets one -- the caller must then fail loudly
-- rather than assume new_business. That is the whole point: the silent
-- fallback in canonicalizeSeMotion() is what this replaces.
CREATE OR REPLACE FUNCTION resolve_se_motion(p_org_unit_id text)
RETURNS text
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE chain AS (
        SELECT id, parent_id, default_se_motion, 0 AS depth
        FROM org_unit
        WHERE id = p_org_unit_id
        UNION ALL
        SELECT ou.id, ou.parent_id, ou.default_se_motion, c.depth + 1
        FROM org_unit ou
        JOIN chain c ON ou.id = c.parent_id
        WHERE c.depth < 16          -- guard against a cycle in parent_id
    )
    SELECT default_se_motion
    FROM chain
    WHERE default_se_motion IS NOT NULL
    ORDER BY depth
    LIMIT 1;
$$;

COMMENT ON FUNCTION resolve_se_motion(text) IS
    'Nearest ancestor default_se_motion for a unit, or NULL. Server-side '
    'replacement for defaultSeMotion() in domain-model/se-motion.ts (D14).';

-- Resolve for a person, via their deepest unit.
CREATE OR REPLACE FUNCTION resolve_se_motion_for_user(p_user_id bigint)
RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT resolve_se_motion(u.org_unit_id)
    FROM app_user u
    WHERE u.id = p_user_id;
$$;

-- ----------------------------------------------------------------------------
-- 4. Unit leadership (unit -> person, four capacities)
--
-- Collapses four Firestore fields of one shape -- "this unit is led by this
-- person, in this capacity":
--   Team.managerId          -> team_manager
--   Org.directorId          -> director
--   Org.seniorLeaderIds[]   -> senior_leader   (many per unit, by design)
--   Segment.leaderId        -> segment_leader
--
-- Temporal, because a leadership change alters what someone can see and D7
-- requires that to be auditable.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_unit_leader (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_unit_id text   NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    user_id     bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    leader_kind text   NOT NULL CHECK (leader_kind IN
                    ('director', 'senior_leader', 'team_manager', 'segment_leader')),
    valid_from  timestamptz NOT NULL DEFAULT now(),
    valid_to    timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_org_unit_leader UNIQUE (org_unit_id, user_id, leader_kind, valid_from),
    CONSTRAINT chk_oul_valid_range CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX IF NOT EXISTS idx_oul_unit ON org_unit_leader(org_unit_id);
CREATE INDEX IF NOT EXISTS idx_oul_user ON org_unit_leader(user_id);
CREATE INDEX IF NOT EXISTS idx_oul_current
    ON org_unit_leader(org_unit_id, leader_kind) WHERE valid_to IS NULL;

-- One current director per org, one current manager per team, one current
-- leader per segment. senior_leader is deliberately many-per-unit.
CREATE UNIQUE INDEX IF NOT EXISTS idx_oul_singleton_current
    ON org_unit_leader(org_unit_id, leader_kind)
    WHERE valid_to IS NULL AND leader_kind <> 'senior_leader';

COMMENT ON TABLE org_unit_leader IS
    'Unit leadership: Org.directorId, Org.seniorLeaderIds[], Segment.leaderId, '
    'Team.managerId. Temporal so leadership changes are auditable (D7).';

GRANT SELECT, INSERT, UPDATE, DELETE ON org_unit_leader TO janus_app;
GRANT SELECT ON org_unit_leader TO janus_readonly;

-- ----------------------------------------------------------------------------
-- 5. job_level derivation
--
-- job_level is CHECK ('IC','manager','director','VP') with no Firestore
-- equivalent -- jobTitle is free text ("Senior Manager - Solution
-- Engineering"). upsertAppUser defaults it to 'IC'
-- (postgres-repository.ts:504), so on the seed roster a Senior Director is
-- provisioned as IC. Provisioning must derive it rather than accept that.
--
-- Order matters: VP before director before manager, so "VP of Engineering"
-- does not match on a later, broader pattern.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION derive_job_level(p_job_title text, p_role_name text DEFAULT NULL)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_job_title ~* '\y(vp|vice president|chief|c[te]o)\y'   THEN 'VP'
        WHEN p_job_title ~* '\y(director|head of)\y'                 THEN 'director'
        WHEN p_job_title ~* '\y(manager|lead|leader)\y'              THEN 'manager'
        WHEN p_role_name = 'manager'                                 THEN 'manager'
        WHEN p_job_title IS NULL OR btrim(p_job_title) = ''          THEN NULL
        ELSE 'IC'
    END;
$$;

COMMENT ON FUNCTION derive_job_level(text, text) IS
    'Best-effort job_level from free-text jobTitle, falling back to the '
    'permission role. NULL when the title is blank -- provisioning must then '
    'ask rather than silently write IC.';

-- ----------------------------------------------------------------------------
-- 6. Reference data: the four permission roles
--
-- resolveSqlSession (session-context.ts:64) and four RLS policies join
-- app_role by NAME, not id. Without these rows the admin check is
-- permanently unsatisfiable and the pm org-wide read never fires.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_role_name ON app_role(name);

-- Keyed on NAME, not id, and only inserts what is missing.
--
-- An existing install may already have these four under different ids -- the
-- QA instance had id='admin' rather than 'role_admin' -- so ON CONFLICT (id)
-- does not catch it and the insert dies on uq_app_role_name instead. The name
-- is what matters: resolveSqlSession (session-context.ts) and four RLS
-- policies join app_role BY NAME, never by id. Leaves existing rows exactly
-- as they are, including their role_type.
INSERT INTO app_role (id, name, description, role_type)
SELECT v.id, v.name, v.description, v.role_type
  FROM (VALUES
        ('role_admin',   'admin',   'Full access across orgs',     'permission'),
        ('role_manager', 'manager', 'Team and subtree visibility', 'permission'),
        ('role_se',      'se',      'Own records only',            'permission'),
        ('role_pm',      'pm',      'Product signal curator',      'permission')
       ) AS v(id, name, description, role_type)
 WHERE NOT EXISTS (SELECT 1 FROM app_role a WHERE a.name = v.name)
   AND NOT EXISTS (SELECT 1 FROM app_role a WHERE a.id   = v.id);

-- ----------------------------------------------------------------------------
-- 7. Current-role convenience view
--
-- user_role is temporal with a GIST exclusion constraint, so a role change is
-- close-then-insert, never UPDATE and never a second overlapping INSERT.
-- Readers almost always want "the role right now".
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_user_current_role WITH (security_invoker = true) AS
SELECT ur.user_id,
       ur.role_id,
       ar.name AS role_name,
       ur.valid_from,
       ur.granted_by
FROM user_role ur
JOIN app_role ar ON ar.id = ur.role_id
WHERE ur.valid_from <= now()
  AND (ur.valid_to IS NULL OR ur.valid_to > now());

COMMENT ON VIEW v_user_current_role IS
    'Active grants only. user_role history is preserved; this is the "now" read.';

GRANT SELECT ON v_user_current_role TO janus_app;
GRANT SELECT ON v_user_current_role TO janus_readonly;
