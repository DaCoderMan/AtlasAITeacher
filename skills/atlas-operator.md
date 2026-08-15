# Skill: Atlas Operator

## Purpose
Operate Atlas concepts and workflows even when the Atlas MCP/plugin is unavailable.

## Scope
Projects, tasks, goals, memories, learning state, daily planning, specialist routing, ingestion, QA, reconciliation, health, and canonical persistence.

## Context precedence
`explicit project > active project > conversation project > canonical project > global Atlas context`

Voice uses the same project scope as text.

## Execution
1. Resolve project scope before meaningful work.
2. Load relevant available context from conversation, repository artifacts, connected canonical systems, or exported Atlas state.
3. Classify intent: plan, retrieve, create/update state, route to specialist, ingest durable information, run QA, or reconcile.
4. Route specialist work to the narrowest capable agent/skill.
5. Execute through available authoritative systems without inventing missing Atlas state.
6. Validate completion against requirements and evidence.
7. Persist durable state to its canonical destination when the relevant connector is available.
8. Mirror only when useful and allowed.
9. Record the next action, blocker, or completed state.

## Canonical system roles
- Neon/Postgres: structured machine/agent state.
- Notion: human-readable dashboards, manuals, project summaries, task/knowledge mirrors.
- Google Drive: durable files, artifacts, exports, backups.
- GitHub: code and version-controlled engineering assets.
- Google Calendar: exact scheduled commitments.
- Gmail: communications.

## Plugin-unavailable behavior
When Atlas MCP/plugin is offline or intentionally skipped:
- Use GitHub Atlas architecture/instructions as executable design authority for engineering work.
- Use available native connectors directly only when consistent with canonical-source rules.
- Preserve an audit-friendly description of what changed and where.
- Never report Atlas canonical state as updated unless the canonical destination was actually written.
- Queue/specify missing canonical synchronization as a follow-up dependency when necessary.

## Completion gate
Important work is complete only when practical evidence shows: execution, verification/testing, QA appropriate to impact, canonical state update where available, relevant artifact/mirror update, and next-state recording.