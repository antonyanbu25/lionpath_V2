#!/usr/bin/env bash
# Install a portable Node.js toolchain into .tools/node (gitignored).
# Idempotent — safe to run on every shell/agent session.
#
# Safe to `source`: no top-level `exit` and no shell options leak into the caller.
# The install runs in a subshell so `set -e` and failures stay contained.

_lionpath_script_dir() {
  if [[ -n "${BASH_SOURCE[0]+x}" ]]; then
    cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
  elif [[ -n "${ZSH_VERSION+set}" ]]; then
    cd "$(dirname "${(%):-%x}")" && pwd
  else
    cd "$(dirname "$0")" && pwd
  fi
}

LIONPATH_ROOT="$(cd "$(_lionpath_script_dir)/.." && pwd)"
LIONPATH_NODE_HOME="$LIONPATH_ROOT/.tools/node"
LIONPATH_NODE_BIN="$LIONPATH_NODE_HOME/bin/node"

if [[ ! -x "$LIONPATH_NODE_BIN" ]]; then
  (
    set -euo pipefail

    TOOLS_DIR="$LIONPATH_ROOT/.tools"
    NODE_HOME="$LIONPATH_NODE_HOME"
    NODE_VERSION="${LIONPATH_NODE_VERSION:-22.22.1}"

    case "$(uname -s)-$(uname -m)" in
      Darwin-arm64) NODE_ARCH="arm64" ;;
      Darwin-x86_64) NODE_ARCH="x64" ;;
      Linux-x86_64) NODE_ARCH="x64" ;;
      Linux-aarch64|Linux-arm64) NODE_ARCH="arm64" ;;
      *)
        echo "ensure-node: unsupported platform $(uname -s)-$(uname -m)" >&2
        exit 1
        ;;
    esac

    OS_NAME="linux"
    [[ "$(uname -s)" == "Darwin" ]] && OS_NAME="darwin"

    TARBALL="node-v${NODE_VERSION}-${OS_NAME}-${NODE_ARCH}.tar.gz"
    URL="https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}"
    TMP="$TOOLS_DIR/.download-$$"

    mkdir -p "$TOOLS_DIR"
    rm -rf "$TMP"
    mkdir -p "$TMP"

    echo "ensure-node: installing Node ${NODE_VERSION} (${NODE_ARCH}) into .tools/node …" >&2
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$URL" -o "$TMP/$TARBALL"
    elif command -v wget >/dev/null 2>&1; then
      wget -qO "$TMP/$TARBALL" "$URL"
    else
      echo "ensure-node: need curl or wget to download Node" >&2
      exit 1
    fi

    tar -xzf "$TMP/$TARBALL" -C "$TMP"
    EXTRACTED="$TMP/node-v${NODE_VERSION}-${OS_NAME}-${NODE_ARCH}"
    rm -rf "$NODE_HOME"
    mv "$EXTRACTED" "$NODE_HOME"
    rm -rf "$TMP"

    echo "ensure-node: ready — $("$NODE_HOME/bin/node" -v), npm $("$NODE_HOME/bin/npm" -v)" >&2
  ) || echo "ensure-node: install failed — node may be unavailable" >&2
fi
