# Atlas completion roadmap

## Complete
- Codex -> Atlas local MCP: verified live.
- Neon canonical state: live.
- Universal ingestion core: implemented.
- Durable automation queue, worker, retries/dead-letter, source health, routing policy, reconciliation, audit: implemented.
- File inbox watcher and always-on daemon/systemd installer: implemented.
- ChatGPT-facing remote HTTP MCP endpoint: implemented and protocol-tested.
- Hardened local MCP launcher and secret hygiene: implemented.
- Live `atlas_status` smoke-test script: implemented.

## Activation / external dependencies
- Deploy `/api/mcp` to a reachable HTTPS host or use OpenAI Secure MCP Tunnel.
- Add the Atlas custom MCP app in ChatGPT Developer Mode and scan/test tools.
- ChatGPT Pro currently supports custom MCP read/fetch permissions; full write/modify requires Business/Enterprise/Edu.
- Automatic ChatGPT/Voice ingestion requires an accessible transcript/event source or explicit Atlas tool calls; raw product audio is not assumed accessible.
- WhatsApp requires a supported API/webhook/export source.
- Destination webhooks for Notion/Drive/GitHub/Calendar/Memory require configured executors/credentials.
