#!/usr/bin/env bash
set -Eeuo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
CONFIG_DIR="$HERMES_HOME/config"
NODES_FILE="$CONFIG_DIR/discovered-nodes.json"
DEFAULT_CIDR="192.168.1.0/24"
DEFAULT_INTERVAL=300
SSH_CONNECT_TIMEOUT="${SSH_CONNECT_TIMEOUT:-2}"
TMP_FILES=()

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

cleanup() {
  local file
  for file in "${TMP_FILES[@]:-}"; do
    [[ -n "$file" && -e "$file" ]] && rm -f "$file"
  done
  return 0
}

on_error() {
  local rc=$?
  log "error at line ${BASH_LINENO[0]} (exit $rc)"
  exit "$rc"
}

trap cleanup EXIT
trap on_error ERR

usage() {
  cat <<'EOF'
Usage: node-discovery.sh [COMMAND] [OPTIONS]

Commands:
  --scan [CIDR]          Scan a /24 subnet once (default: 192.168.1.0/24)
  --watch [CIDR]         Continuously scan a /24 subnet
  --list                 Print known nodes as JSON
  --help                 Show this help

Options:
  --interval N           Watch interval in seconds (default: 300)

Environment:
  HERMES_HOME            Hermes home directory (default: ~/.hermes)
  HERMES_SSH_USER        Optional SSH username for probes
  SSH_CONNECT_TIMEOUT    SSH connect timeout in seconds (default: 2)
EOF
}

check_prereqs() {
  local missing=()
  local cmd

  for cmd in bash timeout ssh date mkdir mktemp mv seq; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done

  if ! command -v jq >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
    missing+=("jq-or-python3")
  fi

  if ((${#missing[@]} > 0)); then
    log "missing prerequisite(s): ${missing[*]}"
    return 1
  fi

  mkdir -p "$CONFIG_DIR"
}

valid_octet() {
  local octet="$1"
  [[ "$octet" =~ ^[0-9]+$ ]] && ((octet >= 0 && octet <= 255))
}

cidr_to_ips() {
  local cidr="${1:-$DEFAULT_CIDR}"
  local o1 o2 o3 o4 mask host

  IFS='./' read -r o1 o2 o3 o4 mask <<<"$cidr"
  if [[ -z "${o1:-}" || -z "${o2:-}" || -z "${o3:-}" || -z "${o4:-}" || -z "${mask:-}" ]]; then
    log "invalid CIDR: $cidr"
    return 1
  fi

  if [[ "$mask" != "24" ]] || ! valid_octet "$o1" || ! valid_octet "$o2" || ! valid_octet "$o3" || ! valid_octet "$o4"; then
    log "only valid /24 CIDRs are supported: $cidr"
    return 1
  fi

  for host in $(seq 1 254); do
    printf '%s.%s.%s.%s\n' "$o1" "$o2" "$o3" "$host"
  done
}

probe_ssh() {
  local ip="$1"
  ip="$ip" timeout 2 bash -c 'echo >/dev/tcp/$ip/22' >/dev/null 2>&1
}

ssh_target() {
  local ip="$1"
  if [[ -n "${HERMES_SSH_USER:-}" ]]; then
    printf '%s@%s\n' "$HERMES_SSH_USER" "$ip"
  else
    printf '%s\n' "$ip"
  fi
}

json_node() {
  local hostname="$1"
  local ip="$2"
  local last_seen="$3"
  local reachable="$4"
  local has_sqlite3="$5"
  local has_agent_radio_mesh="$6"

  if command -v jq >/dev/null 2>&1; then
    jq -cn \
      --arg hostname "$hostname" \
      --arg ip "$ip" \
      --arg last_seen "$last_seen" \
      --argjson reachable "$reachable" \
      --argjson has_sqlite3 "$has_sqlite3" \
      --argjson has_agent_radio_mesh "$has_agent_radio_mesh" \
      '{
        hostname: $hostname,
        ip: $ip,
        last_seen: $last_seen,
        reachable: $reachable,
        capabilities: {
          sqlite3: $has_sqlite3,
          agent_radio_mesh: $has_agent_radio_mesh
        }
      }'
  else
    python3 - "$hostname" "$ip" "$last_seen" "$reachable" "$has_sqlite3" "$has_agent_radio_mesh" <<'PY'
import json
import sys

hostname, ip, last_seen, reachable, has_sqlite3, has_agent_radio_mesh = sys.argv[1:7]
print(json.dumps({
    "hostname": hostname,
    "ip": ip,
    "last_seen": last_seen,
    "reachable": reachable == "true",
    "capabilities": {
        "sqlite3": has_sqlite3 == "true",
        "agent_radio_mesh": has_agent_radio_mesh == "true",
    },
}, separators=(",", ":")))
PY
  fi
}

probe_capabilities() {
  local ip="$1"
  local target output hostname has_sqlite3 has_agent_radio_mesh last_seen

  target="$(ssh_target "$ip")"
  last_seen="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  output="$(
    ssh \
      -o BatchMode=yes \
      -o ConnectTimeout="$SSH_CONNECT_TIMEOUT" \
      -o StrictHostKeyChecking=accept-new \
      -o UserKnownHostsFile="$HOME/.ssh/known_hosts" \
      "$target" \
      'printf "hostname=%s\n" "$(hostname 2>/dev/null || printf unknown)";
       if command -v sqlite3 >/dev/null 2>&1; then printf "sqlite3=true\n"; else printf "sqlite3=false\n"; fi;
       if [ -f "$HOME/.hermes/scripts/agent-radio-mesh.sh" ]; then printf "agent_radio_mesh=true\n"; else printf "agent_radio_mesh=false\n"; fi' \
      2>/dev/null
  )" || output=""

  hostname="unknown"
  has_sqlite3="false"
  has_agent_radio_mesh="false"

  while IFS='=' read -r key value; do
    case "$key" in
      hostname) hostname="${value:-unknown}" ;;
      sqlite3) [[ "${value:-}" == "true" ]] && has_sqlite3="true" ;;
      agent_radio_mesh) [[ "${value:-}" == "true" ]] && has_agent_radio_mesh="true" ;;
    esac
  done <<<"$output"

  json_node "$hostname" "$ip" "$last_seen" "true" "$has_sqlite3" "$has_agent_radio_mesh"
}

