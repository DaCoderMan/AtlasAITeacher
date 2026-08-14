# ChatGPT Voice ingestion

Atlas treats accessible ChatGPT Voice transcripts as first-class source events (`chatgpt_voice`). The adapter preserves conversation/session IDs, timestamps, actor, language, project hint, sensitivity, and provenance when supplied.

Atlas must not assume access to raw ChatGPT Voice audio or to a complete hidden product event stream. Supported activation paths are: MCP tool calls from compatible ChatGPT sessions, an upstream transcript/export feed posted to `/api/source-events`, or periodic transcript/export import through the Atlas Inbox.
