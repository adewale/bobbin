export async function createIngestionLog(db: D1Database, sourceId: number): Promise<number> {
  const result = await db.prepare(
    "INSERT INTO ingestion_log (source_id, status) VALUES (?, 'running')"
  ).bind(sourceId).run();
  return result.meta.last_row_id;
}

export async function completeIngestionLog(
  db: D1Database, logId: number, episodesAdded: number, chunksAdded: number
): Promise<void> {
  await db.prepare(
    `UPDATE ingestion_log SET status = 'completed', completed_at = datetime('now'),
     episodes_added = ?, chunks_added = ? WHERE id = ?`
  ).bind(episodesAdded, chunksAdded, logId).run();
}

export async function failIngestionLog(db: D1Database, logId: number, error: string): Promise<void> {
  await db.prepare(
    `UPDATE ingestion_log SET status = 'failed', completed_at = datetime('now'),
     error_message = ? WHERE id = ?`
  ).bind(error.substring(0, 500), logId).run();
}

export async function getUnenrichedChunks(db: D1Database, limit: number) {
  // Also pick up chunks with outdated enrichment_version
  const { CURRENT_ENRICHMENT_VERSION } = await import("../jobs/ingest");
  const result = await db.prepare(
    `SELECT c.id, c.episode_id, c.content_plain
     FROM chunks c
     WHERE c.enriched = 0 OR c.enrichment_version < ?
     LIMIT ?`
  ).bind(CURRENT_ENRICHMENT_VERSION, limit).all();
  return result.results as any[];
}

export async function markChunksEnriched(db: D1Database, chunkIds: number[]) {
  if (!chunkIds.length) return;
  const { CURRENT_ENRICHMENT_VERSION } = await import("../jobs/ingest");
  // Batch to avoid SQLite variable limit (max ~99 per statement, leave room for version param)
  const BATCH_SIZE = 90;
  for (let i = 0; i < chunkIds.length; i += BATCH_SIZE) {
    const batch = chunkIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(",");
    await db.prepare(
      `UPDATE chunks SET enriched = 1, enrichment_version = ? WHERE id IN (${placeholders})`
    ).bind(CURRENT_ENRICHMENT_VERSION, ...batch).run();
  }
}

export async function resetEnrichmentFlags(db: D1Database) {
  await db.prepare("UPDATE chunks SET enriched = 0").run();
}

export async function isEnrichmentDone(db: D1Database): Promise<boolean> {
  const { CURRENT_ENRICHMENT_VERSION } = await import("../jobs/ingest");
  const result = await db.prepare(
    "SELECT COUNT(*) as c FROM chunks WHERE enriched = 0 OR enrichment_version < ?"
  ).bind(CURRENT_ENRICHMENT_VERSION).first<{ c: number }>();
  return (result?.c || 0) === 0;
}
