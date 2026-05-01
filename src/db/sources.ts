import type { SourceRow } from "../types";
import { KNOWN_SOURCES } from "../data/source-registry";

const TRUSTED_DOC_IDS = KNOWN_SOURCES.map((source) => source.docId);

export interface PurgeSourceResult {
  docId: string;
  episodesDeleted: number;
  chunksDeleted: number;
  sourceDeleted: boolean;
}

export async function getAllSources(db: D1Database): Promise<SourceRow[]> {
  const result = await db.prepare("SELECT * FROM sources").all<SourceRow>();
  return result.results;
}

export async function getSourceByDocId(db: D1Database, docId: string): Promise<SourceRow | null> {
  return await db.prepare("SELECT * FROM sources WHERE google_doc_id = ?").bind(docId).first<SourceRow>();
}

export async function getLeastRecentSource(db: D1Database): Promise<SourceRow | null> {
  return await db.prepare(
    "SELECT * FROM sources ORDER BY last_fetched_at IS NOT NULL, last_fetched_at ASC LIMIT 1"
  ).first<SourceRow>();
}

export async function ensureSource(db: D1Database, docId: string, title: string, isArchive = 0, active = 1): Promise<void> {
  await db.prepare(
    "INSERT OR IGNORE INTO sources (google_doc_id, title, is_archive, active) VALUES (?, ?, ?, ?)"
  ).bind(docId, title, isArchive, active).run();
  await db.prepare(
    "UPDATE sources SET title = ?, is_archive = ?, active = ? WHERE google_doc_id = ? AND (title != ? OR is_archive != ? OR active != ?)"
  ).bind(title, isArchive, active, docId, title, isArchive, active).run();
}

export async function ensureKnownSources(db: D1Database): Promise<void> {
  for (const source of KNOWN_SOURCES) {
    await ensureSource(db, source.docId, source.title, source.isArchive, 1);
  }
}

export async function getRefreshSources(db: D1Database): Promise<SourceRow[]> {
  if (TRUSTED_DOC_IDS.length === 0) return [];
  const result = await db.prepare(
    `SELECT * FROM sources
     WHERE title NOT LIKE '%(Empty)%'
       AND active = 1
       AND google_doc_id IN (${TRUSTED_DOC_IDS.map(() => "?").join(",")})
     ORDER BY is_archive DESC, created_at ASC, id ASC`
  ).bind(...TRUSTED_DOC_IDS).all<SourceRow>();
  return result.results;
}

export async function purgeSourceByDocId(db: D1Database, docId: string): Promise<PurgeSourceResult | null> {
  const source = await getSourceByDocId(db, docId);
  if (!source) return null;

  const counts = await db.prepare(
    `SELECT COUNT(*) as episodes_deleted,
            COALESCE((SELECT COUNT(*) FROM chunks c JOIN episodes e ON e.id = c.episode_id WHERE e.source_id = ?), 0) as chunks_deleted
     FROM episodes
     WHERE source_id = ?`
  ).bind(source.id, source.id).first<{ episodes_deleted: number; chunks_deleted: number }>();

  await db.prepare("DELETE FROM pipeline_runs WHERE source_id = ?").bind(source.id).run();
  await db.prepare("DELETE FROM llm_enrichment_runs WHERE source_id = ?").bind(source.id).run();
  await db.prepare("DELETE FROM ingestion_log WHERE source_id = ?").bind(source.id).run();
  await db.prepare("DELETE FROM episodes WHERE source_id = ?").bind(source.id).run();
  await db.prepare("DELETE FROM sources WHERE id = ?").bind(source.id).run();

  return {
    docId,
    episodesDeleted: counts?.episodes_deleted || 0,
    chunksDeleted: counts?.chunks_deleted || 0,
    sourceDeleted: (await getSourceByDocId(db, docId)) === null,
  };
}

export async function markSourceRefreshStarted(db: D1Database, sourceId: number): Promise<void> {
  await db.prepare(
    `UPDATE sources
     SET last_refresh_started_at = datetime('now')
     WHERE id = ?`
  ).bind(sourceId).run();
}

export async function markSourceRefreshSucceeded(db: D1Database, sourceId: number): Promise<void> {
  await db.prepare(
    `UPDATE sources
     SET last_fetched_at = datetime('now'),
         last_fetch_status = 'ok',
         last_fetch_error = NULL,
         last_refresh_completed_at = datetime('now'),
         consecutive_failures = 0
     WHERE id = ?`
  ).bind(sourceId).run();
}

export async function markSourceRefreshFailed(db: D1Database, sourceId: number, message: string): Promise<void> {
  await db.prepare(
    `UPDATE sources
     SET last_fetch_status = 'failed',
         last_fetch_error = ?,
         last_refresh_completed_at = datetime('now'),
         consecutive_failures = consecutive_failures + 1
     WHERE id = ?`
  ).bind(message.substring(0, 500), sourceId).run();
}

export async function updateSourceFetchedAt(db: D1Database, sourceId: number): Promise<void> {
  await db.prepare(
    "UPDATE sources SET last_fetched_at = datetime('now') WHERE id = ?"
  ).bind(sourceId).run();
}

export async function getExistingDatesForSource(db: D1Database, sourceId: number): Promise<Set<string>> {
  const result = await db.prepare(
    "SELECT published_date FROM episodes WHERE source_id = ?"
  ).bind(sourceId).all<{ published_date: string }>();
  return new Set(result.results.map((r) => r.published_date));
}

export async function getSourceTag(db: D1Database, sourceId: number): Promise<string> {
  const source = await db.prepare("SELECT google_doc_id FROM sources WHERE id = ?")
    .bind(sourceId).first<{ google_doc_id: string }>();
  return source ? source.google_doc_id.substring(0, 6) : String(sourceId);
}
