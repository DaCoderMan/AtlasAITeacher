# Remote MCP deployment target

Preferred options, in order:

1. OpenAI Secure MCP Tunnel from the Atlas host when available, keeping Atlas private.
2. Existing Vercel deployment with `/api/mcp` over HTTPS and `ATLAS_MCP_SECRET` configured.
3. Another HTTPS host with equivalent secret management.

Never expose a no-auth Atlas MCP endpoint to the public internet.
