#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

if [ "${1:-}" = "--yes" ]; then
  printf '%s\n' "Resetting mmaxr-infra containers and named volumes."
elif [ -t 0 ]; then
  printf '%s\n' "WARNING: This permanently deletes mmaxr-infra Postgres, Redis, and MinIO data."
  printf '%s' "Type RESET to continue: "
  IFS= read -r answer
  if [ "$answer" != "RESET" ]; then
    printf '%s\n' "Reset cancelled."
    exit 1
  fi
else
  printf '%s\n' "Refusing destructive reset without --yes on non-interactive input." >&2
  exit 1
fi

docker compose down --volumes --remove-orphans
