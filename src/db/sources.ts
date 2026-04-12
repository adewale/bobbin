import type { SourceRow } from "../types";

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

export async function ensureSource(db: D1Database, docId: string, title: string): Promise<void> {
  await db.prepare(
    "INSERT OR IGNORE INTO sources (google_doc_id, title) VALUES (?, ?)"
  ).bind(docId, title).run();
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
