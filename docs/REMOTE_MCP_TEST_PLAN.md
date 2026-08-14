# Remote MCP acceptance checks

- GET `/api/mcp` returns Atlas MCP health metadata.
- unauthenticated public POST fails closed.
- authenticated `initialize` succeeds.
- `tools/list` exposes the Atlas tool surface.
- safe read calls reach live Neon.
- ChatGPT tool scan succeeds through deployed HTTPS or Secure MCP Tunnel.
- reconnect works in a fresh ChatGPT conversation.
