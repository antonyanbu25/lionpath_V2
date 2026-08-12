#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DIGEST_PATH="${SESSION_DIGEST_PATH:-/tmp/session-digest.md}"

usage() {
  cat <<USAGE
Usage:
  $SCRIPT_NAME pull [--topics <comma-separated-topics>]
  $SCRIPT_NAME --help

Environment:
  HERMES_HOME           Defaults to ~/.hermes
  SESSION_DIGEST_PATH   Defaults to /tmp/session-digest.md
USAGE
}

normalize_topics() {
  local raw="${1:-}"
  raw="${raw//,/ }"
  printf '%s\n' "$raw" | tr '[:upper:]' '[:lower:]'
}

print_no_sessions() {
  printf '# No active sessions\n'
}

filter_digest() {
  local topics="$1"

  awk -v wanted_topics="$(normalize_topics "$topics")" '
    BEGIN {
      split(wanted_topics, wanted_parts, /[[:space:]]+/)
      for (i in wanted_parts) {
        if (wanted_parts[i] != "") {
          wanted[wanted_parts[i]] = 1
        }
      }
      in_active = 0
      in_conflicts = 0
      seen_section = 0
      kept_rows = 0
    }

    function trim(value) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      return value
    }

    function row_matches(row, columns, topic_text, parts, i, topic) {
      if (row !~ /^\|/) {
        return 0
      }
      split(row, columns, "|")
      topic_text = tolower(trim(columns[length(columns) - 1]))
      gsub(/,/, " ", topic_text)
      split(topic_text, parts, /[[:space:]]+/)
      for (i in parts) {
        topic = trim(parts[i])
        if (topic in wanted) {
          return 1
        }
      }
      return 0
    }

    function conflict_matches(line, topic) {
      line = tolower(line)
      for (topic in wanted) {
        if (line ~ ("(^|[^[:alnum:]_-])" topic "([^[:alnum:]_-]|$)")) {
          return 1
        }
      }
      return 0
    }

    /^## Active Sessions[[:space:]]*$/ {
      seen_section = 1
      in_active = 1
      in_conflicts = 0
      active_count = 0
      active[++active_count] = $0
      next
    }

    /^## Cross-Session Conflicts[[:space:]]*$/ {
      seen_section = 1
      in_active = 0
      in_conflicts = 1
      conflict_count = 0
      conflict[++conflict_count] = $0
      next
    }

    /^## / {
      seen_section = 1
      in_active = 0
      in_conflicts = 0
      next
    }

    in_active {
      if ($0 ~ /^\|[[:space:]]*-+/ || $0 ~ /^\|[[:space:]]*Agent[[:space:]]*\|/) {
        active[++active_count] = $0
      } else if (row_matches($0)) {
        active[++active_count] = $0
        kept_rows++
      }
      next
    }

    in_conflicts {
      if ($0 ~ /^-/ && conflict_matches($0)) {
        conflict[++conflict_count] = $0
      }
      next
    }

    !seen_section {
      pre[++pre_count] = $0
      next
    }

    END {
      if (kept_rows == 0) {
        print "# No active sessions"
        exit
      }

      for (i = 1; i <= pre_count; i++) {
        print pre[i]
      }

      for (i = 1; i <= active_count; i++) {
        print active[i]
      }

      if (conflict_count > 1) {
        print ""
        for (i = 1; i <= conflict_count; i++) {
          print conflict[i]
        }
      }
    }
  ' "$DIGEST_PATH"
}

cmd_pull() {
  local topics=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --topics)
        [[ $# -ge 2 ]] || { print_no_sessions; return 0; }
        topics="$2"
        shift 2
        ;;
      -h|--help|help)
        usage
        return 0
        ;;
      *)
        shift
        ;;
    esac
  done

  if [[ ! -s "$DIGEST_PATH" ]]; then
    print_no_sessions
    return 0
  fi

  if [[ -z "$topics" ]]; then
    cat "$DIGEST_PATH"
    return 0
  fi

  filter_digest "$topics"
}

main() {
  local cmd="${1:-pull}"
  if [[ $# -gt 0 ]]; then
    shift
  fi

  case "$cmd" in
    pull) cmd_pull "$@" ;;
    -h|--help|help) usage ;;
    *) usage ;;
  esac
}

main "$@" || true
