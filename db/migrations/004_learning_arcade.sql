-- Atlas Learning Arcade canonical operational state
-- Mirrors the reviewed Neon migration prepared on 2026-08-19.
-- Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS atlas_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  subtitle text,
  category text NOT NULL DEFAULT 'learning',
  certification_code text,
  certification_provider text,
  status text NOT NULL DEFAULT 'active',
  unlimited_duration boolean NOT NULL DEFAULT false,
  default_xp_cap integer,
  mastery_target numeric(5,4) NOT NULL DEFAULT 0.8000,
  game_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  graphics_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS atlas_games_status_idx ON atlas_games(status, title) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS atlas_game_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  game_id uuid NOT NULL REFERENCES atlas_games(id) ON DELETE CASCADE,
  xp integer NOT NULL DEFAULT 0,
  mastery_score numeric(5,4) NOT NULL DEFAULT 0.0000,
  transfer_score numeric(5,4) NOT NULL DEFAULT 0.0000,
  current_level text,
  current_mission text,
  exact_resume_point jsonb NOT NULL DEFAULT '{}'::jsonb,
  bosses_completed integer NOT NULL DEFAULT 0,
  mocks_passed integer NOT NULL DEFAULT 0,
  streak integer NOT NULL DEFAULT 0,
  error_bank jsonb NOT NULL DEFAULT '[]'::jsonb,
  achievements jsonb NOT NULL DEFAULT '[]'::jsonb,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_played_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, game_id)
);

CREATE INDEX IF NOT EXISTS atlas_game_progress_user_idx ON atlas_game_progress(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS atlas_game_domain_mastery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  game_id uuid NOT NULL REFERENCES atlas_games(id) ON DELETE CASCADE,
  domain_key text NOT NULL,
  domain_title text NOT NULL,
  weight numeric(6,5),
  mastery_score numeric(5,4) NOT NULL DEFAULT 0.0000,
  attempts integer NOT NULL DEFAULT 0,
  correct integer NOT NULL DEFAULT 0,
  confidence_calibration numeric(5,4),
  next_review_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, game_id, domain_key)
);

CREATE INDEX IF NOT EXISTS atlas_game_domain_mastery_due_idx ON atlas_game_domain_mastery(user_id, next_review_at) WHERE next_review_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS atlas_game_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  game_id uuid NOT NULL REFERENCES atlas_games(id) ON DELETE CASCADE,
  session_id uuid,
  round_number integer NOT NULL,
  challenge_key text,
  prompt_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  xp_delta integer NOT NULL DEFAULT 0,
  mastery_delta numeric(6,5),
  transfer_score numeric(5,4),
  confidence smallint CHECK (confidence BETWEEN 0 AND 100),
  error_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  resume_point jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_game_rounds_user_game_idx ON atlas_game_rounds(user_id, game_id, created_at DESC);

CREATE TABLE IF NOT EXISTS atlas_game_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid REFERENCES atlas_games(id) ON DELETE CASCADE,
  asset_key text NOT NULL,
  slot text NOT NULL,
  variant text,
  uri text,
  checksum_sha256 text,
  width integer,
  height integer,
  mime_type text,
  source_kind text NOT NULL DEFAULT 'generated',
  source_master_key text,
  focal_point jsonb NOT NULL DEFAULT '{}'::jsonb,
  safe_zone jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(game_id, asset_key, variant)
);

CREATE INDEX IF NOT EXISTS atlas_game_assets_game_slot_idx ON atlas_game_assets(game_id, slot);

CREATE TABLE IF NOT EXISTS atlas_game_pipeline_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_key text NOT NULL,
  version text NOT NULL,
  spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pipeline_key, version)
);