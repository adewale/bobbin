const DROPS = [
  "DROP TABLE IF EXISTS chunk_words",
  "DROP TABLE IF EXISTS concordance",
  "DROP TABLE IF EXISTS episode_tags",
  "DROP TABLE IF EXISTS chunk_tags",
  "DROP TABLE IF EXISTS tags",
  "DROP TABLE IF EXISTS chunks",
  "DROP TABLE IF EXISTS episodes",
  "DROP TABLE IF EXISTS ingestion_log",
  "DROP TABLE IF EXISTS sources",
];

const CREATES = [
  `CREATE TABLE sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_doc_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    last_fetched_at TEXT,
    last_revision_id TEXT,
    is_archive INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    published_date TEXT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    day INTEGER NOT NULL,
    summary TEXT,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    format TEXT NOT NULL DEFAULT 'notes',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    content_plain TEXT NOT NULL,
    summary TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    word_count INTEGER NOT NULL DEFAULT 0,
    vector_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    usage_count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE chunk_tags (
    chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (chunk_id, tag_id)
  )`,
  `CREATE TABLE episode_tags (
    episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (episode_id, tag_id)
  )`,
  `CREATE TABLE concordance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL UNIQUE,
    total_count INTEGER NOT NULL DEFAULT 0,
    doc_count INTEGER NOT NULL DEFAULT 0,
    distinctiveness REAL NOT NULL DEFAULT 0,
    in_baseline INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE chunk_words (
    chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    word TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (chunk_id, word)
  )`,
  `CREATE TABLE ingestion_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER REFERENCES sources(id),
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    episodes_added INTEGER NOT NULL DEFAULT 0,
    chunks_added INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_episodes_published ON episodes(published_date DESC)",
  "CREATE INDEX IF NOT EXISTS idx_episodes_year_month ON episodes(year, month)",
  "CREATE INDEX IF NOT EXISTS idx_chunks_episode ON chunks(episode_id)",
  "CREATE INDEX IF NOT EXISTS idx_chunks_vector ON chunks(vector_id)",
  "CREATE INDEX IF NOT EXISTS idx_tags_usage ON tags(usage_count DESC)",
  "CREATE INDEX IF NOT EXISTS idx_chunk_tags_tag ON chunk_tags(tag_id)",
  "CREATE INDEX IF NOT EXISTS idx_episode_tags_tag ON episode_tags(tag_id)",
  "CREATE INDEX IF NOT EXISTS idx_concordance_count ON concordance(total_count DESC)",
  "CREATE INDEX IF NOT EXISTS idx_chunk_words_word ON chunk_words(word)",
];

export async function applyTestMigrations(db: D1Database): Promise<void> {
  const allStatements = [...DROPS, ...CREATES];
  await db.batch(allStatements.map((sql) => db.prepare(sql)));
}
