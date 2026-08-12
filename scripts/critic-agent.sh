#!/usr/bin/env bash
set -u

usage() {
  printf 'Usage: %s <spec-file> <worktree-or-git-dir>\n' "$0" >&2
}

trim() {
  local value="$*"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

topics_overlap() {
  local left_topics="$1"
  local right_topics="$2"
  local left_topic
  local right_topic
  local -a left_parts
  local -a right_parts

  IFS=',' read -ra left_parts <<< "$left_topics"
  IFS=',' read -ra right_parts <<< "$right_topics"

  for left_topic in "${left_parts[@]}"; do
    left_topic="$(trim "$left_topic")"
    left_topic="${left_topic,,}"
    [[ -z "$left_topic" ]] && continue

    for right_topic in "${right_parts[@]}"; do
      right_topic="$(trim "$right_topic")"
      right_topic="${right_topic,,}"
      [[ -z "$right_topic" ]] && continue

      if [[ "$left_topic" == "$right_topic" ]]; then
        printf '%s\n' "$left_topic"
        return 0
      fi
    done
  done

  return 1
}

cross_session_check() {
  local digest_file="/tmp/session-digest.md"
  local row
  local cells
  local agent
  local goal
  local status
  local last_action
  local blocked
  local topics
  local extra
  local i
  local j
  local topic
  local conflict_count=0
  local -a agents
  local -a goals
  local -a topic_sets

  if [[ ! -f "$digest_file" ]]; then
    printf 'No cross-session conflicts detected\n'
    return 0
  fi

  while IFS= read -r row; do
    [[ "$row" == \|* ]] || continue

    cells="${row#|}"
    cells="${cells%|}"
    IFS='|' read -r agent goal status last_action blocked topics extra <<< "$cells"

    agent="$(trim "$agent")"
    goal="$(trim "$goal")"
    topics="$(trim "$topics")"

    [[ -z "$agent" || -z "$goal" || -z "$topics" ]] && continue
    [[ "${agent,,}" == "agent" ]] && continue
    [[ "$agent" =~ ^-+$ ]] && continue

    agents+=("$agent")
    goals+=("$goal")
    topic_sets+=("$topics")
  done < <(grep '|' "$digest_file")

  for ((i = 0; i < ${#agents[@]}; i++)); do
    for ((j = i + 1; j < ${#agents[@]}; j++)); do
      [[ "${goals[$i]}" != "${goals[$j]}" ]] || continue

      if topic="$(topics_overlap "${topic_sets[$i]}" "${topic_sets[$j]}")"; then
        if [[ "$conflict_count" -eq 0 ]]; then
          printf '## Cross-Session Conflicts\n'
        fi
        printf -- '- topic=%s: %s (goal: %s) vs %s (goal: %s) — coordinate ownership before merging or deploying\n' \
          "$topic" "${agents[$i]}" "${goals[$i]}" "${agents[$j]}" "${goals[$j]}"
        conflict_count=$((conflict_count + 1))
      fi
    done
  done

  if [[ "$conflict_count" -eq 0 ]]; then
    printf 'No cross-session conflicts detected\n'
  fi
}

spec_file="${1:-}"
worktree_dir="${2:-}"

case "$spec_file" in
  cross-session-check)
    cross_session_check
    exit $?
    ;;
esac

if [[ -z "$spec_file" || -z "$worktree_dir" ]]; then
  usage
  exit 1
fi

reasons=()

if [[ ! -f "$spec_file" ]]; then
  reasons+=("spec file not found: $spec_file")
fi

if [[ ! -d "$worktree_dir" ]]; then
  reasons+=("worktree/git directory not found: $worktree_dir")
fi

git_stat=""
if [[ -d "$worktree_dir" ]]; then
  if ! git_stat="$(git -C "$worktree_dir" show --stat HEAD 2>&1)"; then
    reasons+=("git show --stat HEAD failed: $git_stat")
    git_stat=""
  fi
fi

extract_output_files() {
  local file="$1"
  awk '
    {
      line = $0
      gsub(/`/, "", line)
      gsub(/,/, " ", line)
      gsub(/\|/, " ", line)
      gsub(/[()]/, " ", line)
      for (i = 1; i <= NF; i++) {
        token = $i
        gsub(/^[-*[:space:]]+/, "", token)
        gsub(/[.;:]$/, "", token)
        if (token ~ /^(scripts|docs|docker|src|test|tests)\//) {
          print token
        }
      }
    }
  ' "$file" | sort -u
}

expected_files=()
if [[ -f "$spec_file" ]]; then
  while IFS= read -r path; do
    [[ -n "$path" ]] && expected_files+=("$path")
  done < <(extract_output_files "$spec_file")
fi

if [[ -f "$spec_file" && ${#expected_files[@]} -eq 0 ]]; then
  reasons+=("no named output files found in spec")
fi

if [[ -d "$worktree_dir" ]]; then
  for path in "${expected_files[@]}"; do
    if [[ "$path" = /* || "$path" == *".."* ]]; then
      reasons+=("invalid output file path in spec: $path")
    elif [[ ! -f "$worktree_dir/$path" ]]; then
      reasons+=("missing output file: $path")
    fi
  done

  while IFS= read -r script; do
    [[ -z "$script" ]] && continue
    if [[ -f "$worktree_dir/$script" ]]; then
      if ! syntax_output="$(bash -n "$worktree_dir/$script" 2>&1)"; then
        reasons+=("bash syntax check failed for $script: $syntax_output")
      fi
    fi
  done < <(printf '%s\n' "${expected_files[@]}" | awk '/\.sh$/')
fi

printf 'git show --stat HEAD\n'
if [[ -n "$git_stat" ]]; then
  printf '%s\n' "$git_stat"
fi

if [[ ${#reasons[@]} -eq 0 ]]; then
  printf 'ACCEPT\n'
  printf 'Reasons:\n'
  printf -- '- git show --stat HEAD completed\n'
  printf -- '- all named output files exist\n'
  printf -- '- bash syntax check passed\n'
  exit 0
fi

printf 'REJECT\n'
printf 'Reasons:\n'
for reason in "${reasons[@]}"; do
  printf -- '- %s\n' "$reason"
done
exit 1
