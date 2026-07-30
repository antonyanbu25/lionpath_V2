#!/usr/bin/env bash
# Start worker (8787), web (8788), and cloudflared tunnel for lion.benjaminsquare.com
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOKEN_FILE="$ROOT/scripts/mac/.tunnel-token"
LOG_DIR="$ROOT/logs"
SESSION="se-paathai"
MODE="${1:-}"

mkdir -p "$LOG_DIR"

read_tunnel_token() {
  if [[ -f "$TOKEN_FILE" ]]; then
    local token
    token="$(tr -d '[:space:]' < "$TOKEN_FILE")"
    if [[ -n "$token" && "$token" != "PASTE_YOUR_TUNNEL_TOKEN_HERE" ]]; then
      echo "$token"
      return 0
    fi
  fi
  return 1
}

require_tunnel_token() {
  local token
  if token="$(read_tunnel_token)"; then
    echo "$token"
    return 0
  fi

  echo "Tunnel token not found in $TOKEN_FILE"
  echo "Create it: cp scripts/mac/.tunnel-token.example scripts/mac/.tunnel-token"
  echo "Or paste token now (input hidden):"
  read -rs token
  echo
  if [[ -z "$token" ]]; then
    echo "Error: tunnel token is required." >&2
    exit 1
  fi
  echo "$token"
}

stop_services() {
  echo "Stopping SE Singha Paathai services..."

  if command -v tmux >/dev/null 2>&1; then
    tmux kill-session -t "$SESSION" 2>/dev/null || true
  fi

  for port in 8787 8788; do
    if lsof -ti :"$port" >/dev/null 2>&1; then
      lsof -ti :"$port" | xargs kill 2>/dev/null || true
    fi
  done

  pkill -f "cloudflared tunnel run" 2>/dev/null || true
  echo "Stopped."
}

start_background() {
  local token
  token="$(require_tunnel_token)"

  stop_services

  echo "Starting worker (8787)..."
  (cd "$ROOT/worker" && npm run dev) >"$LOG_DIR/worker.log" 2>&1 &
  echo $! >"$LOG_DIR/worker.pid"

  echo "Starting web (8788)..."
  (cd "$ROOT/web" && npx wrangler pages dev . --port 8788) >"$LOG_DIR/web.log" 2>&1 &
  echo $! >"$LOG_DIR/web.pid"

  sleep 3

  echo "Starting cloudflared tunnel..."
  cloudflared tunnel run --token "$token" >"$LOG_DIR/cloudflared.log" 2>&1 &
  echo $! >"$LOG_DIR/cloudflared.pid"

  echo ""
  echo "All services started in background."
  echo "  Web:  https://lion.benjaminsquare.com  (local http://localhost:8788)"
  echo "  API:  https://api.lion.benjaminsquare.com  (local http://localhost:8787)"
  echo "  Logs: $LOG_DIR/"
  echo "  Stop: $0 --stop"
}

start_tmux() {
  local token
  token="$(require_tunnel_token)"

  if ! command -v tmux >/dev/null 2>&1; then
    echo "tmux not found. Install with: brew install tmux"
    echo "Falling back to background mode..."
    start_background
    return
  fi

  tmux kill-session -t "$SESSION" 2>/dev/null || true

  tmux new-session -d -s "$SESSION" -n services \
    "cd \"$ROOT/worker\" && echo '=== Worker :8787 ===' && npm run dev"

  tmux split-window -h -t "$SESSION" \
    "cd \"$ROOT/web\" && echo '=== Web :8788 ===' && npx wrangler pages dev . --port 8788"

  tmux split-window -v -t "$SESSION" \
    "echo '=== cloudflared tunnel ===' && cloudflared tunnel run --token \"$token\""

  tmux select-layout -t "$SESSION" even-horizontal

  echo ""
  echo "tmux session '$SESSION' started."
  echo "  Attach:  tmux attach -t $SESSION"
  echo "  Detach:  Ctrl+b then d"
  echo "  Stop:    $0 --stop"
  echo ""
  echo "  Web:  https://lion.benjaminsquare.com"
  echo "  API:  https://api.lion.benjaminsquare.com"
  echo ""

  tmux attach -t "$SESSION"
}

case "$MODE" in
  --stop)
    stop_services
    ;;
  --background|-b)
    start_background
    ;;
  --help|-h)
    echo "Usage: $0 [--background | --stop]"
    echo ""
    echo "  (no args)     Start in tmux (default)"
    echo "  --background  Start in background, logs in logs/"
    echo "  --stop        Stop worker, web, cloudflared, and tmux session"
    ;;
  "")
    start_tmux
    ;;
  *)
    echo "Unknown option: $MODE" >&2
    echo "Run $0 --help" >&2
    exit 1
    ;;
esac
