ALTER TABLE topics ADD COLUMN episode_support INTEGER NOT NULL DEFAULT 0;
ALTER TABLE topics ADD COLUMN burst_score REAL NOT NULL DEFAULT 1;
ALTER TABLE topics ADD COLUMN burst_peak_quarter TEXT;

CREATE TABLE topic_dirty (
  topic_id INTEGER PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE chunk_vector_cache (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  vector_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE topic_embedding_cache (
  topic_id INTEGER PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
  vector_json TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE topic_similarity_scores (
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  related_topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  overlap_count INTEGER NOT NULL DEFAULT 0,
  jaccard_score REAL NOT NULL DEFAULT 0,
  cosine_score REAL,
  combined_score REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (topic_id, related_topic_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_dirty_updated_at ON topic_dirty(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chunk_vector_cache_updated_at ON chunk_vector_cache(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_topic_similarity_scores_topic ON topic_similarity_scores(topic_id, combined_score DESC);
CREATE INDEX IF NOT EXISTS idx_topics_episode_support ON topics(episode_support DESC);
CREATE INDEX IF NOT EXISTS idx_topics_burst_score ON topics(burst_score DESC);

PRAGMA optimize;
