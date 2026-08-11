#!/usr/bin/env bash
set -u

usage() {
  printf 'Usage: %s <worktree-or-git-dir> <spec-file> <results-file>\n' "$0" >&2
}

worktree_dir="${1:-}"
spec_file="${2:-}"
results_file="${3:-}"

if [[ -z "$worktree_dir" || -z "$spec_file" || -z "$results_file" ]]; then
  usage
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
agent="$script_dir/critic-agent.sh"

if [[ ! -x "$agent" ]]; then
  printf 'REJECT\nReasons:\n- critic agent is not executable: %s\n' "$agent" > "$results_file"
  printf 'REJECT: critic agent is not executable: %s\n' "$agent"
  exit 1
fi

mkdir -p "$(dirname -- "$results_file")"

if "$agent" "$spec_file" "$worktree_dir" > "$results_file"; then
  verdict="ACCEPT"
  status=0
else
  verdict="REJECT"
  status=1
fi

first_reason="$(awk '/^- / {print substr($0, 3); exit}' "$results_file")"
if [[ -n "$first_reason" ]]; then
  printf '%s: %s\n' "$verdict" "$first_reason"
else
  printf '%s\n' "$verdict"
fi

exit "$status"