empty_nodes_file() {
  printf '{"nodes":[]}\n'
}

ensure_nodes_file() {
  if [[ ! -s "$NODES_FILE" ]]; then
    empty_nodes_file >"$NODES_FILE"
    return
  fi

  if command -v jq >/dev/null 2>&1; then
    jq -e '.nodes | type == "array"' "$NODES_FILE" >/dev/null 2>&1 || empty_nodes_file >"$NODES_FILE"
  else
    python3 - "$NODES_FILE" <<'PY' || printf '{"nodes":[]}\n' >"$NODES_FILE"
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    data = json.load(handle)
if not isinstance(data.get("nodes"), list):
    raise SystemExit(1)
PY
  fi
}

merge_nodes() {
  local incoming="$1"
  local tmp

  ensure_nodes_file
  tmp="$(mktemp "$CONFIG_DIR/discovered-nodes.json.XXXXXX")"
  TMP_FILES+=("$tmp")

  if command -v jq >/dev/null 2>&1; then
    jq -s '
      {
        nodes: (
          ((.[0].nodes // []) + (.[1].nodes // []))
          | sort_by(.ip, .last_seen)
          | group_by(.ip)
          | map(.[-1])
          | sort_by(.ip)
        )
      }
    ' "$NODES_FILE" "$incoming" >"$tmp"
  else
    python3 - "$NODES_FILE" "$incoming" "$tmp" <<'PY'
import json
import sys

existing_path, incoming_path, output_path = sys.argv[1:4]

def load(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        return []
    nodes = data.get("nodes", [])
    return nodes if isinstance(nodes, list) else []

by_ip = {}
for node in load(existing_path) + load(incoming_path):
    ip = node.get("ip")
    if not ip:
        continue
    previous = by_ip.get(ip)
    if previous is None or node.get("last_seen", "") >= previous.get("last_seen", ""):
        by_ip[ip] = node

with open(output_path, "w", encoding="utf-8") as handle:
    json.dump({"nodes": [by_ip[ip] for ip in sorted(by_ip)]}, handle, indent=2, sort_keys=False)
    handle.write("\n")
PY
  fi

  mv "$tmp" "$NODES_FILE"
  TMP_FILES=("${TMP_FILES[@]/$tmp}")
}

scan_subnet() {
  local cidr="$1"
  local incoming ip found=0

  incoming="$(mktemp "$CONFIG_DIR/discovered-scan.XXXXXX")"
  TMP_FILES+=("$incoming")
  printf '{"nodes":[' >"$incoming"

  log "scanning $cidr for SSH nodes"
  while IFS= read -r ip; do
    if probe_ssh "$ip"; then
      log "ssh open: $ip"
      if ((found > 0)); then
        printf ',' >>"$incoming"
      fi
      probe_capabilities "$ip" >>"$incoming"
      found=$((found + 1))
    fi
  done < <(cidr_to_ips "$cidr")

  printf ']}\n' >>"$incoming"
  merge_nodes "$incoming"
  log "scan complete: $found reachable SSH node(s)"
}

list_nodes() {
  ensure_nodes_file
  if command -v jq >/dev/null 2>&1; then
    jq . "$NODES_FILE"
  else
    python3 -m json.tool "$NODES_FILE"
  fi
}

parse_positive_int() {
  local value="$1"
  [[ "$value" =~ ^[0-9]+$ ]] && ((value > 0))
}

main() {
  local mode="scan"
  local cidr="$DEFAULT_CIDR"
  local interval="$DEFAULT_INTERVAL"

  while (($# > 0)); do
    case "$1" in
      --scan)
        mode="scan"
        if [[ -n "${2:-}" && "${2:0:1}" != "-" ]]; then
          cidr="$2"
          shift
        fi
        ;;
      --watch)
        mode="watch"
        if [[ -n "${2:-}" && "${2:0:1}" != "-" ]]; then
          cidr="$2"
          shift
        fi
        ;;
      --interval)
        if [[ -z "${2:-}" ]] || ! parse_positive_int "$2"; then
          log "--interval requires a positive integer"
          return 1
        fi
        interval="$2"
        shift
        ;;
      --list)
        mode="list"
        ;;
      --help|-h)
        usage
        return 0
        ;;
      *)
        log "unknown argument: $1"
        usage
        return 1
        ;;
    esac
    shift
  done

  check_prereqs

  case "$mode" in
    scan)
      scan_subnet "$cidr"
      ;;
    watch)
      log "watching $cidr every ${interval}s"
      while true; do
        scan_subnet "$cidr"
        sleep "$interval"
      done
      ;;
    list)
      list_nodes
      ;;
  esac
}

main "$@"
