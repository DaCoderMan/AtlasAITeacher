CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS atlas_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  source text NOT NULL,
  source_event_id text,
  thread_id text,
  session_id text,
  actor text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  content_type text NOT NULL DEFAULT 'text',
  content_text text,
  content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  language text,
  project_hint text,
  sensitivity text NOT NULL DEFAULT 'normal',
  importance smallint NOT NULL DEFAULT 0 CHECK (importance BETWEEN 0 AND 100),
  confidence numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'ingested',
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, source_event_id)
);

CREATE INDEX IF NOT EXISTS atlas_events_user_time_idx ON atlas_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS atlas_events_thread_idx ON atlas_events(user_id, thread_id);
CREATE INDEX IF NOT EXISTS atlas_events_hash_idx ON atlas_events(user_id, content_hash);

CREATE TABLE IF NOT EXISTS atlas_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES atlas_events(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  kind text NOT NULL,
  title text,
  body text,
  structured jsonb NOT NULL DEFAULT '{}'::jsonb,
  importance smallint NOT NULL DEFAULT 0 CHECK (importance BETWEEN 0 AND 100),
  confidence numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  canonical_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_extractions_event_idx ON atlas_extractions(event_id);
CREATE INDEX IF NOT EXISTS atlas_extractions_kind_idx ON atlas_extractions(user_id, kind);
CREATE INDEX IF NOT EXISTS atlas_extractions_key_idx ON atlas_extractions(user_id, canonical_key);

CREATE TABLE IF NOT EXISTS atlas_routing_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES atlas_events(id) ON DELETE CASCADE,
  extraction_id uuid REFERENCES atlas_extractions(id) ON DELETE CASCADE,
  destination text NOT NULL,
  action text NOT NULL,
  status text NOT NULL,
  destination_ref text,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_routing_log_event_idx ON atlas_routing_log(event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS atlas_connector_cursors (
  user_id text NOT NULL,
  connector text NOT NULL,
  cursor text,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, connector)
);
