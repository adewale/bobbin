import type { TagRow } from "../types";

export async function getTopTags(db: D1Database, limit: number): Promise<TagRow[]> {
  const result = await db.prepare(
    "SELECT * FROM tags WHERE usage_count > 0 ORDER BY usage_count DESC LIMIT ?"
  ).bind(limit).all<TagRow>();
  return result.results;
}

export async function getFilteredTags(db: D1Database, minUsage: number, limit: number): Promise<TagRow[]> {
  const result = await db.prepare(
    "SELECT * FROM tags WHERE usage_count >= ? ORDER BY usage_count DESC LIMIT ?"
  ).bind(minUsage, limit).all<TagRow>();
  return result.results;
}

export async function getTagBySlug(db: D1Database, slug: string): Promise<TagRow | null> {
  return await db.prepare("SELECT * FROM tags WHERE slug = ?")
    .bind(slug).first<TagRow>();
}

export async function getTagChunkCount(db: D1Database, tagId: number): Promise<number> {
  const result = await db.prepare(
    "SELECT COUNT(*) as count FROM chunk_tags WHERE tag_id = ?"
  ).bind(tagId).first<{ count: number }>();
  return result?.count || 0;
}

export async function getTaggedChunks(db: D1Database, tagId: number, limit: number, offset: number) {
  const result = await db.prepare(
    `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date
     FROM chunks c
     JOIN chunk_tags ct ON c.id = ct.chunk_id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct.tag_id = ?
     ORDER BY e.published_date DESC
     LIMIT ? OFFSET ?`
  ).bind(tagId, limit, offset).all();
  return result.results;
}

export async function getTagSparkline(db: D1Database, tagId: number) {
  const result = await db.prepare(
    `SELECT e.published_date, COUNT(ct.chunk_id) as count
     FROM chunk_tags ct
     JOIN chunks c ON ct.chunk_id = c.id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct.tag_id = ?
     GROUP BY e.id
     ORDER BY e.published_date ASC`
  ).bind(tagId).all();
  return result.results as any[];
}

export async function getTagDiffChunks(db: D1Database, tagId: number) {
  const result = await db.prepare(
    `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date
     FROM chunks c
     JOIN chunk_tags ct ON c.id = ct.chunk_id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct.tag_id = ?
     ORDER BY e.published_date ASC`
  ).bind(tagId).all();
  return result.results as any[];
}

export async function getTagFeedChunks(db: D1Database, tagId: number, limit = 50) {
  const result = await db.prepare(
    `SELECT c.*, e.slug as episode_slug, e.published_date
     FROM chunks c
     JOIN chunk_tags ct ON c.id = ct.chunk_id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct.tag_id = ?
     ORDER BY e.published_date DESC
     LIMIT ?`
  ).bind(tagId, limit).all();
  return result.results as any[];
}

export async function getTagEpisodes(db: D1Database, tagId: number) {
  const result = await db.prepare(
    `SELECT e.*, COUNT(ct.chunk_id) as tag_chunk_count
     FROM episodes e
     JOIN episode_tags et ON e.id = et.episode_id
     JOIN chunk_tags ct ON ct.tag_id = et.tag_id AND ct.tag_id = ?
     JOIN chunks c ON c.id = ct.chunk_id AND c.episode_id = e.id
     WHERE et.tag_id = ?
     GROUP BY e.id
     ORDER BY e.published_date ASC`
  ).bind(tagId, tagId).all();
  return result.results as any[];
}
