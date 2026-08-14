#!/usr/bin/env bash
set -uo pipefail

HERMES_HOME="/root/.hermes"
SOURCE_DB="$HERMES_HOME/state.db"
SCRIPT_DIR="$HERMES_HOME/scripts"
SCRATCH_DIR="$(mktemp -d)"
DB="$SCRATCH_DIR/state.db"
PASS_COUNT=0
FAIL_COUNT=0

cleanup() {
  rm -rf "$SCRATCH_DIR"
}
trap cleanup EXIT

ok() {
  printf 'ok - %s\n' "$1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  printf 'fail - %s\n' "$1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    ok "$name"
  else
    fail "$name (expected '$expected', got '$actual')"
  fi
}

sql() {
  sqlite3 -noheader "$DB" "$1"
}

insert_brief() {
  local topic="$1" changes="$2"
  sqlite3 "$DB" <<SQL
INSERT INTO curiosity_briefs(
  trigger_type,
  topic,
  brief_text,
  changes_proposed,
  relevance_score,
  skipped,
  skip_reason,
  created_at
) VALUES (
  'T_SELF_REFLECT',
  '$topic',
  'test brief for $topic',
  '$changes',
  90,
  0,
  '',
  strftime('%s','now')
);
SQL
  sqlite3 -noheader "$DB" "SELECT id FROM curiosity_briefs ORDER BY id DESC LIMIT 1;"
}

run_classify() {
  HERMES_HOME="$HERMES_HOME" HERMES_DB="$DB" python3 "$SCRIPT_DIR/curiosity-classify.py" --brief-id "$1" >/tmp/test-act-loop.classify.out 2>/tmp/test-act-loop.classify.err
}

run_act() {
  HERMES_HOME="$HERMES_HOME" HERMES_DB="$DB" bash "$SCRIPT_DIR/curiosity-act.sh" --brief-id "$1" >/tmp/test-act-loop.act.out 2>/tmp/test-act-loop.act.err
}

run_verify() {
  HERMES_HOME="$HERMES_HOME" HERMES_DB="$DB" bash "$SCRIPT_DIR/curiosity-verify.sh" --brief-id "$1" >/tmp/test-act-loop.verify.out 2>/tmp/test-act-loop.verify.err
}

if [[ ! -f "$SOURCE_DB" ]]; then
  fail "source DB exists at $SOURCE_DB"
  printf 'PASS=%d FAIL=%d\n' "$PASS_COUNT" "$FAIL_COUNT"
  exit 1
fi

cp "$SOURCE_DB" "$DB"

for script in curiosity-classify.py curiosity-act.sh curiosity-verify.sh; do
  if [[ -e "$SCRIPT_DIR/$script" ]]; then
    ok "stage script exists: $script"
  else
    fail "stage script exists: $script"
  fi
done

for table in curiosity_actions curiosity_action_log curiosity_delegated_tasks; do
  exists="$(sql "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$table';")"
  assert_eq "schema table exists: $table" "1" "$exists"
done

for column in source status last_progress_at progress_log; do
  exists="$(sql "SELECT COUNT(*) FROM pragma_table_info('gideon_goals') WHERE name='$column';")"
  assert_eq "gideon_goals column exists: $column" "1" "$exists"
done

auto_payload='[{"primitive":"memory_write","target":"memory:test-auto-act","payload":{"key":"test-auto-act","value":"AUTO_ACT change from harness"}}]'
auto_brief_id="$(insert_brief "test-auto-act" "$auto_payload")"
if run_classify "$auto_brief_id"; then
  classification="$(sql "SELECT classification FROM curiosity_actions WHERE brief_id=$auto_brief_id ORDER BY id DESC LIMIT 1;")"
  assert_eq "classify AUTO_ACT row" "AUTO_ACT" "$classification"
else
  fail "classify AUTO_ACT execution"
fi

block_payload='[{"primitive":"data_delete","target":"DELETE FROM memory","destructive":true,"tags":["AGENT_REQUIRES_APPROVAL"]}]'
block_brief_id="$(insert_brief "test-block" "$block_payload")"
if run_classify "$block_brief_id"; then
  classification="$(sql "SELECT classification FROM curiosity_actions WHERE brief_id=$block_brief_id ORDER BY id DESC LIMIT 1;")"
  assert_eq "classify BLOCK row" "BLOCK" "$classification"
else
  fail "classify BLOCK execution"
fi

act_brief_id="$(insert_brief "test-act" "$auto_payload")"
sqlite3 "$DB" <<SQL
INSERT INTO curiosity_actions(
  brief_id,
  proposed_at,
  classification,
  primitive,
  target,
  payload,
  status,
  reason
) VALUES (
  $act_brief_id,
  datetime('now'),
  'AUTO_ACT',
  'memory_write',
  'memory:test-act',
  '{"key":"test-act","value":"done from harness"}',
  'proposed',
  'test harness'
);
SQL

if run_act "$act_brief_id"; then
  status="$(sql "SELECT status FROM curiosity_actions WHERE brief_id=$act_brief_id ORDER BY id DESC LIMIT 1;")"
  assert_eq "act marks AUTO_ACT proposed action done" "done" "$status"
else
  fail "act execution"
fi

if run_verify "$act_brief_id"; then
  outcome="$(sql "SELECT COALESCE(outcome, '') FROM curiosity_actions WHERE brief_id=$act_brief_id ORDER BY id DESC LIMIT 1;" 2>/dev/null)"
  if [[ -n "$outcome" ]]; then
    ok "verify outcome set"
  else
    fail "verify outcome set"
  fi
else
  fail "verify execution"
fi

printf 'PASS=%d FAIL=%d\n' "$PASS_COUNT" "$FAIL_COUNT"
if (( FAIL_COUNT > 0 )); then
  exit 1
fi
exit 0
