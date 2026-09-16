-- ============================================================================
-- Janus Data Model - Phase H: Task write path + id_registry vocabulary (D8)
--
-- task is read-only today. listTasks and listTasksByLifecycle are both on
-- PersistenceReadPort and read FROM task, but no INSERT INTO task exists
-- anywhere in worker/src -- writes go to Firestore via createTask/updateTask,
-- which are absent from the SQL write switch.
--
-- This migration supplies what the write path needs on the data side:
-- id_registry has to know 'task' exists, and the table needs the same
-- row-level security every other owned record has.
--
-- Idempotent. Run after 23_call_participant.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. id_registry.entity_type is constrained only by a comment
--
-- 09_id_registry.sql lists the values in a SQL comment; the column accepts
-- any string. A typo'd entity_type silently creates a parallel namespace, and
-- resolve_internal_id() then reports "parent not migrated" for a row that
-- exists. The CHECK mirrors the EntityType union in
-- worker/src/data/persistence/id-registry.ts, plus 'task' (D8).
-- ----------------------------------------------------------------------------
ALTER TABLE id_registry DROP CONSTRAINT IF EXISTS chk_id_registry_entity_type;
ALTER TABLE id_registry
    ADD CONSTRAINT chk_id_registry_entity_type CHECK (entity_type IN (
        'org_unit',
        'app_user',
        'account',
        'contact',
        'deal',
        'deal_contact',
        'activity',
        'pre_call',
        'post_call',
        'scorecard',
        'product_signal',
        'task'
    ));

COMMENT ON COLUMN id_registry.entity_type IS
    'Constrained to the EntityType union in id-registry.ts. Adding a value '
    'here without adding it to the union (or the reverse) is the bug this '
    'CHECK exists to catch.';

