CREATE TABLE IF NOT EXISTS search_rate_limit_state (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_search_rate_limit_state_window ON search_rate_limit_state(window_start);

PRAGMA optimize;
