#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

load_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    set -a && source "$env_file" && set +a
    return 0
  fi
  return 1
}

is_placeholder_secret() {
  local value="${1:-}"
  [[ -z "$value" || "$value" == "[SENSITIVE]" || "$value" == "base" ]]
}

if is_placeholder_secret "${DATABASE_URL:-}"; then
  if [[ -n "${ATLAS_ENV_FILE:-}" ]]; then
    load_env_file "$ATLAS_ENV_FILE"
  else
    for candidate in \
      "$REPO_ROOT/.env.local" \
      "$REPO_ROOT/.env.production" \
      "/mnt/SEAGATE_DATA/Projects/Huge Collective/atlas-api/.env.local" \
      "/mnt/SEAGATE_DATA/Projects/Huge Collective/atlas-api/.env.production" \
      "/mnt/SEAGATE_DATA/Projects/Huge Collective/atlas-api/.env.atlas.production"
    do
      load_env_file "$candidate" || true
      if ! is_placeholder_secret "${DATABASE_URL:-}"; then
        break
      fi
    done
  fi
fi

if is_placeholder_secret "${DATABASE_URL:-}"; then
  cat >&2 <<'EOF'
Atlas MCP requires a real DATABASE_URL, but only a placeholder value was found.
Set DATABASE_URL in the current environment or point ATLAS_ENV_FILE at a local env file
that contains the real Atlas Neon connection string.
EOF
  exit 1
fi

export ATLAS_USER_ID="${ATLAS_USER_ID:-default}"

exec node "$REPO_ROOT/mcp/server.js"
