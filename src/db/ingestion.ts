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
  const result = await db.prepare(
    `SELECT c.id, c.episode_id, c.content_plain
     FROM chunks c
     WHERE c.id NOT IN (SELECT DISTINCT chunk_id FROM chunk_tags)
     LIMIT ?`
  ).bind(limit).all();
  return result.results as any[];
}

export async function isEnrichmentDone(db: D1Database): Promise<boolean> {
  const result = await db.prepare(
    "SELECT COUNT(*) as c FROM chunks WHERE id NOT IN (SELECT DISTINCT chunk_id FROM chunk_tags)"
  ).first<{ c: number }>();
  return (result?.c || 0) === 0;
}
