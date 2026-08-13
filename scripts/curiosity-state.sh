#!/usr/bin/env bash
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB="${HERMES_DB:-$HERMES_HOME/state.db}"

usage() {
  cat >&2 <<'EOF'
Usage:
  curiosity-state.sh init
  curiosity-state.sh record <trigger_type> <topic> <brief_text> <changes_proposed> <relevance_score> <skipped> <skip_reason>
  curiosity-state.sh update-topic <topic>
  curiosity-state.sh get-kv <key>
  curiosity-state.sh set-kv <key> <value>
  curiosity-state.sh budget-check
EOF
}

die() {
  printf 'curiosity-state.sh: %s\n' "$*" >&2
  exit 2
}

ensure_db_dir() {
  mkdir -p "$(dirname "$DB")"
}

require_sqlite() {
  command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is required"
}

sql_quote() {
  local value="${1-}"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

init_db() {
  ensure_db_dir
  sqlite3 "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS curiosity_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('self','external')),
  priority INTEGER NOT NULL DEFAULT 5,
  stale_days INTEGER NOT NULL DEFAULT 7,
  last_examined INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS curiosity_briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_type TEXT NOT NULL,
  topic TEXT NOT NULL,
  brief_text TEXT NOT NULL,
  changes_proposed TEXT,
  changes_applied TEXT,
  relevance_score INTEGER,
  skipped INTEGER DEFAULT 0,
  skip_reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS curiosity_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO curiosity_topics(topic,kind,priority,stale_days,created_at) VALUES
  ('Gideon self-reflection & behavior patterns','self',9,3,strftime('%s','now')),
  ('Gideon mesh architecture & daemons','self',8,7,strftime('%s','now')),
  ('Kuttan work domains (SE, Freshworks)','self',7,7,strftime('%s','now')),
  ('AI agents & multi-agent orchestration','external',5,7,strftime('%s','now')),
  ('LLM reasoning & planning','external',4,7,strftime('%s','now'));
SQL
}

record_brief() {
  [[ $# -eq 7 ]] || die "record requires 7 arguments"

  local trigger_type="$1"
  local topic="$2"
  local brief_text="$3"
  local changes_proposed="$4"
  local relevance_score="$5"
  local skipped="$6"
  local skip_reason="$7"

  [[ "$relevance_score" =~ ^-?[0-9]+$ ]] || die "relevance_score must be an integer"
  [[ "$skipped" =~ ^[0-9]+$ ]] || die "skipped must be an integer"

  ensure_db_dir
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
  $(sql_quote "$trigger_type"),
  $(sql_quote "$topic"),
  $(sql_quote "$brief_text"),
  $(sql_quote "$changes_proposed"),
  $relevance_score,
  $skipped,
  $(sql_quote "$skip_reason"),
  strftime('%s','now')
);
SQL
}

update_topic() {
  [[ $# -eq 1 ]] || die "update-topic requires 1 argument"
  ensure_db_dir
  sqlite3 "$DB" "UPDATE curiosity_topics SET last_examined=strftime('%s','now') WHERE topic=$(sql_quote "$1");"
}

get_kv() {
  [[ $# -eq 1 ]] || die "get-kv requires 1 argument"
  sqlite3 -noheader "$DB" "SELECT value FROM curiosity_state WHERE key=$(sql_quote "$1");"
}

set_kv() {
  [[ $# -eq 2 ]] || die "set-kv requires 2 arguments"
  ensure_db_dir
  sqlite3 "$DB" "INSERT OR REPLACE INTO curiosity_state(key,value) VALUES($(sql_quote "$1"),$(sql_quote "$2"));"
}

budget_check() {
  local today
  local token_budget
  local cycle_budget
  local tokens
  local cycles

  today="$(date +%Y%m%d)"
  token_budget="${CURIOSITY_DAILY_TOKEN_BUDGET:-20000}"
  cycle_budget="${CURIOSITY_MAX_DAILY:-12}"

  [[ "$token_budget" =~ ^[0-9]+$ ]] || die "CURIOSITY_DAILY_TOKEN_BUDGET must be an integer"
  [[ "$cycle_budget" =~ ^[0-9]+$ ]] || die "CURIOSITY_MAX_DAILY must be an integer"

  tokens="$(sqlite3 -noheader "$DB" "SELECT COALESCE((SELECT value FROM curiosity_state WHERE key='daily_tokens_$today'),'0');")"
  cycles="$(sqlite3 -noheader "$DB" "SELECT COALESCE((SELECT value FROM curiosity_state WHERE key='daily_cycles_$today'),'0');")"

  [[ "$tokens" =~ ^[0-9]+$ ]] || tokens=0
  [[ "$cycles" =~ ^[0-9]+$ ]] || cycles=0

  if (( tokens < token_budget && cycles < cycle_budget )); then
    exit 0
  fi
  exit 1
}

main() {
  require_sqlite

  local cmd="${1-}"
  [[ -n "$cmd" ]] || {
    usage
    exit 2
  }
  shift

  case "$cmd" in
    init) [[ $# -eq 0 ]] || die "init takes no arguments"; init_db ;;
    record) record_brief "$@" ;;
    update-topic) update_topic "$@" ;;
    get-kv) get_kv "$@" ;;
    set-kv) set_kv "$@" ;;
    budget-check) [[ $# -eq 0 ]] || die "budget-check takes no arguments"; budget_check ;;
    -h|--help|help) usage ;;
    *) usage; die "unknown command: $cmd" ;;
  esac
}

main "$@"
