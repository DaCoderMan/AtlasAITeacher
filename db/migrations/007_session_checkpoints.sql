CREATE TABLE IF NOT EXISTS atlas_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  project_key text,
  status text NOT NULL DEFAULT 'active',
  current_version integer NOT NULL DEFAULT 0,
  latest_checkpoint_id uuid,
  resume_handle text UNIQUE,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  conflict_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_checkpoint_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_sessions_user_updated_idx
  ON atlas_sessions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS atlas_session_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES atlas_sessions(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  checkpoint_version integer NOT NULL,
  expected_canonical_version integer,
  delta jsonb NOT NULL DEFAULT '{}'::jsonb,
  checkpoint_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  causal_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  unfinished_handle text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, checkpoint_version)
);

CREATE INDEX IF NOT EXISTS atlas_session_checkpoints_session_created_idx
  ON atlas_session_checkpoints(session_id, created_at DESC);
