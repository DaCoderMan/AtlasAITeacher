# Atlas AI Teacher — Atlas Core

**Status: CANONICAL Atlas Core implementation**

This repository contains the core Atlas application logic and is the primary implementation repository for Atlas/LifeOS capabilities unless a verified migration explicitly changes that ownership. Cross-repository engineering priorities, topology and upgrade work are controlled from `DaCoderMan/atlasupdate`.

## Core responsibilities

- Atlas orchestration and application logic
- structured project/task/decision state integration
- ingestion and context-building capabilities implemented in this codebase
- learning/teaching behavior and related Atlas intelligence features
- integrations that belong to Atlas Core rather than a reusable infrastructure module
- Neon/Postgres-backed operational state where implemented
- API routes owned by Atlas Core

Specialized reusable capabilities should remain in their dedicated repositories instead of being duplicated here. Current examples include `atlas-mcp`, `mageagentfactory2`, `magiccloudstorage`, `magiccloudllm`, `Magic-Voice-Module`, and `custom-gpt-cloud`.

## Project X Neon → Notion sync

One implemented capability is the protected Project X sync. Neon `workitu-db / neondb` is the canonical structured project store. The endpoint `GET|POST /api/project-x-sync` reads non-deleted projects in `active`, `waiting`, or `later` state, normalizes duplicate names, orders them by priority, and replaces the contents of the dedicated Notion mirror page.

### Required environment variables

- `DATABASE_URL` — Neon connection string.
- `NOTION_TOKEN` — Notion integration token with access to the mirror page.
- `PROJECT_X_NOTION_PAGE_ID` — dedicated mirror page ID.
- `PROJECT_X_SYNC_SECRET` — strong random secret required by the endpoint.
- `ATLAS_USER_ID` — optional; defaults to `default`.
- `NOTION_VERSION` — optional; defaults to `2022-06-28`.

### Safety

The sync writes only to the dedicated Project X mirror. Neon remains canonical; Notion is generated human-readable output. Never commit environment-variable values or credentials.

### Test

Call `/api/project-x-sync?dryRun=1` with the configured bearer secret before performing a live sync. A successful dry run must be verified before treating the integration as healthy.

## Engineering governance

Before broad changes, read the current `PRD.md`, `STATE.md`, `REPOSITORIES.md`, and `AGENTS.md` in `DaCoderMan/atlasupdate`. Do not recreate a subsystem already owned by another canonical module. Tests and evidence are required before reporting a capability as complete.