# ChatGPT remote MCP

Atlas exposes `/api/mcp` for ChatGPT/OpenAI remote MCP access while preserving `mcp/server.js` for local Codex stdio MCP.

See `docs/CHATGPT_MCP.md` for setup and security. Public hosting requires `ATLAS_MCP_SECRET`; private Secure MCP Tunnel deployments may deliberately opt into tunnel-bound unauthenticated mode.
