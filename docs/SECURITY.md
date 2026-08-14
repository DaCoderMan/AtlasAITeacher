# Atlas security boundary

- Never commit `DATABASE_URL`, MCP bearer secrets, connector tokens, or local env files.
- Public `/api/mcp` fails closed unless `ATLAS_MCP_SECRET` is configured.
- `ATLAS_MCP_ALLOW_UNAUTHENTICATED=true` is intended only behind a trusted private transport such as Secure MCP Tunnel; never enable it on a public deployment.
- HTTP ingestion and workers use separate secrets from MCP when configured.
- Atlas MCP exposes semantic tools, not arbitrary SQL, shell access, or raw credentials.
- Sensitive/high-impact routing remains policy- and review-gated.
