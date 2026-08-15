# Skill: Cross-System Workflow Builder

## Purpose
Compose Atlas, automations, plugins/connectors, APIs, and specialist agents into reliable multi-step workflows.

## Design contract
Every workflow should define:
- Trigger
- Project/context scope
- Inputs and required identifiers
- Authoritative sources
- Ordered steps and dependencies
- Allowed tools/connectors
- Risk level per step
- Idempotency/deduplication keys
- Retry policy
- Validation/acceptance criteria
- Persistence/audit destinations
- Human approval gates
- Failure and compensation behavior

## Execution
1. Translate the user's goal into an explicit state machine or ordered workflow.
2. Separate deterministic operations from judgment-heavy decisions.
3. Assign deterministic operations to code/tools and bounded judgment to an LLM/agent.
4. Resolve authoritative systems for each read/write.
5. Prevent repeated side effects using stable identifiers, state checks, or idempotency keys.
6. Gate medium/high-impact steps according to policy.
7. Execute dependency-aware steps.
8. Validate each important transition before unlocking downstream actions.
9. Persist useful state, provenance, timestamps, and failures.
10. Finish with a clear terminal state: completed, waiting, blocked, failed, or review required.

## Examples
- Gmail lead -> classify -> Workitu Growth review -> CRM/Notion record -> follow-up task -> Calendar reminder.
- Project decision -> GitHub issue/spec -> Codex implementation -> tests -> Critic/QA -> project state update.
- File arrives -> ingestion/classification -> canonical storage -> Drive backup -> project/task extraction -> reconciliation.

## Safety
Never let an LLM freely improvise consequential side effects when a deterministic workflow can constrain them. Financial, destructive, credential, privacy-sensitive, legal, or other high-impact steps require explicit policy/approval.