-- ============================================================================
-- Janus Data Model - Phase H: Audit trail + notification records (D7, D11, D19)
--
-- audit_log is dead today -- no writer, no reader, no trigger -- and the
-- codebase says so: routes/impersonate.ts:12-13 notes that "SQL audit_log
-- logging is queued for when the audit_log table becomes operational (it is
-- currently dead)". 07_grants.sql:43 revokes UPDATE/DELETE, so it was
-- designed append-only by a writer that was never built. There IS a live
-- impersonation route.
--
-- notification has the same shape of gap: manager dispute emails go out via
-- Resend (notify-email.ts) and nothing records that they did. The recurring
-- pattern across audit_log, notification, contact_merge_log and
-- signal_cluster is the same -- the action happens, the record doesn't.
--
-- D7 requires three things logged: score changes, role changes, and
-- impersonations. This migration adds the columns those need and the triggers
-- that write two of the three, so the trail cannot be forgotten in
-- application code.
--
-- Requires PostgreSQL 15+ (security_invoker views, already required by
-- 12_read_model_views.sql).
--
-- Idempotent. Run after 24_task_write_path.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Vocabulary
--
-- The new audit_action_enum values (impersonate, grant, revoke) and
-- notification_type_enum values (score_dispute, dispute_ruling) are added in
-- 24b_audit_notification_enums.sql, which must run first: Postgres forbids
-- using a new enum value in the transaction that added it, and the trigger
-- bodies below reference them.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 2. audit_log: who really did it
--
-- user_id alone cannot answer "was this an admin acting as someone else?",
-- which is exactly the question an impersonation log exists to answer.
-- ----------------------------------------------------------------------------
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS impersonated_by_user_id bigint;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_role text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS org_unit_id text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS before_value jsonb;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS after_value  jsonb;

-- No FK on impersonated_by_user_id: audit_log is append-only and partitioned,
-- and a deleted admin must not be able to cascade away the record of what
-- they did. The id is retained as a plain bigint on purpose.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS chk_audit_log_source;
ALTER TABLE audit_log
    ADD CONSTRAINT chk_audit_log_source
        CHECK (source IS NULL OR source IN ('app', 'system', 'loader', 'migration'));

CREATE INDEX IF NOT EXISTS idx_audit_log_impersonation
    ON audit_log(impersonated_by_user_id, created_at DESC)
    WHERE impersonated_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_action
    ON audit_log(action, created_at DESC);

COMMENT ON COLUMN audit_log.impersonated_by_user_id IS
    'The admin who was impersonating, when user_id is the impersonated '
    'person. NULL for ordinary actions. No FK: a deleted admin must not be '
    'able to cascade away the record of what they did.';

COMMENT ON COLUMN audit_log.before_value IS
    'The changed fields only, not the whole row. A score override records '
    '{score: 1}; the full scorecard is recoverable from its own table.';

