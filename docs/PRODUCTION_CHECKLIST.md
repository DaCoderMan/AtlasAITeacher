# Atlas production activation checklist

- Codex local MCP verified.
- Remote `/api/mcp` deployed or Secure MCP Tunnel active.
- `ATLAS_RELEASE_GATE_MODE=enforce` configured for the dedicated production MCP deployment.
- `ATLAS_RELEASE_GATE_TESTS` and `ATLAS_RELEASE_GATE_TESTED_AT` set for the promoted production deployment.
- `ATLAS_MCP_SECRET` configured for public hosting.
- ChatGPT Developer Mode app created and tools scanned.
- Read tools tested from ChatGPT.
- Automation daemon and file watcher enabled on Atlas host.
- Queue/source health checked with `atlas_automation_status`.
- `npm run smoke:atlas` passes with live Neon.
- Neon TLS uses certificate verification where supported.
- External destination executors configured and tested individually.
- ChatGPT/Voice and WhatsApp upstream feeds activated where supported.
- Reconciliation run passes after connector activation.
