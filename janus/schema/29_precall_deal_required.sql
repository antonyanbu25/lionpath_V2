-- ============================================================================
-- Janus Data Model - Phase H: A prep brief is always tied to a deal (D24)
--
-- This closes a live defect rather than adding a feature.
--
-- The only read path filters WHERE d.public_id = $1 over a LEFT JOIN deal
-- (read-repository.ts:493-507), while the write calls
-- ensureDealRef(client, port, nullableString(doc.dealId), ...) which returns
-- NULL when dealId is absent (routes.ts:1896). Result: activity.deal_id is
-- NULL, the join drops the row, and the brief is written to Postgres and is
-- INVISIBLE. The Firestore type marks dealId optional (types.js:35) while
-- lifecycleId is required, so a deal-less brief is legal today.
--
-- D24 says the write must REJECT such a brief rather than write an unreadable
-- row. Putting that check only in the application leaves the data model able
-- to hold rows the application cannot read -- and the whole point of this
-- exercise is that the model matches the functionality. So it is enforced
-- here, where no caller can route around it.
--
-- A trigger and not a CHECK: the constrained value (activity.deal_id) lives
-- on the parent row, and a CHECK cannot see another table.
--
-- Idempotent. Run after 28_roadmap_gaps.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_pre_call_requires_deal()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_deal_id bigint;
BEGIN
    SELECT deal_id INTO v_deal_id FROM activity WHERE id = NEW.activity_id;

    IF v_deal_id IS NULL THEN
        RAISE EXCEPTION
            'pre_call %: the activity has no deal_id, so this brief would be written and never readable (the only read path inner-joins deal). A prep brief is always tied to a deal (D24).',
            NEW.public_id
        USING ERRCODE = 'not_null_violation';
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_pre_call_deal_required ON pre_call;
CREATE TRIGGER trg_pre_call_deal_required
    BEFORE INSERT OR UPDATE OF activity_id ON pre_call
    FOR EACH ROW EXECUTE FUNCTION trg_pre_call_requires_deal();

COMMENT ON FUNCTION trg_pre_call_requires_deal() IS
    'D24: rejects a prep brief whose activity has no deal. Fails loudly '
    'rather than writing an unreadable row -- the same principle applied to '
    'the fallback paths elsewhere.';

-- ----------------------------------------------------------------------------
-- The activity-inflation note, recorded where it will be found
--
-- pre_call.activity_id is UNIQUE and each brief mints its own act_<briefId>
-- activity, so N briefs on one deal create N 'meeting' activities. Any
-- meetings-held metric is therefore inflated by prep activity. Not fixed
-- here: deduplicating would change what a brief IS, which is a functionality
-- question and functionality is not being reopened.
-- ----------------------------------------------------------------------------
COMMENT ON COLUMN pre_call.activity_id IS
    'UNIQUE -- one brief per activity. Each brief mints its own meeting '
    'activity, so counting activity_type = ''meeting'' counts briefs too. '
    'Filter on the absence of a pre_call row for genuine meetings-held.';

-- Briefs for a deal, newest first -- the shape listPrepBriefsByLifecycle
-- needs, and the index it did not have.
CREATE INDEX IF NOT EXISTS idx_pre_call_generated
    ON pre_call(activity_id, generated_at DESC);

-- ----------------------------------------------------------------------------
-- Single-brief read
--
-- No getPrepBrief exists anywhere, so showing one brief means loading all of
-- a deal's briefs. Tolerable but wasteful; the view gives the read path a
-- single-row shape without any new structure.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_pre_call_brief WITH (security_invoker = true) AS
SELECT p.id,
       p.public_id,
       p.activity_id,
       a.deal_id,
       d.public_id     AS deal_public_id,
       a.account_id,
       a.owner_user_id,
       a.org_unit_id,
       a.occurred_at,
       p.research_brief,
       p.input_snapshot,
       p.generated_at,
       p.created_at
FROM pre_call p
JOIN activity a ON a.id = p.activity_id
JOIN deal d     ON d.id = a.deal_id;      -- INNER: a brief without a deal cannot exist

COMMENT ON VIEW v_pre_call_brief IS
    'One prep brief with its deal and owner resolved. The join to deal is '
    'INNER because trg_pre_call_deal_required guarantees a deal exists -- '
    'the LEFT JOIN in read-repository.ts is what silently dropped rows.';

GRANT SELECT ON v_pre_call_brief TO janus_app;
GRANT SELECT ON v_pre_call_brief TO janus_readonly;
