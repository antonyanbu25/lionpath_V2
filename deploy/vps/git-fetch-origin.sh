#!/usr/bin/env bash
# Fetch origin for VPS deploy — SSH private repo, bypasses insteadOf HTTPS rewrites.
# Usage: git-fetch-origin.sh [REPO_ROOT] [BRANCH]
set -euo pipefail

REPO_ROOT="${1:-.}"
BRANCH="${2:-2.0.7.4}"

cd "$REPO_ROOT"

print_git_auth_help() {
  cat >&2 <<'EOF'
GitHub no longer accepts account passwords for git fetch.

Recommended fix — SSH deploy key (read-only):

  ssh-keygen -t ed25519 -C "vps-lionpath-deploy" -f /root/.ssh/lionpath_deploy -N ""
  cat /root/.ssh/lionpath_deploy.pub
  # GitHub → antonyanbu25/lionpath_V2 → Settings → Deploy keys → Add (Allow read)

  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  cat >> /root/.ssh/config <<'CFG'
Host github.com
  HostName github.com
  User git
  IdentityFile /root/.ssh/lionpath_deploy
  IdentitiesOnly yes
CFG
  chmod 600 /root/.ssh/config

  git remote set-url origin git@github.com:antonyanbu25/lionpath_V2.git
  ssh -T git@github.com
  cd /opt/se-singha-paathai/deploy/vps && bash update.sh

If origin is SSH but fetch prompts for https://github.com password, remove the rewrite:

  git config --global --unset-all url.https://github.com/.insteadOf || true

See docs/VPS_DEPLOY.md § Git authentication (private repo).
EOF
}

ORIGIN_URL="$(git remote get-url origin 2>/dev/null || echo "")"
if [[ -z "$ORIGIN_URL" ]]; then
  echo "ERROR: No git remote 'origin'." >&2
  print_git_auth_help
  exit 1
fi

echo "=== Git origin: $ORIGIN_URL ==="

GLOBAL_REWRITES="$(git config --global --get-regexp '^url\.' 2>/dev/null || true)"
LOCAL_REWRITES="$(git config --local --get-regexp '^url\.' 2>/dev/null || true)"
if [[ -n "$GLOBAL_REWRITES" || -n "$LOCAL_REWRITES" ]]; then
  echo "=== Git URL rewrites (can force SSH → HTTPS) ==="
  [[ -n "$GLOBAL_REWRITES" ]] && echo "$GLOBAL_REWRITES"
  [[ -n "$LOCAL_REWRITES" ]] && echo "$LOCAL_REWRITES"
  if [[ "$ORIGIN_URL" == git@github.com:* ]] && echo "${GLOBAL_REWRITES}${LOCAL_REWRITES}" | grep -q 'insteadOf.*git@github.com'; then
    echo "WARN: insteadOf rewrite detected — fetch will use direct SSH URL to bypass it." >&2
  fi
fi

# Direct SSH URL avoids `git fetch origin` when insteadOf rewrites git@ → https://
SSH_FETCH_URL="git@github.com:antonyanbu25/lionpath_V2.git"
if [[ "$ORIGIN_URL" == git@github.com:* ]]; then
  SSH_FETCH_URL="$ORIGIN_URL"
fi

is_ssh_origin() {
  [[ "$1" == git@* ]] || [[ "$1" == ssh://* ]]
}

probe_remote_branch() {
  local url="$1"
  git ls-remote "$url" "refs/heads/$BRANCH" 2>/dev/null | awk '{print $1}' | head -1
}

if is_ssh_origin "$ORIGIN_URL"; then
  echo "=== SSH auth probe (github.com) ==="
  SSH_TEST="$(ssh -o BatchMode=yes -o ConnectTimeout=15 -T git@github.com 2>&1 || true)"
  echo "$SSH_TEST" | head -3
  if ! echo "$SSH_TEST" | grep -qiE 'successfully authenticated|^Hi '; then
    echo "ERROR: SSH authentication to GitHub failed." >&2
    print_git_auth_help
    exit 1
  fi

  REMOTE_SHA="$(probe_remote_branch "$SSH_FETCH_URL")"
  if [[ -z "$REMOTE_SHA" ]]; then
    echo "ERROR: Branch $BRANCH not found at $SSH_FETCH_URL (or no read access)." >&2
    print_git_auth_help
    exit 1
  fi
  echo "=== Remote $BRANCH @ ${REMOTE_SHA:0:12} ==="

  echo "=== Fetching $SSH_FETCH_URL ($BRANCH) ==="
  # Write directly to origin/BRANCH — bypasses origin remote + insteadOf
  git fetch "$SSH_FETCH_URL" "$BRANCH:refs/remotes/origin/$BRANCH"
else
  echo "=== HTTPS origin — probing refs/heads/$BRANCH ==="
  REMOTE_SHA="$(probe_remote_branch origin)"
  if [[ -z "$REMOTE_SHA" ]]; then
    echo "ERROR: Cannot read origin/$BRANCH (private repo needs a token or SSH)." >&2
    echo "Switch to SSH: git remote set-url origin git@github.com:antonyanbu25/lionpath_V2.git" >&2
    print_git_auth_help
    exit 1
  fi
  echo "=== Remote $BRANCH @ ${REMOTE_SHA:0:12} ==="

  echo "=== Fetching origin ($BRANCH) ==="
  if ! git fetch origin "$BRANCH"; then
    echo "ERROR: git fetch origin failed." >&2
    print_git_auth_help
    exit 1
  fi
fi

LOCAL_SHA="$(git rev-parse "refs/remotes/origin/$BRANCH" 2>/dev/null || echo "")"
if [[ -z "$LOCAL_SHA" ]]; then
  echo "ERROR: refs/remotes/origin/$BRANCH missing after fetch." >&2
  exit 1
fi
echo "=== Fetched origin/$BRANCH @ ${LOCAL_SHA:0:12} ==="
