#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# DnsConf UI — one-command start for macOS and Linux.
#
#   ./docker-start.sh
#
# Creates .env on first run, asks for your GitHub Client ID if it is still
# empty, then builds and starts the app with Docker.
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

# --- 2. make sure .env exists ----------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  say "Created .env from .env.example"
fi

# --- 3. make sure the Client ID is filled in -------------------------------
CLIENT_ID=$(grep -E '^NEXT_PUBLIC_GITHUB_CLIENT_ID=' .env | head -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r')

if [ -z "$CLIENT_ID" ]; then
  say ""
  say "A GitHub OAuth App Client ID is needed (one-time setup):"
  say "  1. open https://github.com/settings/developers"
  say "  2. New OAuth App -> any name, homepage http://localhost:3000"
  say "  3. after creating it, tick 'Enable Device Flow' and save"
  say "  4. copy the Client ID and paste it below"
  say ""
  printf 'Client ID: '
  read -r CLIENT_ID
  CLIENT_ID=$(printf '%s' "$CLIENT_ID" | tr -d '[:space:]')

  if [ -z "$CLIENT_ID" ]; then
    say "No Client ID entered. Put it into .env manually and run this script again."
    exit 1
  fi

  # Rewrite the line in .env without touching the rest of the file.
  tmp=$(mktemp)
  sed "s|^NEXT_PUBLIC_GITHUB_CLIENT_ID=.*|NEXT_PUBLIC_GITHUB_CLIENT_ID=$CLIENT_ID|" .env > "$tmp"
  mv "$tmp" .env
  say "Saved to .env"
fi

# --- 4. build and run -------------------------------------------------------
HOST_PORT=$(grep -E '^HOST_PORT=' .env | head -n 1 | cut -d= -f2- | tr -d '[:space:]' | tr -d '\r')
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
