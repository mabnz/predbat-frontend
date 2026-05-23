#!/usr/bin/env bash
#
# Install Predbat Frontend as a systemd service on Ubuntu.
#
# Usage:
#   sudo ./scripts/install-service.sh [user]
#
# Defaults:
#   user                = current invoking user ($SUDO_USER or $USER)
#   install directory   = /opt/predbat-frontend
#   service name        = predbat-frontend@<user>.service
#
set -euo pipefail

SERVICE_USER="${1:-${SUDO_USER:-$USER}}"
INSTALL_DIR="/opt/predbat-frontend"
SERVICE_NAME="predbat-frontend@${SERVICE_USER}.service"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Please run with sudo." >&2
  exit 1
fi

echo "==> Installing to ${INSTALL_DIR} as user ${SERVICE_USER}"

mkdir -p "${INSTALL_DIR}"
rsync -a --delete \
  --exclude='.git/' \
  --exclude='.venv/' \
  --exclude='__pycache__/' \
  --exclude='.DS_Store' \
  "${SOURCE_DIR}/" "${INSTALL_DIR}/"

if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  if [[ -f "${INSTALL_DIR}/.env.example" ]]; then
    cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
    echo "==> Created ${INSTALL_DIR}/.env from example; edit before starting."
  else
    echo "==> WARNING: No .env file found; create ${INSTALL_DIR}/.env before starting."
  fi
fi

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

echo "==> Creating virtual environment"
sudo -u "${SERVICE_USER}" python3 -m venv "${INSTALL_DIR}/.venv"
sudo -u "${SERVICE_USER}" "${INSTALL_DIR}/.venv/bin/pip" install --upgrade pip
sudo -u "${SERVICE_USER}" "${INSTALL_DIR}/.venv/bin/pip" install -r "${INSTALL_DIR}/requirements.txt"

echo "==> Installing systemd unit"
install -m 0644 "${SOURCE_DIR}/systemd/predbat-frontend@.service" \
  /etc/systemd/system/predbat-frontend@.service

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo
echo "==> Service status:"
systemctl --no-pager --full status "${SERVICE_NAME}" || true

echo
echo "Done. View logs with:"
echo "  journalctl -u ${SERVICE_NAME} -f"
