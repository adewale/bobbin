-- FTS5 virtual table for full-text search with field boosting
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  title,
  content_plain,
  content='chunks',
  content_rowid='id',
  tokenize='porter unicode61'
);

-- Populate FTS from existing chunks
INSERT INTO chunks_fts(rowid, title, content_plain)
  SELECT id, title, content_plain FROM chunks;

-- Triggers to keep FTS in sync with chunks table
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, title, content_plain)
    VALUES (new.id, new.title, new.content_plain);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, title, content_plain)
    VALUES ('delete', old.id, old.title, old.content_plain);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, title, content_plain)
    VALUES ('delete', old.id, old.title, old.content_plain);
  INSERT INTO chunks_fts(rowid, title, content_plain)
    VALUES (new.id, new.title, new.content_plain);
END;
