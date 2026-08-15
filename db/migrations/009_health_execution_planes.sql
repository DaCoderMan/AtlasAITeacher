ALTER TABLE atlas_health_checks
  ADD COLUMN IF NOT EXISTS execution_plane text;

UPDATE atlas_health_checks
SET execution_plane = CASE
  WHEN execution_plane IS NOT NULL THEN execution_plane
  WHEN service_id = 'neon' THEN 'server'
  ELSE 'connector'
END
WHERE execution_plane IS NULL;
