# Register Atlas in ChatGPT

Current OpenAI product behavior requires a remote MCP endpoint for ChatGPT. After deploying Atlas or establishing Secure MCP Tunnel:

1. Enable Developer Mode in ChatGPT Settings > Apps > Advanced Settings (availability depends on plan/workspace).
2. Create a custom app and enter the Atlas MCP endpoint.
3. Configure the app authentication to match the deployment boundary.
4. Scan tools.
5. Verify read tools first: `atlas_status`, `atlas_projects`, `atlas_tasks`, `atlas_context`, `atlas_search`, `atlas_automation_status`.
6. Only enable/test write tools where the ChatGPT plan/workspace supports full MCP write/modify actions.

For Pro, expect read/fetch custom MCP permissions. Full write/modify MCP is currently Business/Enterprise/Edu.
