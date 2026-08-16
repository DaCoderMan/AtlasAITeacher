-- Atlas Cognitive OS: learning, memory review, focus, and guided-practice state
-- Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS atlas_learning_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  domain text NOT NULL,
  objective text,
  prompt text NOT NULL,
  canonical_answer text,
  rubric jsonb NOT NULL DEFAULT '{}'::jsonb,
  item_type text NOT NULL DEFAULT 'free_recall',
  importance smallint NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  desired_retention numeric(4,3) NOT NULL DEFAULT 0.900,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS atlas_learning_items_user_due_idx
  ON atlas_learning_items(user_id, domain, importance DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS atlas_memory_state (
  item_id uuid PRIMARY KEY REFERENCES atlas_learning_items(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  scheduler text NOT NULL DEFAULT 'atlas_adaptive_v1',
  scheduler_version text NOT NULL DEFAULT '1',
  difficulty numeric(8,4) NOT NULL DEFAULT 5.0000,
  stability_days numeric(12,4) NOT NULL DEFAULT 0.0000,
  retrievability numeric(8,5),
  interval_days numeric(12,4) NOT NULL DEFAULT 0.0000,
  repetitions integer NOT NULL DEFAULT 0,
  lapses integer NOT NULL DEFAULT 0,
  last_rating text,
  last_reviewed_at timestamptz,
  due_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_memory_state_due_idx
  ON atlas_memory_state(user_id, due_at);

CREATE TABLE IF NOT EXISTS atlas_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  item_id uuid NOT NULL REFERENCES atlas_learning_items(id) ON DELETE CASCADE,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  rating text NOT NULL CHECK (rating IN ('again','hard','good','easy')),
  response_text text,
  correctness numeric(5,4),
  latency_ms integer,
  confidence smallint CHECK (confidence BETWEEN 0 AND 100),
  transfer_score numeric(5,4),
  error_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  grader_model text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS atlas_review_events_item_idx
  ON atlas_review_events(user_id, item_id, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS atlas_misconceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  item_id uuid REFERENCES atlas_learning_items(id) ON DELETE SET NULL,
  domain text,
  misconception text NOT NULL,
  recurrence_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS atlas_focus_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  project_id uuid,
  task_id uuid,
  title text NOT NULL,
  definition_of_done text NOT NULL,
  planned_start timestamptz,
  planned_end timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'planned',
  interruptions integer NOT NULL DEFAULT 0,
  voluntary_switches integer NOT NULL DEFAULT 0,
  output_summary text,
  resume_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_focus_blocks_user_time_idx
  ON atlas_focus_blocks(user_id, COALESCE(started_at, planned_start) DESC);

CREATE TABLE IF NOT EXISTS atlas_guided_practice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  practice_type text NOT NULL CHECK (practice_type IN ('visualization','guided_relaxation','memory_palace')),
  script_version text,
  script_hash text,
  metrics_pre jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics_post jsonb NOT NULL DEFAULT '{}'::jsonb,
  safety_confirmed boolean NOT NULL DEFAULT false,
  stopped_early boolean NOT NULL DEFAULT false,
  stop_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS atlas_guided_practice_user_idx
  ON atlas_guided_practice_sessions(user_id, started_at DESC);
