#!/usr/bin/env bash
# Invoke Gemini Batch / read-model cron endpoints on the local worker.
# Cron on the VPS must hit http://127.0.0.1:8787 — not a public hostname
# (e.g. lionpathapi may still point at shared hosting / cPanel).
#
# Usage: cron-batch.sh {poll|fallback|embedding|read-models}
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/.env}"
WORKER_URL="${WORKER_URL:-http://127.0.0.1:8787}"
LOG_TAG="[se-paathai-cron]"

log() {
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") ${LOG_TAG} $*"
}

load_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    log "ERROR: missing ${ENV_FILE}" >&2
    exit 1
  fi

  set -a
  # Strip CRLF (Windows line endings) so `source .env` does not emit `$'\r': command not found`.
  # Permanent fix on the VPS: dos2unix "${ENV_FILE}"  (see docs/VPS_DEPLOY.md §5b)
  # shellcheck disable=SC1090
  source <(sed 's/\r$//' "${ENV_FILE}")
  set +a
}

resolve_path() {
  case "${1:-}" in
    poll) echo "/api/internal/batch/poll" ;;
    fallback) echo "/api/internal/batch/fallback" ;;
    embedding) echo "/api/internal/batch/enqueue?workload=embedding-backfill" ;;
    read-models) echo "/api/internal/read-models/nightly-rebuild" ;;
    *)
      echo "Usage: $(basename "$0") {poll|fallback|embedding|read-models}" >&2
      exit 1
      ;;
  esac
}

main() {
  local subcmd="${1:-}"
  local path secret url

  load_env

  secret="$(printf '%s' "${INTERNAL_CRON_SECRET:-}" | tr -d '\r')"
  if [[ -z "${secret}" ]]; then
    log "ERROR: INTERNAL_CRON_SECRET is empty in ${ENV_FILE}" >&2
    exit 1
  fi

  path="$(resolve_path "${subcmd}")"
  url="${WORKER_URL%/}${path}"

  log "POST ${url} (${subcmd})"
  curl -sf -X POST -H "X-Cron-Secret: ${secret}" "${url}"
  log "OK ${subcmd}"
}

main "$@"
