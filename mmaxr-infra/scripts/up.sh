#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

if [ ! -f .env ]; then
  printf '%s\n' "Missing .env. Copy .env.example to .env and edit local values first." >&2
  exit 1
fi

docker compose config --quiet
docker compose up -d --wait
docker compose ps
