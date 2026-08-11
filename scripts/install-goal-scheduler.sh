#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
INSTALL_DIR="/root/.hermes/scripts"
SERVICE_NAME="gideon-goal-scheduler.service"

install -d -m 755 "${INSTALL_DIR}"

install -m 755 \
  "${REPO_ROOT}/scripts/goal-scheduler-daemon.sh" \
  "${REPO_ROOT}/scripts/goal-queue.sh" \
  "${REPO_ROOT}/scripts/goal-decompose.sh" \
  "${REPO_ROOT}/scripts/goal-schedule.sh" \
  "${INSTALL_DIR}/"

install -m 644 \
  "${REPO_ROOT}/etc/systemd/system/${SERVICE_NAME}" \
  "/etc/systemd/system/${SERVICE_NAME}"

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"

echo "Installed and started ${SERVICE_NAME}."
systemctl status "${SERVICE_NAME}"
