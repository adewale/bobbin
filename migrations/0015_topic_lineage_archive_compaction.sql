ALTER TABLE topic_lineage_archive ADD COLUMN archive_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE topic_lineage_archive ADD COLUMN last_original_topic_id INTEGER;
ALTER TABLE topic_lineage_archive ADD COLUMN last_archived_at TEXT;

UPDATE topic_lineage_archive
SET last_original_topic_id = original_topic_id,
    last_archived_at = archived_at
WHERE last_original_topic_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_topic_lineage_archive_compact_key
  ON topic_lineage_archive(slug, archive_reason, merge_stage, merged_to_topic_id);
