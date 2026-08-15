# Skill: Automation QA & Recovery

## Purpose
Inspect, diagnose, reconcile, and safely recover failed, stuck, duplicated, stale, or partially completed automations and ingestion workflows.

## Trigger examples
- An automation did not run or produced the wrong result.
- A connector is degraded or unauthorized.
- A queue item is stuck/retrying/dead-lettered.
- A destination write is incomplete or duplicated.
- State differs between canonical and mirror systems.

## Execution
1. Identify the failed workflow, object IDs, expected state, and last known successful transition.
2. Inspect available execution logs, connector status, queue/retry state, and destination state.
3. Classify failure: authentication, permission, connectivity, schema, validation, duplicate/idempotency, dependency, rate/limit, stale lock, policy gate, or unknown.
4. Distinguish safe retry from potentially duplicating/compounding side effects.
5. Reconcile canonical state against mirrors and external systems.
6. Retry only safe/idempotent work automatically.
7. Escalate ambiguous or consequential recovery for review.
8. Validate restored state and record the root cause plus corrective action.

## Recovery rules
- Never replay a side-effecting step merely because the previous call timed out; inspect target state first.
- Prefer repair/reconciliation over deleting evidence.
- Preserve failed-event provenance and diagnostic data.
- Mark unresolved dependencies explicitly as waiting/blocked rather than complete.

## Validation
Recovery is successful only when the expected end state is verified at the authoritative destination and no duplicate side effect was introduced.