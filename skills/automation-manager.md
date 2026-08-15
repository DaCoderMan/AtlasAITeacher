# Skill: Automation Manager

## Purpose
Create, inspect, modify, disable, deduplicate, and validate scheduled or conditional automations across ChatGPT and Atlas-compatible runtimes.

## Trigger examples
- Remind me / schedule / every day / every week.
- Notify me when a future condition becomes true.
- Show, change, pause, resume, or remove an automation.
- Convert a repeated manual check into an automation.

## Required context
- User intent and subject.
- Exact time, recurrence, daypart, or condition when supplied.
- User timezone.
- Existing matching automations when deduplication matters.
- Risk classification.

## Execution
1. Normalize intent into one of: one-time schedule, recurring schedule, or condition watch.
2. Resolve project scope and timezone.
3. Check for a semantically duplicate automation when practical.
4. Select timing semantics: exact, flexible, or condition-based.
5. Build the smallest self-contained future prompt that preserves the user's intent.
6. Create/update the automation only when authorized.
7. Validate resulting schedule, recurrence, condition, and enabled state.
8. Record or surface the resulting automation identifier when available.

## Safety / risk
- Low: reminders, summaries, benign recurring checks.
- Medium: workflows that send communications or modify shared systems.
- High: money movement, destructive changes, credentials, legal/medical decisions, or irreversible external actions. High-risk automations must not autonomously execute the consequential action without an explicit approved policy.

## Validation
- No accidental duplicate.
- Correct timezone and date semantics.
- No recurrence beyond user intent.
- Condition watch has an appropriate polling cadence.
- Prompt contains enough context to execute later without relying on transient conversation state.

## Fallback
If the runtime cannot create the requested automation, produce a structured automation specification for another supported runtime instead of pretending it was scheduled.