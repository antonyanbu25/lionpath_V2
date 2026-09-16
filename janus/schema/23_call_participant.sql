-- ============================================================================
-- Janus Data Model - Phase H: Call participants, five kinds (D9, D11)
--
-- The post-call pipeline already computes participants
-- (worker/src/postcall/participants.ts) and nothing writes the table -- zero
-- references to call_participant in worker/src. The data is computed and
-- discarded.
--
-- The existing shape covers 2 of the 5 decided kinds:
--   contact         proper FK
--   AE              by name/email -- correct, AEs are not Janus users
--   SE              name/email only, no app_user FK
--   internal leader same
--   meeting room    name only; not a person, and no valid participant_role
--
-- CallIdentities (web/domain/types.js:36) already holds primarySeUserId and
-- secondarySeUserIds[] as real user ids. Writing them as name strings loses
-- precision that already exists and breaks every join from a participant to
-- their team, manager or scorecards.
--
-- Idempotent. Run after 22_scoring_reshape.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The four additions
-- ----------------------------------------------------------------------------
ALTER TABLE call_participant ADD COLUMN IF NOT EXISTS participant_kind text;
ALTER TABLE call_participant ADD COLUMN IF NOT EXISTS app_user_id bigint
    REFERENCES app_user(id) ON DELETE SET NULL;
ALTER TABLE call_participant ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;
ALTER TABLE call_participant ADD COLUMN IF NOT EXISTS external_ref text;

ALTER TABLE call_participant DROP CONSTRAINT IF EXISTS chk_cp_kind;
ALTER TABLE call_participant
    ADD CONSTRAINT chk_cp_kind CHECK (participant_kind IN
        ('contact', 'se', 'ae', 'internal_leader', 'room'));

CREATE INDEX IF NOT EXISTS idx_cp_app_user ON call_participant(app_user_id);
CREATE INDEX IF NOT EXISTS idx_cp_kind     ON call_participant(activity_id, participant_kind);

-- ----------------------------------------------------------------------------
-- 2. participant_role: how someone participated, not what they are
--
-- The old CHECK ('attendee','presenter','observer') was carrying both
-- meanings, which is why a meeting room had no valid value. participant_kind
-- now answers "what"; this answers "how", and is NULL for a room because a
-- room does not participate.
-- ----------------------------------------------------------------------------
ALTER TABLE call_participant DROP CONSTRAINT IF EXISTS call_participant_participant_role_check;
ALTER TABLE call_participant DROP CONSTRAINT IF EXISTS chk_cp_role;
ALTER TABLE call_participant
    ADD CONSTRAINT chk_cp_role CHECK (participant_role IS NULL OR participant_role IN
        ('host', 'presenter', 'attendee', 'observer'));

ALTER TABLE call_participant DROP CONSTRAINT IF EXISTS chk_cp_room_no_role;
ALTER TABLE call_participant
    ADD CONSTRAINT chk_cp_room_no_role
        CHECK (participant_kind <> 'room' OR participant_role IS NULL);

-- ----------------------------------------------------------------------------
-- 3. Each kind must carry the identity its kind actually has
--
-- Without this the table accepts a 'contact' with no contact_id and an 'se'
-- with no app_user_id -- exactly the precision loss D9 exists to fix.
-- ----------------------------------------------------------------------------
ALTER TABLE call_participant DROP CONSTRAINT IF EXISTS chk_cp_identity_by_kind;
ALTER TABLE call_participant
    ADD CONSTRAINT chk_cp_identity_by_kind CHECK (
        CASE participant_kind
            WHEN 'contact'         THEN contact_id  IS NOT NULL
            WHEN 'se'              THEN app_user_id IS NOT NULL
            WHEN 'internal_leader' THEN app_user_id IS NOT NULL
            -- AEs are not Janus users (DealAe = {name, email}), so an AE is
            -- identified by name or email and never by app_user_id.
            WHEN 'ae'              THEN app_user_id IS NULL
                                        AND (participant_name IS NOT NULL
                                             OR participant_email IS NOT NULL)
            -- A room is a resource: a name, nothing else.
            WHEN 'room'            THEN participant_name IS NOT NULL
                                        AND app_user_id IS NULL
                                        AND contact_id IS NULL
            ELSE false
        END
    );

-- ----------------------------------------------------------------------------
-- 3b. The pre-existing identity constraint predates app_user_id
--
-- 02_phase2_activities.sql declared:
--
--   chk_call_participant_has_identity CHECK (
--       contact_id IS NOT NULL OR participant_email IS NOT NULL
--       OR participant_name IS NOT NULL)
--
-- Written before a participant could BE a Janus user. An SE identified by a
-- real app_user FK -- which is the whole point of D9 -- carries no name,
-- email or contact_id, so that constraint rejects exactly the row this
-- migration exists to enable. Found by writing one, not by reading the DDL.
--
-- app_user_id is now an accepted form of identity.
-- ----------------------------------------------------------------------------
ALTER TABLE call_participant DROP CONSTRAINT IF EXISTS chk_call_participant_has_identity;
ALTER TABLE call_participant
    ADD CONSTRAINT chk_call_participant_has_identity CHECK (
        app_user_id IS NOT NULL
        OR contact_id IS NOT NULL
        OR participant_email IS NOT NULL
        OR participant_name IS NOT NULL
    );

