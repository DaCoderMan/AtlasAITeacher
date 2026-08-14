# Atlas MCP for ChatGPT

Atlas now supports two MCP transports over the same semantic tool surface:

- local stdio MCP (`mcp/server.js`) for Codex on the Atlas host;
- remote HTTP MCP (`/api/mcp`) for ChatGPT/OpenAI products.

## ChatGPT requirement

ChatGPT cannot connect directly to the local stdio server. Use either a deployed HTTPS `/api/mcp` endpoint or OpenAI Secure MCP Tunnel to make a private/local Atlas MCP reachable without exposing the host directly.

## Security

Public hosting fails closed unless `ATLAS_MCP_SECRET` is configured. The endpoint expects `Authorization: Bearer <ATLAS_MCP_SECRET>`.

For a private Secure MCP Tunnel deployment, `ATLAS_MCP_ALLOW_UNAUTHENTICATED=true` may be used only when the tunnel itself provides the trusted boundary. Never enable this on a public endpoint.

## ChatGPT setup

1. Deploy Atlas with `DATABASE_URL`, `ATLAS_USER_ID`, and `ATLAS_MCP_SECRET` configured, or create a Secure MCP Tunnel to the Atlas MCP service.
2. Enable Developer Mode in ChatGPT.
3. Create a custom app and provide the remote MCP endpoint.
4. Scan tools and verify Atlas tools are discovered.
5. Run safe read tests: `atlas_status`, `atlas_projects`, `atlas_tasks`, `atlas_context`, and `atlas_search`.

Plan restrictions matter: current ChatGPT Pro custom MCP access is read/fetch only. Full write/modify MCP is currently available to Business and Enterprise/Edu workspaces. Atlas keeps write tools defined for compatible clients and future plan upgrades, while read tools remain immediately useful on Pro.

## Automatic conversation ingestion

An MCP app gives ChatGPT access to Atlas tools; it does not create a guaranteed product-level firehose of every ChatGPT or Voice session. Automatic ingestion therefore uses the best available supported path:

- meaningful conversations can call `atlas_enqueue` / `atlas_ingest` when tool permissions allow;
- accessible ChatGPT/Voice transcripts can be posted to `/api/source-events` with source type `chatgpt` or `chatgpt_voice`;
- periodic exports/imports can be dropped into the Atlas Inbox as a reconciliation fallback.

Raw ChatGPT Voice audio must not be assumed accessible. Atlas ingests transcript/session records when an upstream source provides them.
