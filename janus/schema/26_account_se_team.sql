-- ============================================================================
-- Janus Data Model - Phase H: Account SE team
--
-- "SEs can edit their own accounts" is not a policy choice -- the code already
-- intends it. The manager-only restriction in the app is a workaround because
-- Account.seTeam (up to 4 SE members, types.js:12) has no SQL column at all,
-- so there is nothing for a write policy to check membership against.
--
-- Idempotent. Run after 25_audit_and_notifications.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The junction
--
-- primarySeUserId on the Firestore account is the denormalised pointer to the
-- row with role='primary'. Not repeated as a column here: two places to state
-- one fact is how they come to disagree.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_se_team (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id  bigint NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    se_user_id  bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    role        text   NOT NULL CHECK (role IN ('primary', 'secondary')),
    added_at    timestamptz NOT NULL DEFAULT now(),
    added_by    bigint REFERENCES app_user(id) ON DELETE SET NULL,
    removed_at  timestamptz,

    CONSTRAINT uq_account_se_team UNIQUE (account_id, se_user_id),
    CONSTRAINT chk_aset_removed CHECK (removed_at IS NULL OR removed_at >= added_at)
);

CREATE INDEX IF NOT EXISTS idx_aset_account ON account_se_team(account_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_aset_user    ON account_se_team(se_user_id) WHERE removed_at IS NULL;

-- Exactly one current primary per account.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aset_primary
    ON account_se_team(account_id)
    WHERE role = 'primary' AND removed_at IS NULL;

COMMENT ON TABLE account_se_team IS
    'Account.seTeam -- up to four SEs per account, one primary. Soft-removed '
    'rather than deleted so "who owned this account in March" stays '
    'answerable. The write policy on account keys off this table.';

-- ----------------------------------------------------------------------------
-- 2. The cap of four
--
-- Not expressible as a CHECK: it constrains the number of sibling rows, not
-- the row being written. A BEFORE INSERT trigger is the honest enforcement.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_account_se_team_cap()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
    SELECT count(*) INTO v_count
      FROM account_se_team
     WHERE account_id = NEW.account_id AND removed_at IS NULL;

    IF v_count >= 4 THEN
        RAISE EXCEPTION
            'account % already has 4 active SE team members; remove one before adding another',
            NEW.account_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_aset_cap ON account_se_team;
CREATE TRIGGER trg_aset_cap
    BEFORE INSERT ON account_se_team
    FOR EACH ROW EXECUTE FUNCTION trg_account_se_team_cap();

ALTER TABLE account_se_team ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_se_team FORCE ROW LEVEL SECURITY;

-- Membership is not sensitive -- the account list is org-wide today and
-- global search depends on it. Reads are open to any authenticated session;
-- writes are restricted below.
DROP POLICY IF EXISTS account_se_team_read ON account_se_team;
CREATE POLICY account_se_team_read ON account_se_team
    FOR SELECT USING (current_user_id() IS NOT NULL OR is_admin());

-- Membership on an account is managed by that account's team, or by anyone
-- while it is unclaimed.
--
-- Requiring existing membership outright would be a deadlock: the FIRST row
-- for an account could never be inserted, because the policy checks for a row
-- that does not exist yet. So the same unclaimed-account escape hatch as the
-- account policy below applies -- see the long note in section 4. The
-- function is defined there; this policy is created after it.
DROP POLICY IF EXISTS account_se_team_write ON account_se_team;

GRANT SELECT, INSERT, UPDATE, DELETE ON account_se_team TO janus_app;
GRANT SELECT ON account_se_team TO janus_readonly;

-- ----------------------------------------------------------------------------
-- 3. account: the two fields with no column
-- ----------------------------------------------------------------------------
ALTER TABLE account ADD COLUMN IF NOT EXISTS program_phase text;
ALTER TABLE account ADD COLUMN IF NOT EXISTS metadata jsonb;

ALTER TABLE account DROP CONSTRAINT IF EXISTS chk_account_program_phase;
ALTER TABLE account
    ADD CONSTRAINT chk_account_program_phase
        CHECK (program_phase IS NULL
               OR program_phase IN ('new_business', 'live', 'expansion'));

COMMENT ON COLUMN account.program_phase IS
    'Account.programPhase. Where the account is in its lifecycle -- NOT the '
    'SE motion, which is a property of the acting SE and lives on the call '
    '(post_call.se_motion). The two use overlapping words for different things.';

-- ----------------------------------------------------------------------------
-- 4. account write policy: the SE team, not the manager
--
-- Reads stay open. account has no org_unit_id, so a path-prefix read policy
-- is not even expressible, and narrowing account visibility would break
-- global search -- which is a product change, not a data-model one.
-- Writes are what the manager-only workaround was about (D: "SEs can edit
-- their own accounts"), and those are now checkable against a real table.
--
-- CRITICAL: the write policy must also permit an account with NO SE team.
--
-- Nothing populates account_se_team yet -- that is application work. A policy
-- that required membership outright would deny UPDATE on every existing
-- account, and upsertAccount (postgres-repository.ts:75) is
-- `INSERT ... ON CONFLICT (public_id) DO UPDATE`. Every prep brief and
-- post-call after the first one on a given account hits that UPDATE path via
-- ensureAccountProvisioned, so a membership-only policy would abort the whole
-- dual-write transaction and take the pre_call/post_call row down with it.
--
-- So: an UNCLAIMED account (no active se_team rows) is writable by any
-- authenticated session, exactly as today. Once a team is assigned, the team
-- owns it. That delivers the decision without breaking the write path before
-- the app is ready, and the restriction tightens automatically as soon as
-- account_se_team starts being populated -- no second migration needed.
-- ----------------------------------------------------------------------------
ALTER TABLE account ENABLE ROW LEVEL SECURITY;
ALTER TABLE account FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_read ON account;
CREATE POLICY account_read ON account
    FOR SELECT USING (current_user_id() IS NOT NULL OR is_admin());

-- Claimed by me, or not claimed by anyone.
CREATE OR REPLACE FUNCTION account_writable_by_current_user(p_account_id bigint)
RETURNS boolean
LANGUAGE sql STABLE AS $fn$
    SELECT is_admin()
        OR EXISTS (
            SELECT 1 FROM account_se_team m
             WHERE m.account_id = p_account_id
               AND m.se_user_id = current_user_id()
               AND m.removed_at IS NULL
        )
        OR NOT EXISTS (
            SELECT 1 FROM account_se_team m
             WHERE m.account_id = p_account_id
               AND m.removed_at IS NULL
        );
$fn$;

COMMENT ON FUNCTION account_writable_by_current_user(bigint) IS
    'True when the caller is on the account SE team, the account has no team '
    'yet (unclaimed), or the caller is admin. The unclaimed case keeps '
    'upsertAccount''s ON CONFLICT DO UPDATE working before the application '
    'populates account_se_team.';

DROP POLICY IF EXISTS account_se_team_owner_write ON account;
CREATE POLICY account_se_team_owner_write ON account
    FOR ALL
    USING (
        is_admin() OR (current_user_id() IS NOT NULL
                       AND account_writable_by_current_user(account.id))
    )
    WITH CHECK (
        is_admin() OR (current_user_id() IS NOT NULL
                       AND account_writable_by_current_user(account.id))
    );

-- A brand-new account has no id to check membership against at INSERT time,
-- so INSERT is permitted to any authenticated session -- unchanged from
-- today's behaviour, and the same posture as deal/activity creation.
DROP POLICY IF EXISTS account_insert ON account;
CREATE POLICY account_insert ON account
    FOR INSERT
    WITH CHECK (current_user_id() IS NOT NULL OR is_admin());

-- Deferred from section 2: needs account_writable_by_current_user() above.
DROP POLICY IF EXISTS account_se_team_write ON account_se_team;
-- is_admin() is checked OUTSIDE the current_user_id() guard on purpose.
--
-- The guard exists so a session with no context cannot write via the
-- "unclaimed account" branch of account_writable_by_current_user -- with no
-- team rows that branch is true for everyone. But an admin (or a system
-- fixture) legitimately has app.is_admin set without app.user_id, and an
-- `AND` would lock them out entirely.
CREATE POLICY account_se_team_write ON account_se_team
    FOR ALL
    USING (
        is_admin() OR (current_user_id() IS NOT NULL
                       AND account_writable_by_current_user(account_se_team.account_id))
    )
    WITH CHECK (
        is_admin() OR (current_user_id() IS NOT NULL
                       AND account_writable_by_current_user(account_se_team.account_id))
    );

COMMENT ON TABLE account IS
    'Customer account. Readable org-wide (global search depends on it); '
    'writable by its SE team via account_se_team, or by anyone while the '
    'account is unclaimed. Replaces the manager-only workaround, which existed '
    'only because seTeam had no SQL column.';

-- ----------------------------------------------------------------------------
-- 5. Read model
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_account_se_team WITH (security_invoker = true) AS
SELECT a.id            AS account_id,
       a.public_id     AS account_public_id,
       a.name          AS account_name,
       max(CASE WHEN m.role = 'primary' THEN m.se_user_id END) AS primary_se_user_id,
       array_remove(array_agg(DISTINCT CASE
                WHEN m.role = 'secondary' THEN m.se_user_id END), NULL)
                                                               AS secondary_se_user_ids,
       count(m.id)                                             AS se_count
FROM account a
LEFT JOIN account_se_team m
       ON m.account_id = a.id AND m.removed_at IS NULL
WHERE a.deleted_at IS NULL
GROUP BY a.id, a.public_id, a.name;

GRANT SELECT ON v_account_se_team TO janus_app;
GRANT SELECT ON v_account_se_team TO janus_readonly;
