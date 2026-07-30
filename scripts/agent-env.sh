#!/usr/bin/env bash
# Source this before node/npm/npx in agent shells and CI.
#   source scripts/agent-env.sh
#
# No `set -e` here: these options would leak into the caller's interactive shell,
# where any later non-zero command would kill the session.

_agent_env_script_dir() {
  if [[ -n "${BASH_SOURCE[0]+x}" ]]; then
    cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
  elif [[ -n "${ZSH_VERSION+set}" ]]; then
    cd "$(dirname "${(%):-%x}")" && pwd
  else
    cd "$(dirname "$0")" && pwd
  fi
}

ROOT="$(cd "$(_agent_env_script_dir)/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/ensure-node.sh"

export PATH="$ROOT/.tools/node/bin:$PATH"
export LIONPATH_NODE_HOME="$ROOT/.tools/node"
