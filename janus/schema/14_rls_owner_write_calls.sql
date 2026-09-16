-- ============================================================================
-- Janus Data Model - Phase A Extension: pre_call/post_call owner-write RLS
-- Fixes dual-write denial: pre_call & post_call had only an admin-write
-- policy (is_admin()), so a normal SE's insert was denied by RLS and the
-- worker silently fell back to Firestore. Mirror activity_owner_write:
-- allow write when the current user owns the linked activity.
-- ============================================================================

-- post_call: allow owner (of the linked activity) or admin to write
ALTER TABLE post_call FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS post_call_owner_write ON post_call;
CREATE POLICY post_call_owner_write ON post_call
  FOR ALL
  USING (
    is_admin() OR EXISTS (
      SELECT 1 FROM activity a WHERE a.id = post_call.activity_id AND a.owner_user_id = current_user_id()
    )
  )
  WITH CHECK (
    is_admin() OR EXISTS (
      SELECT 1 FROM activity a WHERE a.id = post_call.activity_id AND a.owner_user_id = current_user_id()
    )
  );

-- pre_call: same pattern
ALTER TABLE pre_call FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pre_call_owner_write ON pre_call;
CREATE POLICY pre_call_owner_write ON pre_call
  FOR ALL
  USING (
    is_admin() OR EXISTS (
      SELECT 1 FROM activity a WHERE a.id = pre_call.activity_id AND a.owner_user_id = current_user_id()
    )
  )
  WITH CHECK (
    is_admin() OR EXISTS (
      SELECT 1 FROM activity a WHERE a.id = pre_call.activity_id AND a.owner_user_id = current_user_id()
    )
  );
