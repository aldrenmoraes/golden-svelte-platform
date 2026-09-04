#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${1:-}" == "--confirm" ]] || { printf 'Usage: ./scripts/prod.sh --confirm\n' >&2; exit 2; }
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
env_file="${ENV_FILE:-.env.prod}"
[[ -f "$env_file" ]] || { printf 'Missing %s.\n' "$env_file" >&2; exit 1; }
compose=(docker compose --env-file "$env_file" -f compose.yaml -f compose.prod.yaml)
"${compose[@]}" config --quiet
"${compose[@]}" pull
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --wait --remove-orphans
"${compose[@]}" ps
