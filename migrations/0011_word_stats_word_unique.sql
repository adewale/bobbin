DELETE FROM word_stats
WHERE id NOT IN (
  SELECT MIN(id)
  FROM word_stats
  GROUP BY word
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_word_stats_word_unique ON word_stats(word);

PRAGMA optimize;
