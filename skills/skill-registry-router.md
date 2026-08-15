# Skill: Skill Registry & Router

## Purpose
Maintain and route reusable skills across Atlas, ChatGPT, Codex, specialist agents, plugins, and automations.

## Skill schema
Each skill should define:
- `id`
- `name`
- `version`
- `description`
- `triggers`
- `project_scope`
- `required_context`
- `required_capabilities`
- `preferred_tools`
- `fallback_tools`
- `risk_level`
- `approval_policy`
- `execution_steps`
- `validation`
- `persistence`
- `audit_fields`
- `failure_behavior`
- `status`

## Routing logic
1. Resolve project/context scope.
2. Classify intent and requested outcome.
3. Find the narrowest skill that fully covers the intent.
4. Check required capabilities against live tool/connector availability.
5. Prefer a deterministic skill/workflow over a general agent when both can solve the task.
6. If several skills are needed, compose them through the Cross-System Workflow Builder.
7. Apply risk and approval gates before side effects.
8. Validate result and write audit metadata.

## Registry rules
- Skills are provider-neutral contracts.
- A tool/plugin is an implementation dependency, not the skill itself.
- Skills may be global or project-specific; project-specific instructions win in that project.
- Skills can call specialist agents, but agents should not silently expand scope beyond the selected skill contract.
- Deprecated skills remain discoverable for migration but should not be selected for new work.

## Fallback
If no registered skill fits, route to a general planner/agent, capture the successful procedure, and consider promoting it into a reusable skill after validation.