#!/usr/bin/env bash
# Git / GitHub auth diagnostics for VPS deploy (run from deploy/vps or repo root).
set -euo pipefail

REPO_ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_ROOT"

echo "=== Repository ==="
echo "Path: $REPO_ROOT"
echo "Branch (local): $(git branch --show-current 2>/dev/null || echo unknown)"
echo "HEAD: $(git log -1 --oneline 2>/dev/null || echo unknown)"

echo ""
echo "=== git remote -v ==="
git remote -v 2>/dev/null || echo "(no remotes)"

echo ""
echo "=== URL rewrites (global) ==="
git config --global --get-regexp '^url\.' 2>/dev/null || echo "(none)"

echo ""
echo "=== URL rewrites (local) ==="
git config --local --get-regexp '^url\.' 2>/dev/null || echo "(none)"

echo ""
echo "=== credential helpers ==="
git config --global --get-regexp '^credential\.' 2>/dev/null || echo "(none global)"
git config --system --get-regexp '^credential\.' 2>/dev/null || echo "(none system)"

ORIGIN_URL="$(git remote get-url origin 2>/dev/null || echo "")"
echo ""
echo "=== origin URL: ${ORIGIN_URL:-missing} ==="

if [[ "$ORIGIN_URL" == git@github.com:* ]] || [[ "$ORIGIN_URL" == git@* ]]; then
  echo ""
  echo "=== ssh -T git@github.com ==="
  ssh -o BatchMode=yes -o ConnectTimeout=15 -T git@github.com 2>&1 || true
  echo ""
  echo "=== git ls-remote origin 2.0.7.2 ==="
  git ls-remote origin refs/heads/2.0.7.2 2>&1 | head -3 || true
  echo ""
  echo "=== git ls-remote git@github.com:skut264/lionpath.git 2.0.7.2 (direct SSH) ==="
  git ls-remote git@github.com:skut264/lionpath.git refs/heads/2.0.7.2 2>&1 | head -3 || true
else
  echo ""
  echo "=== git ls-remote origin 2.0.7.2 (HTTPS — needs PAT for private repo) ==="
  git ls-remote origin refs/heads/2.0.7.2 2>&1 | head -3 || true
fi

echo ""
echo "=== Deploy marker in web/index.html ==="
grep -E 'portal-build|precall.css\?v=' web/index.html 2>/dev/null | head -3 || echo "(file missing or no markers)"
