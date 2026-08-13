# Atlas Memory Gateway

Neon is the canonical structured state store. Custom GPTs and ChatGPT Projects should use one shared gateway for memory, tasks, projects, context, and sync status. Notion is an optional human-readable mirror; Drive owns files; Calendar owns exact scheduled time; Gmail owns email content.

Target operations: memory_search, memory_upsert, task_search, task_upsert, task_update, project_search, project_update, context_get, sync_status.

Design rule: one memory interface, multiple authoritative backends by data type. Do not duplicate full files, emails, or calendar data into Neon; store concise state and external IDs instead.
