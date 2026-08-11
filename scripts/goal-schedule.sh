#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOAL_QUEUE="${SCRIPT_DIR}/goal-queue.sh"
DB="${HOME}/.hermes/state.db"

main() {
  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "sqlite3 is required" >&2
    exit 1
  fi

  "$GOAL_QUEUE" list >/dev/null

  local row id
  row=$(sqlite3 -separator $'\t' "$DB" <<'SQL'
SELECT g.id, g.goal, COALESCE(g.parent_id, ''), g.status, g.progress
FROM gideon_goals g
LEFT JOIN gideon_goals p ON p.id = g.parent_id
WHERE g.status = 'pending'
  AND NOT EXISTS (
    SELECT 1
    FROM gideon_goals c
    WHERE c.parent_id = g.id
      AND c.status IN ('pending', 'in_progress')
  )
  AND (
    g.parent_id IS NULL
    OR p.status IN ('pending', 'in_progress', 'completed')
  )
ORDER BY
  CASE WHEN g.parent_id IS NULL THEN 1 ELSE 0 END,
  g.id
LIMIT 1;
SQL
)

  if [[ -z "$row" ]]; then
    echo "No actionable pending goal"
    exit 1
  fi

  id=${row%%$'\t'*}
  "$GOAL_QUEUE" update "$id" in_progress
  sqlite3 -header -column "$DB" \
    "SELECT id, goal, parent_id, status, progress, created_at, updated_at
     FROM gideon_goals
     WHERE id = $id;"
}

main "$@"