-- ----------------------------------------------------------------------------
-- 2. task RLS
--
-- task holds no RLS today, so any janus_app connection can read every task
-- in the company. AT-5.5 requires adoption counts to run under RLS with a
-- manager seeing their subtree and an SE seeing only themselves, and task is
-- one of the three counted tables -- so this is a prerequisite, not a bonus.
--
-- Read is scoped through the owning user's org unit rather than a column on
-- task, because task has no org_unit_id and adding one would duplicate a fact
-- that app_user.org_unit_id already owns.
-- ----------------------------------------------------------------------------
ALTER TABLE task ENABLE ROW LEVEL SECURITY;
ALTER TABLE task FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_team_read ON task;
CREATE POLICY task_team_read ON task
    FOR SELECT
    USING (
        is_admin() OR (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM app_user u
                JOIN org_unit ou ON ou.id = u.org_unit_id
                WHERE u.id = task.owner_user_id
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );

DROP POLICY IF EXISTS task_owner_write ON task;
CREATE POLICY task_owner_write ON task
    FOR ALL
    USING (is_admin() OR owner_user_id = current_user_id())
    WITH CHECK (is_admin() OR owner_user_id = current_user_id());

-- ----------------------------------------------------------------------------
-- 3. AI task dedup, stated as a comment on the constraint that enforces it
--
-- chk_task_ai_key and idx_task_ai_dedup already exist and are correct. The
-- write path must respect them: a repeated AI pass over the same call
-- re-derives the same task_key and must upsert, not insert.
-- ----------------------------------------------------------------------------
COMMENT ON INDEX idx_task_ai_dedup IS
    'A repeated AI pass over one call must not duplicate its tasks. The write '
    'path upserts ON CONFLICT (activity_id, task_key); a plain INSERT is a bug.';

-- A completed task should record when. Firestore TaskDoc carries completedAt
-- and the SQL table had nowhere to put it.
ALTER TABLE task ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE task DROP CONSTRAINT IF EXISTS chk_task_completed_at;
ALTER TABLE task
    ADD CONSTRAINT chk_task_completed_at
        CHECK (status <> 'completed' OR completed_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_task_completed
    ON task(owner_user_id, completed_at DESC) WHERE completed_at IS NOT NULL;

COMMENT ON COLUMN task.completed_at IS
    'Firestore TaskDoc.completedAt. Required once status is completed, so '
    '"tasks closed this week" is answerable without an event log.';

-- ----------------------------------------------------------------------------
-- 4. Deal counters as a view, not stored columns
--
-- Firestore Deal carries prepCount, postCallCount and openTaskCount as
-- stored counters and the SQL deal table has none of them. Deriving is more
-- correct -- a stored counter drifts the moment one write fails -- at the
-- cost of turning a field read into an aggregate. Indexed on both sides, so
-- for a single deal this is three index scans.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_deal_counters WITH (security_invoker = true) AS
SELECT d.id   AS deal_id,
       d.public_id,
       (SELECT count(*) FROM pre_call pc
          JOIN activity a ON a.id = pc.activity_id
         WHERE a.deal_id = d.id)                        AS prep_count,
       (SELECT count(*) FROM post_call poc
          JOIN activity a ON a.id = poc.activity_id
         WHERE a.deal_id = d.id)                        AS post_call_count,
       (SELECT count(*) FROM task t
         WHERE t.deal_id = d.id
           AND t.status IN ('open', 'in_progress')
           AND t.deleted_at IS NULL)                    AS open_task_count,
       (SELECT max(a.occurred_at) FROM activity a
         WHERE a.deal_id = d.id)                        AS last_activity_at
FROM deal d;

COMMENT ON VIEW v_deal_counters IS
    'Replaces Firestore Deal.prepCount / postCallCount / openTaskCount. '
    'Derived rather than stored so the numbers cannot drift.';

GRANT SELECT ON v_deal_counters TO janus_app;
GRANT SELECT ON v_deal_counters TO janus_readonly;

-- ----------------------------------------------------------------------------
-- 5. Adoption read model (D27)
--
-- Counting what people create is sufficient; there is no login or session
-- tracking. The LEFT JOINs are the point: an SE who created nothing must
-- appear with zeros, not vanish. An absent non-adopter defeats the report.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_user_adoption WITH (security_invoker = true) AS
SELECT u.id                AS user_id,
       u.public_id         AS user_public_id,
       u.email,
       u.display_name,
       u.org_unit_id,
       ou.path             AS org_path,
       COALESCE(pc.n, 0)   AS prep_brief_count,
       COALESCE(poc.n, 0)  AS post_call_count,
       COALESCE(t.n, 0)    AS task_count,
       pc.last_at          AS last_prep_at,
       poc.last_at         AS last_post_call_at
FROM app_user u
LEFT JOIN org_unit ou ON ou.id = u.org_unit_id
LEFT JOIN (
    SELECT a.owner_user_id, count(*) AS n, max(a.occurred_at) AS last_at
    FROM pre_call p JOIN activity a ON a.id = p.activity_id
    GROUP BY a.owner_user_id
) pc ON pc.owner_user_id = u.id
LEFT JOIN (
    SELECT a.owner_user_id, count(*) AS n, max(a.occurred_at) AS last_at
    FROM post_call p JOIN activity a ON a.id = p.activity_id
    GROUP BY a.owner_user_id
) poc ON poc.owner_user_id = u.id
LEFT JOIN (
    SELECT owner_user_id, count(*) AS n
    FROM task WHERE deleted_at IS NULL
    GROUP BY owner_user_id
) t ON t.owner_user_id = u.id
WHERE u.deleted_at IS NULL
  -- app_user deliberately has NO row-level security: resolveSqlSession reads
  -- it to establish the session, before app.user_id / app.org_unit_path are
  -- set, so an RLS policy there would deny every login. The scoping therefore
  -- lives in this view, and is fail-closed the same way the policies are --
  -- a missing app.org_unit_path yields no rows rather than the whole roster.
  AND (
      is_admin() OR (
          current_org_path() IS NOT NULL AND
          starts_with(ou.path, current_org_path())
      )
  );

COMMENT ON VIEW v_user_adoption IS
    'Per-SE creation counts (D27). LEFT JOINs so a non-adopter appears with '
    'zeros rather than being absent. Time-slice by joining activity.'
    'occurred_at directly; aggregate to team/segment/org by org_path prefix. '
    'Known limitation: someone who logs in and creates nothing is '
    'indistinguishable from someone who never logged in.';

GRANT SELECT ON v_user_adoption TO janus_app;
GRANT SELECT ON v_user_adoption TO janus_readonly;
