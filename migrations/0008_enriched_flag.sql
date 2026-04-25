-- Add enriched flag column to chunks table.
-- Replaces the slow NOT IN (SELECT chunk_id FROM chunk_topics) subquery
-- with a simple WHERE enriched = 0 index scan.
ALTER TABLE chunks ADD COLUMN enriched INTEGER NOT NULL DEFAULT 0;

-- Mark all existing chunks as enriched (they already have topic assignments)
UPDATE chunks SET enriched = 1 WHERE id IN (SELECT DISTINCT chunk_id FROM chunk_topics);

-- Index for fast unenriched lookup
CREATE INDEX IF NOT EXISTS idx_chunks_enriched ON chunks(enriched) WHERE enriched = 0;

PRAGMA optimize;
