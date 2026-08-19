# Atlas Games Durable Progress

Canonical operational state: Neon/PostgreSQL.

A completed round is not considered saved until the runtime has committed the round event and aggregate progress and then read the aggregate progress back from the canonical database.

## Required runtime sequence

1. Accept a stable `event_id` plus game/session/round/result/progress payload.
2. Start a database transaction.
3. Resolve the canonical game.
4. Insert the round event using the idempotency key.
5. If the event is new, update aggregate progress in the same transaction.
6. Commit.
7. Read aggregate progress back from Neon.
8. Return `saved: true` only when readback exists.

Duplicate delivery of the same `event_id` returns the already committed progress and must not apply XP or state changes again.

## Live promotion gate

Production status requires all of the following evidence:
- governed migrations applied and read back;
- CI green for the owning commit;
- one real game round stored in `atlas_game_rounds`;
- corresponding `atlas_game_progress` readback;
- resume from a fresh execution context using `exact_resume_point`;
- replay of the same `event_id` without double XP;
- no secret values committed or logged.

Until these pass, report the capability as implemented/tested at the highest evidence level actually achieved, not OPERATIONAL.
