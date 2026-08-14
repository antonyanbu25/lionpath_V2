-- Migration 003: dispatch state for goal-dispatcher
--
-- Adds columns to gideon_goals for tracking dispatch attempts and creates
-- the gideon_goal_dispatches table for recording individual dispatch calls.
--
-- The companion 003_dispatch_state.sh performs conditional ALTER TABLE /
-- CREATE TABLE (SQLite cannot do conditional DDL from static SQL).

PRAGMA table_info(gideon_goals);
