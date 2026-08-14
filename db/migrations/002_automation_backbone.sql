CREATE TABLE IF NOT EXISTS atlas_ingest_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  source text NOT NULL,
  source_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, source, source_key)
);

CREATE INDEX IF NOT EXISTS atlas_ingest_queue_pending_idx
  ON atlas_ingest_queue(user_id, available_at, created_at)
  WHERE status='pending';

CREATE TABLE IF NOT EXISTS atlas_automation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  queue_id uuid REFERENCES atlas_ingest_queue(id) ON DELETE SET NULL,
  event_id uuid REFERENCES atlas_events(id) ON DELETE SET NULL,
  action text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_automation_audit_user_created_idx
  ON atlas_automation_audit(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS atlas_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  scope text NOT NULL DEFAULT 'all',
  status text NOT NULL DEFAULT 'running',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS atlas_source_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  source text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  mode text NOT NULL DEFAULT 'push',
  health text NOT NULL DEFAULT 'unknown',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, source)
);

CREATE INDEX IF NOT EXISTS atlas_source_registry_user_enabled_idx
  ON atlas_source_registry(user_id, enabled);
