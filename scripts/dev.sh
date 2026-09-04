#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
env_file="${ENV_FILE:-.env.dev}"
[[ -f "$env_file" ]] || { printf 'Missing %s. Copy .env.dev.example first.\n' "$env_file" >&2; exit 1; }
exec docker compose --env-file "$env_file" -f compose.yaml -f compose.dev.yaml up --build --remove-orphans "$@"
