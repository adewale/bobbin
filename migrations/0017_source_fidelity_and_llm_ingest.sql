ALTER TABLE sources ADD COLUMN latest_html TEXT;

ALTER TABLE episodes ADD COLUMN content_markdown TEXT;
ALTER TABLE episodes ADD COLUMN rich_content_json TEXT;
ALTER TABLE episodes ADD COLUMN links_json TEXT;

ALTER TABLE chunks ADD COLUMN content_markdown TEXT;
ALTER TABLE chunks ADD COLUMN rich_content_json TEXT;
ALTER TABLE chunks ADD COLUMN links_json TEXT;
ALTER TABLE chunks ADD COLUMN images_json TEXT;

CREATE TABLE llm_enrichment_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES sources(id),
  episode_id INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
  extractor_model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  raw_response_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE llm_episode_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES llm_enrichment_runs(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  candidate_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  rank_position INTEGER NOT NULL DEFAULT 0,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE llm_episode_candidate_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES llm_episode_candidates(id) ON DELETE CASCADE,
  chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  chunk_slug TEXT NOT NULL,
  quote TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_llm_enrichment_runs_episode ON llm_enrichment_runs(episode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_episode_candidates_episode_slug ON llm_episode_candidates(episode_id, slug);
CREATE INDEX IF NOT EXISTS idx_llm_episode_candidate_evidence_candidate ON llm_episode_candidate_evidence(candidate_id);

PRAGMA optimize;
