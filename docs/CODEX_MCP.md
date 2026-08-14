# Atlas MCP v1 for Codex

Atlas exposes a local stdio MCP server so Codex can load canonical context and persist meaningful outcomes without direct database access.

## Tools

Read-only:
- `atlas_search`
- `atlas_context`
- `atlas_status`
- `atlas_projects`
- `atlas_tasks`

Write:
- `atlas_ingest`
- `atlas_remember`
- `atlas_create_task`
- `atlas_update_task`
- `atlas_update_project`

## Run locally

From the AtlasAITeacher repository:

```bash
npm install
DATABASE_URL='postgresql://...' ATLAS_USER_ID='default' npm run mcp:atlas
```

The server communicates over MCP stdio. Do not print application logs to stdout from the MCP process because stdout is reserved for JSON-RPC messages.

## Register in Codex

Codex reads MCP server definitions from its MCP configuration. A local stdio configuration is:

```toml
[mcp_servers.atlas]
command = "node"
args = ["/ABSOLUTE/PATH/TO/AtlasAITeacher/mcp/server.js"]
env = { DATABASE_URL = "postgresql://...", ATLAS_USER_ID = "default" }
```

Keep secrets out of Git. Prefer environment/secret management on the machine running Codex instead of committing credentials into repository files.

## Codex operating policy

1. Before significant Atlas/project work, call `atlas_context` with the project or goal.
2. Use `atlas_search`, `atlas_projects`, and `atlas_tasks` for canonical reads instead of guessing state.
3. Use `atlas_create_task`, `atlas_update_task`, and `atlas_update_project` instead of direct SQL.
4. After meaningful decisions, progress, or new durable information, call `atlas_ingest` or `atlas_remember`.
5. Do not send casual/transient content solely to create memory; Atlas Universal Ingestion performs classification and routing.
6. Treat write tools as mutations that may affect canonical state.

## Security boundary

The MCP server intentionally does not expose arbitrary SQL, shell execution, raw credentials, or unrestricted connector calls. Codex operates through semantic Atlas actions, preserving Atlas policy, provenance, deduplication, and auditability.

`atlas_update_task` accepts only the canonical task fields (title, description, status, priority, project, due date, schedule, and blocker). Omitted fields are preserved; nullable fields can be cleared with `null`. The operation enforces user ownership, rejects deleted tasks, validates status/priority/timestamps, and records the mutation through Universal Ingestion.

## Validation

Run:

```bash
npm run ci
```

CI validates JavaScript syntax, Universal Ingestion behavior, MCP tool annotations, and an actual MCP `initialize` + `tools/list` stdio handshake.
