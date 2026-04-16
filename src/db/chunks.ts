import type { ChunkWithEpisode, TopicRow } from "../types";

export async function getChunkBySlug(db: D1Database, slug: string): Promise<ChunkWithEpisode | null> {
  return await db.prepare(
    `SELECT c.*, e.slug as episode_slug, e.title as episode_title, e.published_date, e.format as episode_format
     FROM chunks c
     JOIN episodes e ON c.episode_id = e.id
     WHERE c.slug = ?`
  ).bind(slug).first<ChunkWithEpisode>();
}

export async function getChunkTopics(db: D1Database, chunkId: number): Promise<TopicRow[]> {
  const result = await db.prepare(
    `SELECT t.* FROM topics t
     JOIN chunk_topics ct ON t.id = ct.topic_id
     WHERE ct.chunk_id = ? AND t.hidden = 0 AND t.display_suppressed = 0
     ORDER BY t.usage_count * CASE
        WHEN t.distinctiveness > 0 THEN t.distinctiveness
        WHEN t.name LIKE '% %' THEN 20
        ELSE 1
      END DESC`
  ).bind(chunkId).all<TopicRow>();
  return result.results;
}

export async function getRelatedByTopics(db: D1Database, chunkId: number, limit = 5): Promise<any[]> {
  const result = await db.prepare(
    `SELECT DISTINCT c.*, e.slug as episode_slug, e.published_date as rel_date
     FROM chunks c
     JOIN chunk_topics ct1 ON c.id = ct1.chunk_id
     JOIN chunk_topics ct2 ON ct1.topic_id = ct2.topic_id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct2.chunk_id = ? AND c.id != ?
     LIMIT ?`
  ).bind(chunkId, chunkId, limit).all();
  return result.results;
}

export async function getThreadChunks(db: D1Database, chunkId: number, episodeId: number, limit = 8): Promise<any[]> {
  const result = await db.prepare(
    `SELECT DISTINCT c.id, c.slug, c.title, c.content_plain,
            e.slug as episode_slug, e.title as episode_title, e.published_date
     FROM chunks c
     JOIN chunk_topics ct1 ON c.id = ct1.chunk_id
     JOIN chunk_topics ct2 ON ct1.topic_id = ct2.topic_id
     JOIN episodes e ON c.episode_id = e.id
     WHERE ct2.chunk_id = ? AND c.id != ? AND c.episode_id != ?
     ORDER BY e.published_date DESC
     LIMIT ?`
  ).bind(chunkId, chunkId, episodeId, limit).all();
  return result.results;
}

export async function getAdjacentChunks(db: D1Database, episodeId: number, position: number) {
  const [prev, next] = await Promise.all([
    db.prepare("SELECT slug, title FROM chunks WHERE episode_id = ? AND position = ?")
      .bind(episodeId, position - 1).first<{ slug: string; title: string }>(),
    db.prepare("SELECT slug, title FROM chunks WHERE episode_id = ? AND position = ?")
      .bind(episodeId, position + 1).first<{ slug: string; title: string }>(),
  ]);
  return { prev, next };
}
