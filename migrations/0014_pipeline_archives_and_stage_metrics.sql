CREATE TABLE topic_lineage_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_topic_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  distinctiveness REAL NOT NULL DEFAULT 0,
  display_reason TEXT,
  provenance_complete INTEGER NOT NULL DEFAULT 0,
  archive_reason TEXT NOT NULL,
  merged_to_topic_id INTEGER,
  merge_stage TEXT,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pipeline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingestion_log_id INTEGER REFERENCES ingestion_log(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES sources(id),
  run_type TEXT NOT NULL,
  extractor_mode TEXT NOT NULL DEFAULT 'naive',
  status TEXT NOT NULL DEFAULT 'completed',
  total_ms INTEGER NOT NULL DEFAULT 0,
  chunks_processed INTEGER NOT NULL DEFAULT 0,
  candidates_generated INTEGER NOT NULL DEFAULT 0,
  candidates_rejected_early INTEGER NOT NULL DEFAULT 0,
  candidates_inserted INTEGER NOT NULL DEFAULT 0,
  topics_inserted INTEGER NOT NULL DEFAULT 0,
  chunk_topic_links_inserted INTEGER NOT NULL DEFAULT 0,
  chunk_word_rows_inserted INTEGER NOT NULL DEFAULT 0,
  pruned INTEGER NOT NULL DEFAULT 0,
  merged INTEGER NOT NULL DEFAULT 0,
  orphan_topics_deleted INTEGER NOT NULL DEFAULT 0,
  archived_lineage_topics INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pipeline_stage_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_run_id INTEGER NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  stage_order INTEGER NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  counts_json TEXT NOT NULL DEFAULT '{}',
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_topic_lineage_archive_original ON topic_lineage_archive(original_topic_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created_at ON pipeline_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_run_type ON pipeline_runs(run_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage_metrics_run ON pipeline_stage_metrics(pipeline_run_id, phase, stage_order);
