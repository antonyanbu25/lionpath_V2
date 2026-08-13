#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DB="${HERMES_DB:-$HERMES_HOME/state.db}"

trap 'rm -f /tmp/curiosity.$$.*' EXIT

log() {
  printf '[%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SCRIPT_NAME" "$*" >&2
}

die() {
  log "$*"
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
Usage:
  curiosity-fetch.sh <topic>

Environment:
  HERMES_HOME  Defaults to ~/.hermes
  HERMES_DB    Defaults to $HERMES_HOME/state.db
USAGE
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

sql_quote() {
  local s="${1-}"
  s="${s//\'/\'\'}"
  printf "'%s'" "$s"
}

table_exists() {
  local table="$1"
  [[ -f "$DB" ]] || return 1
  [[ "$(sqlite3 "$DB" "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=$(sql_quote "$table"));")" == "1" ]]
}

query_json_or_empty() {
  local table="$1"
  local sql="$2"

  if table_exists "$table"; then
    sqlite3 -json "$DB" "$sql"
  else
    printf '[]\n'
  fi
}

topic_kind() {
  local topic="$1"

  if ! table_exists curiosity_topics; then
    printf 'self\n'
    return 0
  fi

  sqlite3 "$DB" \
    "SELECT COALESCE((SELECT kind FROM curiosity_topics WHERE topic = $(sql_quote "$topic") LIMIT 1), 'self');"
}

urlencode() {
  local value="$1"
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$value"
}

fetch_external() {
  local topic="$1"
  local out="$2"
  local encoded url

  encoded="$(urlencode "$topic")"
  url="https://export.arxiv.org/api/query?search_query=${encoded}&max_results=5"

  if command -v curl >/dev/null 2>&1; then
    if curl --fail --silent --show-error --max-time 20 --connect-timeout 10 "$url" >"$out"; then
      return 0
    fi
    log "external fetch failed for topic: $topic"
  else
    log "curl unavailable; skipping external fetch"
  fi

  : >"$out"
  return 0
}

write_combined_json() {
  local topic="$1"
  local kind="$2"
  local epoch="$3"
  local events_file="$4"
  local goals_file="$5"
  local memory_file="$6"
  local external_file="$7"
  local raw_file="$8"

  python3 - "$topic" "$kind" "$epoch" "$events_file" "$goals_file" "$memory_file" "$external_file" >"$raw_file" <<'PY'
import json
import sys
from pathlib import Path

topic, kind, epoch, events_file, goals_file, memory_file, external_file = sys.argv[1:]

def load_json(path):
    text = Path(path).read_text()
    if not text.strip():
        return []
    return json.loads(text)

external_raw = Path(external_file).read_text()
payload = {
    "topic": topic,
    "kind": kind,
    "fetched_at": int(epoch),
    "internal": {
        "gideon_events": load_json(events_file),
        "gideon_goals": load_json(goals_file),
        "memory": load_json(memory_file),
    },
    "external": {
        "source": "arxiv" if kind == "external" and external_raw else None,
        "raw": external_raw if external_raw else None,
    },
}
json.dump(payload, sys.stdout, ensure_ascii=False)
sys.stdout.write("\n")
PY
}

main() {
  [[ $# -eq 1 ]] || usage
  require_cmd sqlite3
  require_cmd python3

  local topic="$1"
  local epoch raw_file kind
  local events_file goals_file memory_file external_file

  epoch="$(date +%s)"
  raw_file="/tmp/curiosity.${epoch}.raw"
  events_file="/tmp/curiosity.$$.events.json"
  goals_file="/tmp/curiosity.$$.goals.json"
  memory_file="/tmp/curiosity.$$.memory.json"
  external_file="/tmp/curiosity.$$.external.raw"

  kind="$(topic_kind "$topic")"

  query_json_or_empty gideon_events \
    "SELECT type, payload
     FROM gideon_events
     WHERE ts <= CAST(strftime('%s','now') AS INTEGER)
     ORDER BY ts DESC, id DESC
     LIMIT 20;" >"$events_file"

  query_json_or_empty gideon_goals \
    "SELECT status, progress
     FROM gideon_goals
     WHERE COALESCE(updated_at, created_at, 0) <= CAST(strftime('%s','now') AS INTEGER)
     ORDER BY COALESCE(updated_at, created_at, 0) DESC, id DESC
     LIMIT 20;" >"$goals_file"

  query_json_or_empty memory \
    "SELECT key, value
     FROM memory
     WHERE COALESCE(updated_at, 0) <= CAST(strftime('%s','now') AS INTEGER)
     ORDER BY COALESCE(updated_at, 0) DESC, key
     LIMIT 20;" >"$memory_file"

  : >"$external_file"
  if [[ "$kind" == "external" ]]; then
    fetch_external "$topic" "$external_file"
  fi

  write_combined_json "$topic" "$kind" "$epoch" "$events_file" "$goals_file" "$memory_file" "$external_file" "$raw_file"
  printf '%s\n' "$raw_file"
}

main "$@"
