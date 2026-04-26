ALTER TABLE sources ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sources ADD COLUMN last_fetch_status TEXT;
ALTER TABLE sources ADD COLUMN last_fetch_error TEXT;
ALTER TABLE sources ADD COLUMN last_refresh_started_at TEXT;
ALTER TABLE sources ADD COLUMN last_refresh_completed_at TEXT;
ALTER TABLE sources ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sources_active_archive_created
  ON sources(active, is_archive, created_at, id);

PRAGMA optimize;
