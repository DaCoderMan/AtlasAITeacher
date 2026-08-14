# Atlas Universal Ingestion

Atlas Universal Ingestion is the single entrypoint for all supported information sources.

## Pipeline

`source -> normalize -> understand -> classify -> extract -> score -> deduplicate -> route -> persist -> audit`

## Canonical event contract

POST `/api/ingest`

```json
{
  "user_id": "default",
  "source": "chatgpt|chatgpt_voice|whatsapp|gmail|file|github|notion|calendar|manual|other",
  "source_event_id": "stable-source-id",
  "thread_id": "conversation-or-thread-id",
  "session_id": "session-id",
  "actor": "user|assistant|contact-name-or-id",
  "occurred_at": "2026-08-14T12:00:00Z",
  "content_type": "text|voice_transcript|file|email|message|artifact",
  "content_text": "normalized human-readable content",
  "content_json": {},
  "language": "en",
  "project_hint": "Mage Agent Factory",
  "sensitivity": "normal|sensitive|restricted",
  "provenance": {
    "source_url": null,
    "original_id": null,
    "import_batch": null
  }
}
```

`Authorization: Bearer $ATLAS_INGEST_SECRET` is required when the secret is configured.

## Source adapters

Every adapter must convert source-specific data to the canonical event contract. Adapters should never implement their own memory/task logic.

### ChatGPT text

Ingest exported or otherwise programmatically accessible conversation messages. Use a stable conversation/message ID where available. The adapter should preserve thread order and distinguish user and assistant messages.

### ChatGPT Voice

Ingest accessible voice transcripts as `content_type=voice_transcript`. Do not assume raw ChatGPT audio is available. Treat the complete voice session as a thread so Atlas can reason across turns.

### WhatsApp

Use an explicit source such as WhatsApp Business/Cloud API, approved integration, or user export. Atlas cannot passively read a personal WhatsApp account without a supported connection. Preserve chat/contact/thread IDs and timestamps.

### Gmail

Use message ID as `source_event_id` and thread ID as `thread_id`. Keep Gmail as the authoritative email source; Atlas stores structured facts, tasks and links/provenance rather than replacing the mailbox.

### Files

Store durable file bytes in Google Drive or their authoritative file system. The Atlas event should contain metadata, extracted text/summary when allowed, checksum and the durable file reference. Engineering artifacts may additionally route to GitHub.

## Routing policy

- Neon/Postgres: canonical structured Atlas state, events, extractions and audit log.
- Notion: human-readable mirrors of projects, decisions, tasks, learning and knowledge.
- Google Drive: durable files, artifacts, exports and backups.
- GitHub: version-controlled engineering assets.
- Google Calendar: exact scheduled commitments after sufficient confidence/authorization.
- Gmail: authoritative email source.
- ChatGPT Memory: durable conversational preference/context candidates when supported.

Routing is recorded first as a pending entry in `atlas_routing_log`. Destination workers should perform the write and update the row to `completed`, `skipped`, `needs_review`, or `failed` with `destination_ref` and details.

## Privacy and safety

Do not store low-value transient chatter simply because it was ingested. Keep raw-source provenance, apply sensitivity labels, and require additional policy before routing restricted information to mirrors or third parties. Exact appointments, money movement, external communication and destructive actions require the appropriate authorization layer.

## Database setup

Run `db/migrations/001_universal_ingestion.sql` against the Atlas PostgreSQL/Neon database before using `/api/ingest`.

## Current implementation boundary

The repository now implements the canonical database schema, HTTP ingestion entrypoint, deterministic first-pass classifier, deduplication and routing queue. Source adapters and destination workers can be added independently without changing the ingestion contract. LLM-assisted classification should augment this deterministic layer rather than bypass the audit/dedup/routing pipeline.
