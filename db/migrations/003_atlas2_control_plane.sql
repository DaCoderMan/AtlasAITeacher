CREATE TABLE IF NOT EXISTS atlas_agent_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  project_key text,
  intent text NOT NULL,
  workflow_type text NOT NULL,
  selected_agents jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk text NOT NULL DEFAULT 'low',
  qa_required boolean NOT NULL DEFAULT false,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_agent_routes_user_created_idx
  ON atlas_agent_routes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS atlas_agent_routes_project_created_idx
  ON atlas_agent_routes(user_id, project_key, created_at DESC);

CREATE TABLE IF NOT EXISTS atlas_qa_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  project_key text,
  status text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_qa_runs_user_created_idx
  ON atlas_qa_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS atlas_qa_runs_project_created_idx
  ON atlas_qa_runs(user_id, project_key, created_at DESC);

CREATE TABLE IF NOT EXISTS atlas_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  entity_type text NOT NULL,
  entity_key text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  competing_values jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_value jsonb,
  authority_reason text,
  status text NOT NULL DEFAULT 'open',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(user_id, entity_type, entity_key, status)
);

CREATE INDEX IF NOT EXISTS atlas_conflicts_user_status_idx
  ON atlas_conflicts(user_id, status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS atlas_health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  service_id text NOT NULL,
  category text,
  health text NOT NULL,
  configured boolean NOT NULL DEFAULT false,
  latency_ms integer,
  failure_summary text,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_health_checks_user_service_idx
  ON atlas_health_checks(user_id, service_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS atlas_daily_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  plan_date date NOT NULL,
  active_project_id text,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, plan_date, active_project_id)
);

CREATE INDEX IF NOT EXISTS atlas_daily_plans_user_date_idx
  ON atlas_daily_plans(user_id, plan_date DESC);
