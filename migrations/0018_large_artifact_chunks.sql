CREATE TABLE source_html_chunks (
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  html_chunk TEXT NOT NULL,
  PRIMARY KEY (source_id, chunk_index)
);

CREATE TABLE episode_artifact_chunks (
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  artifact_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content_chunk TEXT NOT NULL,
  PRIMARY KEY (episode_id, artifact_key, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_source_html_chunks_source ON source_html_chunks(source_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_episode_artifact_chunks_episode ON episode_artifact_chunks(episode_id, artifact_key, chunk_index);

PRAGMA optimize;
