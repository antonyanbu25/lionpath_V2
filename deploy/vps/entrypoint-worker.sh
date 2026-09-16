#!/bin/sh
# Worker container entrypoint — validate env before starting Node.
set -eu

if [ -z "${GEMINI_API_KEY:-}" ] || [ "${GEMINI_API_KEY}" = "your-gemini-api-key-here" ]; then
  echo "[worker] FATAL: GEMINI_API_KEY is missing or still the placeholder in deploy/vps/.env" >&2
  echo "[worker] Fix: nano /opt/se-singha-paathai/deploy/vps/.env" >&2
  exit 1
fi

mkdir -p /data/history /data/video 2>/dev/null || true

exec "$@"
