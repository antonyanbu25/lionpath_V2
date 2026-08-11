#!/usr/bin/env bash
set -u

usage() {
  printf 'Usage: %s <spec-file> <worktree-or-git-dir>\n' "$0" >&2
}

spec_file="${1:-}"
worktree_dir="${2:-}"

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
