-- Atlas Learning Arcade round integrity hardening
-- Additive migration. Safe to re-run.

ALTER TABLE atlas_game_rounds
  ADD COLUMN IF NOT EXISTS event_id text,
  ADD COLUMN IF NOT EXISTS execution_plane text,
  ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS atlas_game_rounds_event_id_uidx
  ON atlas_game_rounds(user_id, game_id, event_id)
  WHERE event_id IS NOT NULL;

ALTER TABLE atlas_game_progress
  ADD COLUMN IF NOT EXISTS last_event_id text,
  ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS atlas_game_progress_last_event_idx
  ON atlas_game_progress(user_id, game_id, last_event_id)
  WHERE last_event_id IS NOT NULL;

COMMENT ON COLUMN atlas_game_rounds.event_id IS
  'Idempotency key for a durable game-round event. Replays must not double-award XP or advance state twice.';

COMMENT ON COLUMN atlas_game_rounds.execution_plane IS
  'Originating runtime/client plane, e.g. chatgpt, atlas-runtime, mcp, web, ios.';

COMMENT ON COLUMN atlas_game_rounds.provenance IS
  'Source, correlation IDs, actor metadata and evidence needed to trace the durable round.';

COMMENT ON COLUMN atlas_game_progress.last_event_id IS
  'Most recently applied durable round event id for reconciliation/readback.';
