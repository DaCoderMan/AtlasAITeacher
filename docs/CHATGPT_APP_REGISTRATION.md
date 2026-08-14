# Register Atlas in ChatGPT

Current OpenAI product behavior requires a remote MCP endpoint for ChatGPT. For Atlas as currently implemented, use Secure MCP Tunnel for ChatGPT app registration. The public `/api/mcp` endpoint is suitable for authenticated smoke tests and non-ChatGPT clients, but not as a direct ChatGPT app while it relies on `ATLAS_MCP_SECRET`.

1. Enable Developer Mode in ChatGPT Settings > Apps > Advanced Settings (availability depends on plan/workspace).
2. Create a custom app.
3. Under Connection, choose Tunnel and select the Atlas tunnel ID.
4. Scan tools.
5. Verify read tools first: `atlas_status`, `atlas_projects`, `atlas_tasks`, `atlas_context`, `atlas_search`, `atlas_automation_status`.
6. Only enable/test write tools where the ChatGPT plan/workspace supports full MCP write/modify actions.

For Pro, expect read/fetch custom MCP permissions. Full write/modify MCP is currently Business/Enterprise/Edu.
