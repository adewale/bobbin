CREATE INDEX IF NOT EXISTS idx_topic_candidate_audit_decision_slug_chunk
  ON topic_candidate_audit(decision, slug, chunk_id);

CREATE INDEX IF NOT EXISTS idx_llm_episode_candidate_evidence_chunk
  ON llm_episode_candidate_evidence(chunk_id, candidate_id);

CREATE INDEX IF NOT EXISTS idx_episodes_source_published
  ON episodes(source_id, published_date ASC);

CREATE INDEX IF NOT EXISTS idx_chunks_episode_position
  ON chunks(episode_id, position ASC);

CREATE INDEX IF NOT EXISTS idx_chunks_enrichment_version_id
  ON chunks(enrichment_version, id DESC);

PRAGMA optimize;
