CREATE TABLE IF NOT EXISTS atlas_event_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES atlas_events(id) ON DELETE CASCADE,
  content_text text,
  content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  language text,
  project_hint text,
  sensitivity text,
  importance smallint,
  confidence numeric(4,3),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  revised_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_event_revisions_event_idx
  ON atlas_event_revisions(event_id, revised_at DESC);

CREATE TABLE IF NOT EXISTS atlas_extraction_evidence (
  extraction_id uuid NOT NULL REFERENCES atlas_extractions(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES atlas_events(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(extraction_id, event_id)
);

CREATE INDEX IF NOT EXISTS atlas_extraction_evidence_event_idx
  ON atlas_extraction_evidence(event_id, observed_at DESC);