-- ----------------------------------------------------------------------------
-- 3. The writer, as a function
--
-- SECURITY DEFINER so a caller with INSERT-only rights on audit_log cannot
-- shape the row's identity fields -- the actor is taken from the session, not
-- from an argument.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION write_audit_log(
    p_entity_type  text,
    p_entity_id    text,
    p_action       audit_action_enum,
    p_before       jsonb DEFAULT NULL,
    p_after        jsonb DEFAULT NULL,
    p_payload      jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO audit_log (
        user_id, impersonated_by_user_id, actor_role, org_unit_id,
        entity_type, entity_id, action, before_value, after_value, payload, source
    )
    VALUES (
        current_user_id(),
        NULLIF(current_setting('app.impersonated_by', true), '')::bigint,
        NULLIF(current_setting('app.actor_role', true), ''),
        (SELECT org_unit_id FROM app_user WHERE id = current_user_id()),
        p_entity_type, p_entity_id, p_action, p_before, p_after, p_payload,
        'app'
    );
END
$$;

COMMENT ON FUNCTION write_audit_log(text, text, audit_action_enum, jsonb, jsonb, jsonb) IS
    'Append one audit row, taking the actor from the session rather than from '
    'an argument. app.impersonated_by must be set by the impersonation route '
    '(routes/impersonate.ts) alongside the existing app.* session vars.';

-- ----------------------------------------------------------------------------
-- 4. Score changes: logged by trigger, not by convention
--
-- A score change reached through any write path must be logged. Putting this
-- in the application means every new caller has to remember; putting it here
-- means none of them can forget.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_audit_score_override()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    PERFORM write_audit_log(
        'scorecard_line',
        NEW.scorecard_line_id::text,
        'override'::audit_action_enum,
        jsonb_build_object('score', NEW.previous_score),
        jsonb_build_object('score', NEW.new_score),
        jsonb_build_object('reason', NEW.reason, 'ruling', NEW.ruling,
                           'score_override_id', NEW.id)
    );
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_score_override_audit ON score_override;
CREATE TRIGGER trg_score_override_audit
    AFTER INSERT ON score_override
    FOR EACH ROW EXECUTE FUNCTION trg_audit_score_override();

-- ----------------------------------------------------------------------------
-- 5. Role changes
--
-- user_role is temporal with a GIST exclusion constraint, so a change is
-- close-then-insert: closing a row (setting valid_to) is a revoke, inserting
-- one is a grant. Both are logged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_audit_user_role()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM write_audit_log(
            'user_role', NEW.user_id::text, 'grant'::audit_action_enum,
            NULL,
            jsonb_build_object('role_id', NEW.role_id, 'valid_from', NEW.valid_from),
            jsonb_build_object('granted_by', NEW.granted_by)
        );
    ELSIF TG_OP = 'UPDATE' AND OLD.valid_to IS NULL AND NEW.valid_to IS NOT NULL THEN
        PERFORM write_audit_log(
            'user_role', NEW.user_id::text, 'revoke'::audit_action_enum,
            jsonb_build_object('role_id', OLD.role_id, 'valid_to', NULL),
            jsonb_build_object('role_id', NEW.role_id, 'valid_to', NEW.valid_to),
            NULL
        );
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_user_role_audit ON user_role;
CREATE TRIGGER trg_user_role_audit
    AFTER INSERT OR UPDATE ON user_role
    FOR EACH ROW EXECUTE FUNCTION trg_audit_user_role();

-- ----------------------------------------------------------------------------
-- 6. Motion overrides (D7 x D14)
--
-- Motion selects the profile, so a motion override changes someone's score.
-- That makes it a score change and it belongs in the trail.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_audit_motion_override()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF NEW.se_motion_source = 'override' THEN
        PERFORM write_audit_log(
            'scorecard', NEW.public_id, 'override'::audit_action_enum,
            jsonb_build_object('se_motion',
                resolve_se_motion((SELECT org_unit_id FROM app_user WHERE id = NEW.owner_user_id))),
            jsonb_build_object('se_motion', NEW.se_motion),
            jsonb_build_object('reason', 'se_motion overridden per call',
                               'rubric_id', NEW.rubric_id,
                               'call_type', NEW.call_type)
        );
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_scorecard_motion_override ON scorecard;
CREATE TRIGGER trg_scorecard_motion_override
    AFTER INSERT ON scorecard
    FOR EACH ROW EXECUTE FUNCTION trg_audit_motion_override();

-- ----------------------------------------------------------------------------
-- 7. A view to read the trail from
--
-- D7 needs "a writer, and somewhere to view it". The writer is above; this is
-- the read. Deliberately not org-scoped: an audit trail that only shows you
-- your own subtree cannot answer "who touched this score", which is the
-- question it exists for. Admin-only.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_audit_trail WITH (security_invoker = true) AS
SELECT al.created_at,
       al.action,
       al.entity_type,
       al.entity_id,
       al.user_id,
       actor.email        AS actor_email,
       actor.display_name AS actor_name,
       al.impersonated_by_user_id,
       imp.email          AS impersonator_email,
       al.actor_role,
       al.org_unit_id,
       al.before_value,
       al.after_value,
       al.payload,
       al.source
FROM audit_log al
LEFT JOIN app_user actor ON actor.id = al.user_id
LEFT JOIN app_user imp   ON imp.id   = al.impersonated_by_user_id
WHERE is_admin();

COMMENT ON VIEW v_audit_trail IS
    'Resolved audit trail, admin-only. audit_log itself is append-only '
    '(07_grants.sql revokes UPDATE/DELETE) and partitioned by created_at.';

GRANT SELECT ON v_audit_trail TO janus_app;

-- ----------------------------------------------------------------------------
-- 8. notification: what was sent, and whether it arrived (D19)
--
-- A dispute notification is evidence the manager was told. Without a
-- delivery record, "I never got it" is unanswerable.
-- ----------------------------------------------------------------------------
ALTER TABLE notification ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS delivery_status text;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS provider_message_id text;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS delivery_error text;

ALTER TABLE notification DROP CONSTRAINT IF EXISTS chk_notification_channel;
ALTER TABLE notification
    ADD CONSTRAINT chk_notification_channel
        CHECK (channel IS NULL OR channel IN ('in_app', 'email'));

ALTER TABLE notification DROP CONSTRAINT IF EXISTS chk_notification_delivery_status;
ALTER TABLE notification
    ADD CONSTRAINT chk_notification_delivery_status
        CHECK (delivery_status IS NULL OR delivery_status IN
            ('queued', 'sent', 'failed', 'bounced', 'suppressed'));

-- A sent notification must say when; a failed one must say why. Either
-- column alone is a half-record that cannot be acted on.
ALTER TABLE notification DROP CONSTRAINT IF EXISTS chk_notification_delivery_evidence;
ALTER TABLE notification
    ADD CONSTRAINT chk_notification_delivery_evidence CHECK (
        (delivery_status <> 'sent'   OR sent_at IS NOT NULL) AND
        (delivery_status <> 'failed' OR delivery_error IS NOT NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_provider_msg
    ON notification(provider, provider_message_id)
    WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_delivery
    ON notification(delivery_status, created_at DESC)
    WHERE delivery_status IN ('queued', 'failed');

COMMENT ON COLUMN notification.provider_message_id IS
    'The email provider''s id (Resend), so a bounce webhook can be matched '
    'back to the notification it belongs to.';

COMMENT ON TABLE notification IS
    'Every notification sent, in-app or by email, and its delivery outcome '
    '(D19). Part of the audit trail: a dispute notification is evidence the '
    'manager was told. Gated in the app on DISPUTE_NOTIFY_ENABLED / '
    'EMAIL_PROVIDER_API_KEY / DISPUTE_NOTIFY_FROM.';

-- Recipient-scoped, not org-scoped: a notification is addressed to one
-- person and reading someone else's is not a manager privilege.
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_owner_read ON notification;
CREATE POLICY notification_owner_read ON notification
    FOR SELECT
    USING (is_admin() OR user_id = current_user_id());

-- Writes are system-side: a notification is raised for someone else, so this
-- cannot be owner-scoped the way an ordinary record is. Constrained instead
-- to the recipient being visible in the writer's subtree.
DROP POLICY IF EXISTS notification_write ON notification;
CREATE POLICY notification_write ON notification
    FOR ALL
    USING (
        is_admin() OR (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM app_user u
                JOIN org_unit ou ON ou.id = u.org_unit_id
                WHERE u.id = notification.user_id
                  AND starts_with(ou.path, current_org_path())
            )
        )
    )
    WITH CHECK (
        is_admin() OR (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM app_user u
                JOIN org_unit ou ON ou.id = u.org_unit_id
                WHERE u.id = notification.user_id
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );

-- ----------------------------------------------------------------------------
-- 9. contact_merge_log: the same "action happens, record doesn't" gap
--
-- Identity merge is active and being changed on the launch branch. The table
-- records source and target and nothing about what was decided.
-- ----------------------------------------------------------------------------
ALTER TABLE contact_merge_log ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE contact_merge_log ADD COLUMN IF NOT EXISTS merged_fields jsonb;
ALTER TABLE contact_merge_log ADD COLUMN IF NOT EXISTS source_snapshot jsonb;

COMMENT ON COLUMN contact_merge_log.source_snapshot IS
    'The losing contact''s fields at merge time. The row itself may be '
    'deleted; without this the merge is not reversible or explainable.';
