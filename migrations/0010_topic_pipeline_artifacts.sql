ALTER TABLE chunks ADD COLUMN analysis_text TEXT;
ALTER TABLE chunks ADD COLUMN normalization_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chunks ADD COLUMN normalization_warnings TEXT;

CREATE TABLE phrase_lexicon (
  phrase TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  support_count INTEGER NOT NULL DEFAULT 0,
  doc_count INTEGER NOT NULL DEFAULT 0,
  quality_score REAL NOT NULL DEFAULT 0,
  provenance TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE topic_candidate_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'candidate_processing',
  raw_candidate TEXT NOT NULL,
  normalized_candidate TEXT NOT NULL,
  topic_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'concept',
  decision TEXT NOT NULL,
  decision_reason TEXT NOT NULL,
  provenance TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE topic_merge_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_topic_id INTEGER NOT NULL,
  to_topic_id INTEGER NOT NULL,
  from_slug TEXT NOT NULL,
  to_slug TEXT NOT NULL,
  stage TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE topics ADD COLUMN display_suppressed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE topics ADD COLUMN display_reason TEXT;
ALTER TABLE topics ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE topics ADD COLUMN entity_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE topics ADD COLUMN provenance_complete INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_chunks_normalization_version ON chunks(normalization_version);
CREATE INDEX IF NOT EXISTS idx_phrase_lexicon_doc_count ON phrase_lexicon(doc_count DESC);
CREATE INDEX IF NOT EXISTS idx_topic_candidate_audit_chunk ON topic_candidate_audit(chunk_id);
CREATE INDEX IF NOT EXISTS idx_topics_visible ON topics(hidden, display_suppressed, usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_topic_candidate_audit_topic ON topic_candidate_audit(topic_id);
CREATE INDEX IF NOT EXISTS idx_topic_merge_audit_to_topic ON topic_merge_audit(to_topic_id);

PRAGMA optimize;
