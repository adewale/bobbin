CREATE TABLE IF NOT EXISTS cloudflare_cost_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  operation TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  route TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cloudflare_cost_events_time ON cloudflare_cost_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloudflare_cost_events_product_time ON cloudflare_cost_events(product, created_at DESC);

PRAGMA optimize;
