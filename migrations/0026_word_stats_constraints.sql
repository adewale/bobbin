-- Restore the constraints word_stats lost in migration 0007: it was created
-- with CREATE TABLE ... AS SELECT, which drops the primary key, NOT NULLs,
-- and defaults from the original concordance schema. Rebuilt rows since then
-- have id = NULL and rely on follow-up UPDATEs for column defaults.

CREATE TABLE word_stats_rebuilt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 0,
  doc_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  distinctiveness REAL NOT NULL DEFAULT 0,
  in_baseline INTEGER NOT NULL DEFAULT 0
);

INSERT INTO word_stats_rebuilt (word, total_count, doc_count, updated_at, distinctiveness, in_baseline)
SELECT
  word,
  COALESCE(total_count, 0),
  COALESCE(doc_count, 0),
  COALESCE(updated_at, datetime('now')),
  COALESCE(distinctiveness, 0),
  COALESCE(in_baseline, 0)
FROM word_stats
WHERE word IS NOT NULL;

DROP TABLE word_stats;

ALTER TABLE word_stats_rebuilt RENAME TO word_stats;

CREATE UNIQUE INDEX IF NOT EXISTS idx_word_stats_word_unique ON word_stats(word);
CREATE INDEX IF NOT EXISTS idx_word_stats_count ON word_stats(total_count DESC);
CREATE INDEX IF NOT EXISTS idx_word_stats_distinctiveness ON word_stats(distinctiveness DESC);

PRAGMA optimize;
