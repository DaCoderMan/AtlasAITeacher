-- Universal Sync v2 — deliberate replacement for the unrecoverable historical “Migration 010”.
-- Provenance: local recovery investigation completed 2026-08-19 with FOUND:no.
-- This migration is additive and does not replay or deliver any route by itself.

CREATE TABLE IF NOT EXISTS atlas_sync_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  route_id uuid NOT NULL REFERENCES atlas_routing_log(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES atlas_events(id) ON DELETE CASCADE,
  extraction_id uuid REFERENCES atlas_extractions(id) ON DELETE SET NULL,
  destination text NOT NULL,
  action text NOT NULL,
  idempotency_key text NOT NULL,
  mode text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  destination_ref text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  readback_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  readback_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, destination, idempotency_key),
  UNIQUE(route_id)
);

CREATE INDEX IF NOT EXISTS atlas_sync_deliveries_pending_idx
  ON atlas_sync_deliveries(user_id, destination, available_at, created_at)
  WHERE status IN ('pending','retry');

CREATE INDEX IF NOT EXISTS atlas_sync_deliveries_status_idx
  ON atlas_sync_deliveries(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS atlas_sync_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  destination text,
  mode text NOT NULL DEFAULT 'canary',
  status text NOT NULL DEFAULT 'planned',
  requested_count integer NOT NULL DEFAULT 0,
  processed_count integer NOT NULL DEFAULT 0,
  succeeded_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS atlas_sync_batches_user_created_idx
  ON atlas_sync_batches(user_id, created_at DESC);

ALTER TABLE atlas_routing_log
  ADD COLUMN IF NOT EXISTS sync_delivery_id uuid REFERENCES atlas_sync_deliveries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS atlas_routing_log_sync_delivery_idx
  ON atlas_routing_log(sync_delivery_id)
  WHERE sync_delivery_id IS NOT NULL;

COMMENT ON TABLE atlas_sync_deliveries IS
  'Universal Sync v2 durable delivery ledger. A connector being healthy does not imply these deliveries are verified.';

COMMENT ON COLUMN atlas_sync_deliveries.mode IS
  'Delivery mode such as canary, normal, replay, or recovery. Bulk replay must be gated by successful canaries.';

COMMENT ON COLUMN atlas_sync_deliveries.readback_payload IS
  'Evidence returned by target readback. Delivery alone must not be promoted to verified without readback where supported.';
