#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# DnsConf UI — one-command start for macOS and Linux.
#
#   ./docker-start.sh
#
# Builds and starts the app with Docker. There is nothing to fill in.
# ---------------------------------------------------------------------------
set -e

cd "$(dirname "$0")"

say() { printf '%s\n' "$1"; }

# --- 1. is Docker there and running? ---------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  say "Docker is not installed."
  say "Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
  say "and run this script again."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  say "Docker is installed but not running."
  say "Start Docker Desktop, wait until it says it is running, then try again."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  say "Docker Compose was not found. Please update Docker Desktop."
  exit 1
fi

# --- 2. build and run -------------------------------------------------------
# .env is optional and carries nothing but HOST_PORT, so there is no file to create here: without one the app
# serves on 3000, which is what the default below says. The pipeline ends in `tr`, so a missing file is not an
# error to `set -e` either.
HOST_PORT=$({ [ -f .env ] && grep -E '^HOST_PORT=' .env; } | head -n 1 | cut -d= -f2- | tr -d '[:space:]' | tr -d '\r')
[ -z "$HOST_PORT" ] && HOST_PORT=3000

say ""
say "Building and starting DnsConf UI (the first build takes a few minutes)..."
say ""
if ! $COMPOSE up --build -d; then
  say ""
  say "Startup failed. The output above says why."
  say "Full log:  $COMPOSE logs"
  exit 1
fi

say ""
say "DnsConf UI is running at http://localhost:$HOST_PORT"
say ""
say "  logs:  $COMPOSE logs -f"
say "  stop:  $COMPOSE down"
