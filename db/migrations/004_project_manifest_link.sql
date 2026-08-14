ALTER TABLE projects ADD COLUMN IF NOT EXISTS manifest_id text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lifecycle text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

CREATE INDEX IF NOT EXISTS projects_user_manifest_idx
  ON projects(user_id, manifest_id)
  WHERE deleted_at IS NULL AND manifest_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS projects_user_lifecycle_idx
  ON projects(user_id, lifecycle)
  WHERE deleted_at IS NULL AND lifecycle IS NOT NULL;

UPDATE projects SET manifest_id='atlas', lifecycle='Improving', last_verified_at=now()
WHERE deleted_at IS NULL AND name='Atlas — Life OS & AI Teacher';

UPDATE projects SET manifest_id='mage-agent-factory', lifecycle='Building', last_verified_at=now()
WHERE deleted_at IS NULL AND name='Mage Agent Factory';

UPDATE projects SET manifest_id='magic-cloud-llm', lifecycle='Building', last_verified_at=now()
WHERE deleted_at IS NULL AND name='Magic Cloud LLM';

UPDATE projects SET manifest_id='magic-cloud-storage', lifecycle='Building', last_verified_at=now()
WHERE deleted_at IS NULL AND name='Magic Cloud Storage Solution / Agent Memory Infrastructure';

UPDATE projects SET manifest_id='magic-cloud-voice', lifecycle='Specification', last_verified_at=now()
WHERE deleted_at IS NULL AND name='Magic Cloud Voice';

UPDATE projects SET manifest_id='magic-hebrew', lifecycle='Improving', last_verified_at=now()
WHERE deleted_at IS NULL AND name='Magic Hebrew Learning System';

UPDATE projects SET manifest_id='magic-video', lifecycle='Specification', last_verified_at=now()
WHERE deleted_at IS NULL AND name='Magic Video Pipeline';

UPDATE projects SET manifest_id='workitu-growth', lifecycle='Operational', last_verified_at=now()
WHERE deleted_at IS NULL AND name='Workitu Tech Growth & Sales Engine';

UPDATE projects SET manifest_id='career', lifecycle='Operational', last_verified_at=now()
WHERE deleted_at IS NULL AND name='Remote Tech Job Search';
