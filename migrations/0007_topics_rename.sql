-- Phase 1: Rename tags → topics, concordance → word_stats
-- This is a mechanical rename with no functional changes.

-- Create new topics table (was: tags) with new columns
CREATE TABLE topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  usage_count INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'concept',
  related_slugs TEXT
);
INSERT INTO topics (id, name, slug, usage_count) SELECT id, name, slug, usage_count FROM tags;

-- Create new chunk_topics table (was: chunk_tags, column tag_id → topic_id)
CREATE TABLE chunk_topics (
  chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY (chunk_id, topic_id)
);
INSERT INTO chunk_topics SELECT chunk_id, tag_id FROM chunk_tags;

-- Create new episode_topics table (was: episode_tags, column tag_id → topic_id)
CREATE TABLE episode_topics (
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY (episode_id, topic_id)
);
INSERT INTO episode_topics SELECT episode_id, tag_id FROM episode_tags;

-- Create new word_stats table (was: concordance)
CREATE TABLE word_stats AS SELECT * FROM concordance;

-- Create indexes on new tables
CREATE INDEX IF NOT EXISTS idx_topics_usage ON topics(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_chunk_topics_topic ON chunk_topics(topic_id);
CREATE INDEX IF NOT EXISTS idx_episode_topics_topic ON episode_topics(topic_id);
CREATE INDEX IF NOT EXISTS idx_word_stats_count ON word_stats(total_count DESC);
CREATE INDEX IF NOT EXISTS idx_word_stats_distinctiveness ON word_stats(distinctiveness DESC);

-- Drop old tables
DROP TABLE IF EXISTS episode_tags;
DROP TABLE IF EXISTS chunk_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS concordance;
