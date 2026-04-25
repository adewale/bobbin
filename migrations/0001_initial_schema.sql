-- Sources: each Google Doc
CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_doc_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  last_fetched_at TEXT,
  last_revision_id TEXT,
  is_archive INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Episodes: each weekly edition
CREATE TABLE episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  published_date TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  day INTEGER NOT NULL,
  summary TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chunks: individual observations within an episode
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_plain TEXT NOT NULL,
  summary TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  vector_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tags
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  usage_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE chunk_tags (
  chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (chunk_id, tag_id)
);

CREATE TABLE episode_tags (
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (episode_id, tag_id)
);

-- Concordance
CREATE TABLE concordance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL UNIQUE,
  total_count INTEGER NOT NULL DEFAULT 0,
  doc_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE chunk_words (
  chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (chunk_id, word)
);

-- Ingestion log
CREATE TABLE ingestion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES sources(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  episodes_added INTEGER NOT NULL DEFAULT 0,
  chunks_added INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

-- Indexes
CREATE INDEX idx_episodes_published ON episodes(published_date DESC);
CREATE INDEX idx_episodes_year_month ON episodes(year, month);
CREATE INDEX idx_chunks_episode ON chunks(episode_id);
CREATE INDEX idx_chunks_vector ON chunks(vector_id);
CREATE INDEX idx_tags_usage ON tags(usage_count DESC);
CREATE INDEX idx_chunk_tags_tag ON chunk_tags(tag_id);
CREATE INDEX idx_episode_tags_tag ON episode_tags(tag_id);
CREATE INDEX idx_concordance_count ON concordance(total_count DESC);
CREATE INDEX idx_chunk_words_word ON chunk_words(word);

PRAGMA optimize;
