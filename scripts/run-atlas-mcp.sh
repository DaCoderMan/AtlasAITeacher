#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
load_env_file() { local f="$1"; [[ -f "$f" ]] || return 1; set -a; source "$f"; set +a; }
is_placeholder() { local v="${1:-}"; [[ -z "$v" || "$v" == "[SENSITIVE]" || "$v" == "base" ]]; }
if is_placeholder "${DATABASE_URL:-}"; then
  if [[ -n "${ATLAS_ENV_FILE:-}" ]]; then load_env_file "$ATLAS_ENV_FILE" || true; fi
  if is_placeholder "${DATABASE_URL:-}"; then load_env_file "$HOME/.config/atlas/atlas-mcp.env" || true; fi
fi
if is_placeholder "${DATABASE_URL:-}"; then
  echo "Atlas MCP requires a real DATABASE_URL. Configure ATLAS_ENV_FILE or ~/.config/atlas/atlas-mcp.env." >&2
  exit 1
fi
export ATLAS_USER_ID="${ATLAS_USER_ID:-default}"
exec node "$REPO_ROOT/mcp/server.js"
