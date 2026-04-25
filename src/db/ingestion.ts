export type IngestionRunType = "refresh" | "manual_ingest" | "enrich" | "finalize";

function serializePipelineReport(report?: unknown): string | null {
  if (report === undefined) return null;
  return JSON.stringify(report);
}

export async function createIngestionLog(
  db: D1Database,
  sourceId: number | null,
  runType: IngestionRunType = "refresh"
): Promise<number> {
  const result = await db.prepare(
    "INSERT INTO ingestion_log (source_id, status, run_type) VALUES (?, 'running', ?)"
  ).bind(sourceId, runType).run();
  return result.meta.last_row_id;
}

export async function completeIngestionLog(
  db: D1Database,
  logId: number,
  episodesAdded: number,
  chunksAdded: number,
  pipelineReport?: unknown,
  status: "completed" | "partial" = "completed"
): Promise<void> {
  await db.prepare(
    `UPDATE ingestion_log SET status = ?, completed_at = datetime('now'),
     episodes_added = ?, chunks_added = ?, pipeline_report = ? WHERE id = ?`
  ).bind(status, episodesAdded, chunksAdded, serializePipelineReport(pipelineReport), logId).run();
}

export async function failIngestionLog(
  db: D1Database,
  logId: number,
  error: string,
  pipelineReport?: unknown
): Promise<void> {
  await db.prepare(
    `UPDATE ingestion_log SET status = 'failed', completed_at = datetime('now'),
     error_message = ?, pipeline_report = ? WHERE id = ?`
  ).bind(error.substring(0, 500), serializePipelineReport(pipelineReport), logId).run();
}

export async function getUnenrichedChunks(db: D1Database, limit: number) {
  // Also pick up chunks with outdated enrichment_version
  const { CURRENT_ENRICHMENT_VERSION } = await import("../jobs/ingest");
  const result = await db.prepare(
    `WITH pending_chunks AS (
       SELECT c.id, c.episode_id, c.content_plain
       FROM chunks c
       WHERE c.enriched = 0
       UNION
       SELECT c.id, c.episode_id, c.content_plain
       FROM chunks c
       WHERE c.enriched != 0 AND c.enrichment_version < ?
     )
     SELECT id, episode_id, content_plain
     FROM pending_chunks
     ORDER BY id DESC
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
    `SELECT EXISTS(
       SELECT 1 FROM chunks WHERE enriched = 0
       UNION
       SELECT 1 FROM chunks WHERE enriched != 0 AND enrichment_version < ?
     ) as has_pending`
  ).bind(CURRENT_ENRICHMENT_VERSION).first<{ has_pending: number }>();
  return (result?.has_pending || 0) === 0;
}