-- ----------------------------------------------------------------------------
-- 4. is_primary: the primary-SE distinction
--
-- CallIdentities separates primarySeUserId from secondarySeUserIds[]. Only
-- the SE kind has a primary, and there is at most one per call.
-- ----------------------------------------------------------------------------
ALTER TABLE call_participant DROP CONSTRAINT IF EXISTS chk_cp_primary_is_se;
ALTER TABLE call_participant
    ADD CONSTRAINT chk_cp_primary_is_se
        CHECK (NOT is_primary OR participant_kind = 'se');

CREATE UNIQUE INDEX IF NOT EXISTS uq_cp_primary_se
    ON call_participant(activity_id)
    WHERE is_primary AND participant_kind = 'se';

-- One row per person per call. Partial, because rooms and AEs have no id to
-- deduplicate on and are deduplicated by name/email instead.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cp_activity_user
    ON call_participant(activity_id, app_user_id) WHERE app_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cp_activity_contact
    ON call_participant(activity_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cp_activity_email
    ON call_participant(activity_id, lower(participant_email))
    WHERE participant_email IS NOT NULL
      AND app_user_id IS NULL AND contact_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cp_external_ref
    ON call_participant(external_ref) WHERE external_ref IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 5. Apply participant_kind as NOT NULL
--
-- Deliberately no DEFAULT: guessing a kind is how the AE/SE conflation
-- happened in the first place. Fails loudly on a pre-existing row.
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_unkinded int;
BEGIN
    SELECT count(*) INTO v_unkinded FROM call_participant WHERE participant_kind IS NULL;
    IF v_unkinded > 0 THEN
        RAISE EXCEPTION
            '% call_participant rows have no participant_kind. Nothing writes this table today, so under the clean slate this should be 0 -- inspect before proceeding; do not guess a kind.',
            v_unkinded;
    END IF;
    ALTER TABLE call_participant ALTER COLUMN participant_kind SET NOT NULL;
END
$$;

COMMENT ON TABLE call_participant IS
    'Who was on a call, five kinds (D9). SEs and internal leaders carry a real '
    'app_user_id so a participant joins to their team, manager and scorecards; '
    'AEs and rooms cannot and are identified by name/email.';

COMMENT ON COLUMN call_participant.participant_kind IS
    'What the participant IS: contact | se | ae | internal_leader | room. '
    'Orthogonal to participant_role, which is how they participated.';

COMMENT ON COLUMN call_participant.is_primary IS
    'The primary SE, from CallIdentities.primarySeUserId. At most one per '
    'call; secondary SEs are ordinary se rows.';

-- ----------------------------------------------------------------------------
-- 6. RLS
--
-- The table holds customer names and emails and had no row-level security --
-- acceptable while nothing read or wrote it, not acceptable once it is
-- queryable data. Scoped to the owning call's org unit, mirroring
-- post_call_team_read.
-- ----------------------------------------------------------------------------
ALTER TABLE call_participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_participant FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_participant_team_read ON call_participant;
CREATE POLICY call_participant_team_read ON call_participant
    FOR SELECT
    USING (
        is_admin() OR (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM activity a
                JOIN org_unit ou ON ou.id = a.org_unit_id
                WHERE a.id = call_participant.activity_id
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );

DROP POLICY IF EXISTS call_participant_owner_write ON call_participant;
CREATE POLICY call_participant_owner_write ON call_participant
    FOR ALL
    USING (
        is_admin() OR EXISTS (
            SELECT 1 FROM activity a
            WHERE a.id = call_participant.activity_id
              AND a.owner_user_id = current_user_id()
        )
    )
    WITH CHECK (
        is_admin() OR EXISTS (
            SELECT 1 FROM activity a
            WHERE a.id = call_participant.activity_id
              AND a.owner_user_id = current_user_id()
        )
    );

-- ----------------------------------------------------------------------------
-- 7. Read model: the call identity stamp, reassembled
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_call_identities WITH (security_invoker = true) AS
SELECT a.id AS activity_id,
       a.public_id AS activity_public_id,
       max(CASE WHEN cp.participant_kind = 'se' AND cp.is_primary
                THEN cp.app_user_id END) AS primary_se_user_id,
       array_remove(array_agg(DISTINCT CASE
                WHEN cp.participant_kind = 'se' AND NOT cp.is_primary
                THEN cp.app_user_id END), NULL) AS secondary_se_user_ids,
       max(CASE WHEN cp.participant_kind = 'ae' THEN cp.participant_name END)  AS ae_name,
       max(CASE WHEN cp.participant_kind = 'ae' THEN cp.participant_email END) AS ae_email,
       array_remove(array_agg(DISTINCT CASE
                WHEN cp.participant_kind = 'contact'
                THEN cp.contact_id END), NULL) AS contact_ids,
       array_remove(array_agg(DISTINCT CASE
                WHEN cp.participant_kind = 'room'
                THEN cp.participant_name END), NULL) AS room_names
FROM activity a
LEFT JOIN call_participant cp ON cp.activity_id = a.id
GROUP BY a.id, a.public_id;

COMMENT ON VIEW v_call_identities IS
    'CallIdentities (types.js:36) rebuilt from call_participant rows, so the '
    'denormalised stamp on the call document has a queryable equivalent.';

GRANT SELECT ON v_call_identities TO janus_app;
GRANT SELECT ON v_call_identities TO janus_readonly;
