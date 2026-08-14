# ChatGPT remote MCP

Atlas exposes `/api/mcp` for authenticated remote MCP smoke tests and non-ChatGPT clients while preserving `mcp/server.js` for local Codex stdio MCP.

See `docs/CHATGPT_MCP.md` for setup and security. Public hosting requires `ATLAS_MCP_SECRET`; ChatGPT app registration should use Secure MCP Tunnel unless Atlas later adds a supported OAuth flow for `/api/mcp`.
