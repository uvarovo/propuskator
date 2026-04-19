#!/usr/bin/env bash
# Propuskator one-shot installer for a fresh Linux machine.
#
# What it does (idempotent):
#   1. Installs docker (+ compose plugin) via the official get.docker.com script
#      if docker is missing.
#   2. Adds the invoking user to the `docker` group (requires re-login).
#   3. Copies .env.sample -> .env and .env_modbus.sample -> .env_modbus on
#      first run, so you can edit real values before bringing services up.
#   4. Creates the system/ subdirectories that bind-mount volumes expect.
#   5. Runs `docker compose pull && docker compose up -d` for the selected
#      compose profile.
#
# Usage:
#   ./install.sh              # main stack (docker-compose.yml)
#   ./install.sh modbus       # main + modbus bridge
#   ./install.sh modbus certs # + custom uvarovo.net SSL override
#   ./install.sh all          # everything (main + modbus + phones + telegram-bot + google-home)
#
# Tested on Ubuntu 20.04 / 22.04 / 24.04. For other distros it relies on the
# upstream get.docker.com installer, which supports Debian/CentOS/Fedora/Rocky.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log() { printf '\033[1;34m[propuskator]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[propuskator]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[propuskator]\033[0m %s\n' "$*" >&2; exit 1; }

need_sudo() {
  if [ "$(id -u)" -eq 0 ]; then echo ""; else echo "sudo"; fi
}
SUDO="$(need_sudo)"

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "docker + compose plugin already installed ($(docker --version))"
    return 0
  fi
  log "Installing docker via get.docker.com …"
  if ! command -v curl >/dev/null 2>&1; then
    $SUDO apt-get update -qq && $SUDO apt-get install -y -qq curl ca-certificates || \
      die "Failed to install curl. Please install curl and re-run."
  fi
  curl -fsSL https://get.docker.com | $SUDO sh
  if ! docker compose version >/dev/null 2>&1; then
    # On some distros get.docker.com installs docker-compose-plugin automatically;
    # if not, try apt.
    $SUDO apt-get install -y docker-compose-plugin || true
  fi
  log "Enabling docker service on boot …"
  $SUDO systemctl enable --now docker || true
  if [ "$(id -u)" -ne 0 ]; then
    log "Adding $USER to docker group (re-login required for changes to apply)"
    $SUDO usermod -aG docker "$USER" || true
  fi
}

bootstrap_env() {
  if [ ! -f .env ]; then
    log "Creating .env from .env.sample — EDIT IT before bringing services up in production"
    cp .env.sample .env
  else
    log ".env already exists; leaving untouched"
  fi
  if [ ! -f .env_modbus ] && [ -f .env_modbus.sample ]; then
    cp .env_modbus.sample .env_modbus
    log "Created .env_modbus from sample"
  fi
  # ROOT_DIR should be absolute for bind-mounts
  if ! grep -qE '^ROOT_DIR=' .env || grep -qE '^ROOT_DIR=\.$' .env; then
    sed -i "s|^ROOT_DIR=.*|ROOT_DIR=${SCRIPT_DIR}|" .env
    log "Set ROOT_DIR=${SCRIPT_DIR} in .env"
  fi
}

ensure_dirs() {
  for d in \
    system/mysql \
    system/minio \
    system/media \
    system/storage \
    system/backups \
    system/keys \
    system/releases \
    system/shared/nginx \
    system/ssl/certs \
    system/ssl/private \
    system/emqx/data/mnesia \
    system/updater \
    system/google-home/config/google
  do
    mkdir -p "$d"
  done
  log "Volume directories ready under system/"
}

build_compose_args() {
  ARGS=(-f docker-compose.yml)
  for profile in "$@"; do
    case "$profile" in
      modbus)       ARGS+=(-f docker-compose.modbus.yml) ;;
      certs)        ARGS+=(-f docker-compose.certs.yml) ;;
      phones)       ARGS+=(-f docker-compose.phones.yml) ;;
      telegram-bot|telegram) ARGS+=(-f docker-compose.telegram-bot.yml) ;;
      google-home|ghome) ARGS+=(-f docker-compose.google-home.yml) ;;
      all)
        ARGS+=(-f docker-compose.modbus.yml -f docker-compose.phones.yml -f docker-compose.telegram-bot.yml -f docker-compose.google-home.yml)
        ;;
      *) warn "Unknown profile '$profile' — ignoring" ;;
    esac
  done
}

run_compose() {
  build_compose_args "$@"
  log "docker compose ${ARGS[*]} pull"
  docker compose "${ARGS[@]}" pull
  log "docker compose ${ARGS[*]} up -d"
  docker compose "${ARGS[@]}" up -d
  log ""
  log "All services brought up. Status:"
  docker compose "${ARGS[@]}" ps
  log ""
  log "UI:   http://<this-host>/   (or https://<this-host>/ if you configured certs)"
  log "API:  http://<this-host>:8000/api/v1/admin/"
  log ""
  log "To tail logs:  docker compose ${ARGS[*]} logs -f"
  log "To stop:       docker compose ${ARGS[*]} down"
}

main() {
  install_docker
  bootstrap_env
  ensure_dirs
  run_compose "$@"
}

main "$@"
