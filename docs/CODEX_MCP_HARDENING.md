# Codex MCP hardening

The verified local Codex setup uses `scripts/run-atlas-mcp.sh` and keeps the live Neon connection outside Git in `~/.config/atlas/atlas-mcp.env` (or another path supplied through `ATLAS_ENV_FILE`).

The launcher uses an absolute path to `mcp/server.js`, refuses placeholder/missing `DATABASE_URL` values, and defaults `ATLAS_USER_ID` to `default`.

Recommended follow-up: use a Neon connection string configured for certificate verification (`sslmode=verify-full`) where supported by the deployment environment, and include a live `atlas_status` smoke test in host provisioning/health checks.
