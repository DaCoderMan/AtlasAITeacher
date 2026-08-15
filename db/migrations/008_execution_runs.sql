CREATE TABLE IF NOT EXISTS atlas_execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  run_key text NOT NULL,
  run_revision integer NOT NULL DEFAULT 1,
  project_key text,
  task_family text,
  program_key text,
  status text NOT NULL DEFAULT 'pending',
  run_version integer NOT NULL DEFAULT 1,
  total_steps integer NOT NULL DEFAULT 0,
  completed_steps integer NOT NULL DEFAULT 0,
  blocked_steps integer NOT NULL DEFAULT 0,
  current_step_index integer,
  current_step_id uuid,
  current_step_key text,
  created_by text NOT NULL DEFAULT 'codex',
  session_id uuid,
  session_resume_handle text,
  resume_handle text UNIQUE,
  last_checkpoint_id uuid,
  runbook jsonb NOT NULL DEFAULT '{}'::jsonb,
  runbook_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_progress_message text,
  last_progress_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, run_key, run_revision)
);

CREATE INDEX IF NOT EXISTS atlas_execution_runs_user_updated_idx
  ON atlas_execution_runs(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS atlas_execution_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES atlas_execution_runs(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  step_index integer NOT NULL,
  step_key text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  canonical_task_key text,
  depends_on_step_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  instructions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_requirements_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowed_actions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  test_requirements_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  live_verification_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  rollback_note text,
  evidence_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_records_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  waiver_metadata_json jsonb,
  result_summary text,
  blocked_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, step_index),
  UNIQUE(run_id, step_key)
);

CREATE INDEX IF NOT EXISTS atlas_execution_run_steps_run_idx
  ON atlas_execution_run_steps(run_id, step_index);

CREATE TABLE IF NOT EXISTS atlas_execution_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES atlas_execution_runs(id) ON DELETE CASCADE,
  step_id uuid REFERENCES atlas_execution_run_steps(id) ON DELETE SET NULL,
  user_id text NOT NULL,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_execution_run_events_run_created_idx
  ON atlas_execution_run_events(run_id, created_at DESC);
