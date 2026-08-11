#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <IMAGE> <URL> [docker-args...]" >&2
  exit 2
fi

image=$1
url=$2
shift 2

docker run --rm "$@" "$image" "$url"
