# Atlas Skills Layer

This directory defines reusable, project-aware skills for Atlas, Codex, ChatGPT, and specialist agents.

Skills are orchestration contracts, not provider-specific implementations. A skill describes when it should run, what context it needs, which tools/connectors it may use, its risk gates, deterministic execution steps, validation, persistence, audit behavior, and fallback behavior.

## Runtime model

`Intent -> Skill Router -> Project Context -> Preconditions -> Tool/Connector Selection -> Execution -> Validation -> Persistence -> Audit -> Result`

## Rules

- Prefer deterministic workflows for important or repeatable operations.
- Allow bounded agent autonomy for low-risk decisions.
- Require review/approval for destructive, financial, security-sensitive, privacy-sensitive, or otherwise high-impact actions.
- Verify connector availability live; never infer health from configuration alone.
- Make writes idempotent where possible and prevent duplicate tasks, events, messages, and storage operations.
- Preserve provenance, timestamps, project scope, execution result, and failure reason.
- When the Atlas MCP/plugin is unavailable, use the same skill contracts with available ChatGPT tools/connectors, GitHub, Google services, Notion, Neon, local APIs, or Codex workflows.
- Do not bypass a canonical source merely because a mirror is easier to access.

## Initial skills

1. `automation-manager.md`
2. `plugin-connector-orchestrator.md`
3. `atlas-operator.md`
4. `cross-system-workflow-builder.md`
5. `automation-qa-recovery.md`
6. `skill-registry-router.md`

`registry.json` is the machine-readable index.