-- ============================================================================
-- Janus Data Model - Phase I: deal.closed_won_at
--
-- Firestore Deal carries closedWonAt, both top-level and inside metadata, and
-- the SQL deal table has neither -- only close_date, which is the FORECAST
-- date and not the date it actually closed.
--
-- Needed by findWonNbDealInGrace: when a new call arrives on an account whose
-- new-business deal was just won, it belongs to that deal rather than opening
-- a fresh one. "Just won" is a window on the actual close, so close_date
-- cannot answer it -- a deal forecast for next quarter and won early would be
-- read as still open.
--
-- Found by running the read against the real database rather than by reading
-- the DDL.
--
-- Idempotent. Run after 31_remaining_collections.sql.
-- ============================================================================

ALTER TABLE deal ADD COLUMN IF NOT EXISTS closed_won_at timestamptz;

-- Only a won deal has a won date, and a won deal should have one. Warn rather
-- than constrain: existing won rows predate the column and blocking the
-- migration on historical data would be the wrong trade.
DO $$
DECLARE v_won_undated int;
BEGIN
    SELECT count(*) INTO v_won_undated
      FROM deal WHERE status = 'won' AND closed_won_at IS NULL;
    IF v_won_undated > 0 THEN
        RAISE WARNING
            '% deal(s) are status=won with no closed_won_at. findWonNbDealInGrace falls back to updated_at for those, which is close but not the same fact.',
            v_won_undated;
    END IF;
END
$$;

ALTER TABLE deal DROP CONSTRAINT IF EXISTS chk_deal_closed_won_at;
ALTER TABLE deal
    ADD CONSTRAINT chk_deal_closed_won_at
        CHECK (closed_won_at IS NULL OR status IN ('won', 'lost'));

CREATE INDEX IF NOT EXISTS idx_deal_closed_won
    ON deal(account_id, closed_won_at DESC)
    WHERE status = 'won' AND deleted_at IS NULL;

COMMENT ON COLUMN deal.closed_won_at IS
    'When the deal actually closed won (Firestore Deal.closedWonAt). Distinct '
    'from close_date, which is the forecast. Drives the grace window in '
    'findWonNbDealInGrace, so a call arriving days after a win attaches to '
    'that deal instead of opening a new one.';
