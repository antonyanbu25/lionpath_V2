#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <METHOD> <URL>" >&2
  exit 2
fi

method=$1
url=$2
body_file=$(mktemp)
headers_file=$(mktemp)

cleanup() {
  rm -f "$body_file" "$headers_file"
}
trap cleanup EXIT

curl -sS -X "$method" -D "$headers_file" -o "$body_file" "$url"

status_line=$(awk '/^HTTP\// { line=$0 } END { sub(/\r$/, "", line); print line }' "$headers_file")
body_hash=$(sha256sum "$body_file" | awk '{ print $1 }')

printf '%s\n' "$status_line"
printf 'sha256 %s\n' "$body_hash"
