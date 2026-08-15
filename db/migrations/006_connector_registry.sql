CREATE TABLE IF NOT EXISTS atlas_connector_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  connector_id text NOT NULL,
  provider text NOT NULL,
  category text NOT NULL DEFAULT 'external',
  stable_identities jsonb NOT NULL DEFAULT '{}'::jsonb,
  auth_state text NOT NULL DEFAULT 'unknown',
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  capabilities text[] NOT NULL DEFAULT '{}'::text[],
  risk_classes text[] NOT NULL DEFAULT '{}'::text[],
  pagination_mode text NOT NULL DEFAULT 'unknown',
  schema_version text NOT NULL DEFAULT '1',
  execution_plane text NOT NULL DEFAULT 'connector',
  remediation text,
  configured boolean NOT NULL DEFAULT false,
  health text NOT NULL DEFAULT 'unknown',
  last_read_test jsonb,
  last_write_test jsonb,
  last_success_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, connector_id)
);

CREATE INDEX IF NOT EXISTS atlas_connector_installations_user_idx
  ON atlas_connector_installations(user_id, connector_id);

CREATE INDEX IF NOT EXISTS atlas_connector_installations_health_idx
  ON atlas_connector_installations(user_id, health, configured);
