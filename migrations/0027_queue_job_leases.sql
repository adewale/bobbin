ALTER TABLE queue_message_state ADD COLUMN lease_token TEXT;
ALTER TABLE queue_message_state ADD COLUMN lease_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_queue_message_state_lease
  ON queue_message_state(status, lease_expires_at);

PRAGMA optimize;
