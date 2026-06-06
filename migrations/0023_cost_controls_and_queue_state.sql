CREATE TABLE IF NOT EXISTS queue_message_state (
  job_key TEXT PRIMARY KEY,
  message_id TEXT,
  message_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_queue_message_state_status ON queue_message_state(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_queue_message_state_message_id ON queue_message_state(message_id);

CREATE TABLE IF NOT EXISTS word_stats_period (
  period_type TEXT NOT NULL,
  period_key TEXT NOT NULL,
  word TEXT NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 0,
  doc_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (period_type, period_key, word)
);

CREATE INDEX IF NOT EXISTS idx_word_stats_period_lookup ON word_stats_period(period_type, period_key, total_count DESC);

PRAGMA optimize;
