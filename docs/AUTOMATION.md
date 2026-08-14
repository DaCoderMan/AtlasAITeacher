# Atlas Automatic Ingestion and Administration

Atlas automation is designed so supported data can enter once and be classified, deduplicated, routed, audited, and reconciled without requiring manual `Mem X` / `Todo X` style commands.

## Runtime flow

1. Source connector or local watcher creates a normalized source event.
2. `atlas_enqueue` / `/api/enqueue` / `/api/source-events` writes the event to `atlas_ingest_queue`.
3. `scripts/atlas-daemon.js` or `/api/worker` claims queued events with retry/dead-letter handling.
4. Universal Ingestion writes the canonical event and extractions.
5. Policy Engine decides auto / review / private / ignore.
6. Route Executor completes Neon routes and delivers configured external routes through destination webhooks.
7. Source health and automation actions are recorded.
8. Reconciliation detects dead letters, failed routing, degraded connectors, and stale sources.

## Supported normalized sources

- `chatgpt`
- `chatgpt_voice` (transcripts/session records, not assumed raw audio)
- `whatsapp`
- `gmail`
- `file`
- any custom source through the generic enqueue endpoint

## Continuous local operation

Run:

```bash
npm run daemon:atlas
npm run watch:atlas
```

Or install the user-level services:

```bash
bash scripts/install-systemd.sh
```

The file watcher monitors `ATLAS_DROPBOX_DIR` and automatically queues changed files. Text-like files below the configured size threshold are read for classification; binary/large files are indexed from metadata and durable reference.

## HTTP entry points

- `POST /api/enqueue` — normalized events
- `POST /api/source-events` — ChatGPT/Voice, WhatsApp, Gmail, and file adapter batches
- `GET|POST /api/worker` — process queue
- `GET|POST /api/reconcile` — automation health/reconciliation
- direct `/api/ingest` remains available for immediate synchronous ingestion

HTTP ingestion fails closed when `ATLAS_INGEST_SECRET` is absent.

## MCP administration

Codex can use:

- `atlas_enqueue`
- `atlas_automation_status`
- `atlas_run_worker`
- `atlas_reconcile`

alongside the core Atlas tools.

## Destination routing

Neon is completed automatically because the canonical event/extraction already lives there. Other automatic destinations are delivered through configured connector webhooks:

- `ATLAS_ROUTE_NOTION_URL`
- `ATLAS_ROUTE_DRIVE_URL`
- `ATLAS_ROUTE_GITHUB_URL`
- `ATLAS_ROUTE_CALENDAR_URL`
- `ATLAS_ROUTE_MEMORY_URL`

Use `ATLAS_ROUTE_SECRET` to authenticate Atlas to those connector services.

Routes without an active connector are recorded as `waiting_connector` rather than falsely marked complete. Calendar candidates and ChatGPT-memory candidates remain review-gated unless a future policy explicitly makes them safe for automatic mutation.

## Source availability boundary

Atlas can automate processing only after a source can actually deliver data. ChatGPT voice raw audio is not assumed accessible; Atlas ingests transcript/session records when an accessible integration/export provides them. WhatsApp likewise requires an API, webhook, export bridge, or local export feed. This is a source-access constraint, not an Atlas processing constraint.

## Safety model

- Low-value content can be ignored.
- Normal high-confidence durable information can route automatically.
- Sensitive information is retained privately and is not silently mirrored to weaker destinations.
- High-impact or uncertain actions are review-gated.
- Connector failures remain visible in source health, routing status, audit logs, and reconciliation runs.
