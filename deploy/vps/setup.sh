#!/usr/bin/env bash
# One-time VPS setup for SE Singha Paathai (Netcup or any Debian/Ubuntu VPS).
# Run as root AFTER you SSH in manually:  bash setup.sh
#
# Does NOT contain passwords or API keys — you create .env yourself.

set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:antonyanbu25/lionpath_V2.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/se-singha-paathai}"
DATA_DIR="${DATA_DIR:-/var/lib/se-paathai}"

echo "==> SE Singha Paathai VPS setup"
echo "    Install dir: ${INSTALL_DIR}"
echo "    Data dir:    ${DATA_DIR}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (or with sudo)." >&2
  exit 1
fi

echo "==> Installing Docker (if missing)..."
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "${VERSION_CODENAME:-$VERSION_ID}") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
else
  echo "    Docker already installed."
fi

echo "==> Cloning or updating repo..."
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  git -C "${INSTALL_DIR}" pull --ff-only
else
  git clone "${REPO_URL}" "${INSTALL_DIR}"
fi

echo "==> Preparing data directory..."
mkdir -p "${DATA_DIR}/history"
chmod 700 "${DATA_DIR}" "${DATA_DIR}/history"

echo "==> Configuring environment file..."
DEPLOY_DIR="${INSTALL_DIR}/deploy/vps"
if [[ ! -f "${DEPLOY_DIR}/.env" ]]; then
  cp "${DEPLOY_DIR}/.env.example" "${DEPLOY_DIR}/.env"
  chmod 600 "${DEPLOY_DIR}/.env"
  echo "    Created ${DEPLOY_DIR}/.env — EDIT IT NOW and set GEMINI_API_KEY."
else
  chmod 600 "${DEPLOY_DIR}/.env"
  echo "    .env already exists — skipped."
fi

echo "==> Firewall (ufw) — allow SSH, HTTP, HTTPS..."
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH || true
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw --force enable || true
fi

echo ""
echo "==> Setup complete. Next steps:"
echo "  1. Edit secrets:  nano ${DEPLOY_DIR}/.env"
echo "  2. Point DNS A records to this server IP:"
echo "       portal.benjaminsquare.com"
echo "       portalapi.benjaminsquare.com"
echo "  3. Start stack:     cd ${DEPLOY_DIR} && ./start.sh"
echo "  4. Verify:          curl -s https://portalapi.benjaminsquare.com/api/config | head"
echo ""
echo "See docs/VPS_DEPLOY.md for full instructions."
