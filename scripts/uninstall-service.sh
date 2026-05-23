#!/usr/bin/env bash
#
# Uninstall the Predbat Frontend systemd service.
#
# Usage:
#   sudo ./scripts/uninstall-service.sh [user]
#
set -euo pipefail

SERVICE_USER="${1:-${SUDO_USER:-$USER}}"
SERVICE_NAME="predbat-frontend@${SERVICE_USER}.service"
INSTALL_DIR="/opt/predbat-frontend"

if [[ $EUID -ne 0 ]]; then
  echo "Please run with sudo." >&2
  exit 1
fi

systemctl stop "${SERVICE_NAME}" || true
systemctl disable "${SERVICE_NAME}" || true
rm -f /etc/systemd/system/predbat-frontend@.service
systemctl daemon-reload

echo "Service stopped, disabled, and unit file removed."
echo "Files in ${INSTALL_DIR} were NOT deleted. Remove manually if desired."
